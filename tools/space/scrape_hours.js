// Visit each business's own website in headless Chromium and read its posted opening hours.
// usage: node scrape_hours.js in.json out.json [concurrency]
//   in.json: [{id, name, url}]   out.json: {id: {status, oh?, src?, url?, snippet?, err?}}
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { fromText, fromJsonLd, fromOhStrings, toOsm } = require('./hours_parse.js');

const [, , inPath, outPath, concArg] = process.argv;
const CONC = +(concArg || 4);
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SITE_BUDGET_MS = 70000;
const LINK_HINT = [[/hours?/i, 3], [/contact|location|visit|find-?us|directions/i, 2], [/about/i, 1]];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const host = u => new URL(u).hostname.replace(/^www\./, '');

function robotsRules(txt) {
  // Disallow paths for the "*" group
  const dis = [], allow = [];
  let inStar = false, seenAgent = false;
  for (const line of txt.split(/\r?\n/)) {
    const l = line.replace(/#.*/, '').trim();
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!seenAgent) inStar = false; inStar = inStar || v === '*'; seenAgent = true; continue; }
    seenAgent = false;
    if (!inStar) continue;
    if (k === 'disallow' && v) dis.push(v);
    if (k === 'allow' && v) allow.push(v);
  }
  return { dis, allow };
}
function robotsMatch(pat, target) {
  const anchored = pat.endsWith('$');
  if (anchored) pat = pat.slice(0, -1);
  const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : ''));
  return re.test(target);
}
// path = pathname + search; the longest matching rule wins, and Allow wins a tie (Google's rule)
const robotsOk = (rules, path) => {
  const longest = list => Math.max(0, ...list.filter(p => robotsMatch(p, path)).map(p => p.replace(/\*/g, '').length));
  return longest(rules.allow) >= longest(rules.dis);
};

async function scrapeSite(browser, rec) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    const ua = await browser.userAgent();
    await page.setUserAgent(ua.replace('HeadlessChrome', 'Chrome') + ' SunsetIdleSpace/0.1 (neighborhood demo)');
    await page.setRequestInterception(true);
    page.on('request', r => (['image', 'media', 'font'].includes(r.resourceType()) ? r.abort() : r.continue()));

    let url = rec.url.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    url = url.replace(/^http:\/\//i, 'https://');
    const origin = new URL(url).origin;

    let rules = { dis: [], allow: [] };
    try {
      const r = await page.goto(origin + '/robots.txt', { waitUntil: 'domcontentloaded', timeout: 8000 });
      if (r && r.ok() && /text\/plain/.test(r.headers()['content-type'] || '')) rules = robotsRules(await r.text());
    } catch { /* no robots.txt */ }
    if (!robotsOk(rules, new URL(url).pathname + new URL(url).search)) return { status: 'blocked', err: 'robots.txt disallows' };

    const seen = new Set();
    async function look(u) {
      seen.add(u);
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForNetworkIdle({ idleTime: 700, timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(500);
      const d = await page.evaluate(() => ({
        ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent),
        micro: [...document.querySelectorAll('[itemprop="openingHours"]')].map(e => e.getAttribute('content') || e.textContent),
        text: document.body ? document.body.innerText : '',
        links: [...document.querySelectorAll('a[href]')].slice(0, 500).map(a => ({ h: a.href, t: (a.innerText || '').trim().slice(0, 40) })),
      }));
      let hit = fromJsonLd(d.ld);
      let src = 'json-ld';
      if (!hit) { const per = d.micro.length ? fromOhStrings(d.micro) : null; if (per) { hit = { oh: toOsm(per), snippet: 'schema.org microdata' }; src = 'microdata'; } }
      if (!hit) { hit = fromText(d.text); src = 'text'; }
      return { hit: hit && { ...hit, src, url: u }, links: d.links };
    }

    let { hit, links } = await look(url);
    if (!hit) {
      const cand = [];
      for (const l of links) {
        let u; try { u = new URL(l.h); } catch { continue; }
        if (!/^https?:$/.test(u.protocol) || host(u.href) !== host(url)) continue;
        u.hash = '';
        const key = u.href;
        if (seen.has(key) || cand.some(c => c.u === key) || !robotsOk(rules, u.pathname + u.search)) continue;
        let score = 0;
        for (const [re, w] of LINK_HINT) if (re.test(u.pathname) || re.test(l.t)) score = Math.max(score, w);
        if (score) cand.push({ u: key, score });
      }
      cand.sort((a, b) => b.score - a.score);
      for (const c of cand.slice(0, 3)) {
        try { ({ hit } = await look(c.u)); } catch { continue; }
        if (hit) break;
      }
    }
    return hit ? { status: 'hours', oh: hit.oh, src: hit.src, url: hit.url, snippet: hit.snippet } : { status: 'none' };
  } catch (e) {
    return { status: 'error', err: String(e.message || e).slice(0, 120) };
  } finally {
    await page.close().catch(() => {});
  }
}

(async () => {
  const recs = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args });
  const out = {};
  let next = 0, done = 0;
  async function worker() {
    while (next < recs.length) {
      const rec = recs[next++];
      const res = await Promise.race([scrapeSite(browser, rec), sleep(SITE_BUDGET_MS).then(() => ({ status: 'error', err: 'site timeout' }))]);
      out[rec.id] = res;
      done++;
      console.log(`[${done}/${recs.length}] ${res.status.padEnd(7)} ${rec.name} ${res.oh ? '→ ' + res.src : res.err ? '(' + res.err + ')' : ''}`);
      fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  await browser.close();
  const c = {};
  Object.values(out).forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
  console.log('summary', JSON.stringify(c));
})();
