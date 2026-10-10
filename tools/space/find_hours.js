// Reads each place's own website in headless Chromium and finds its posted opening hours.
// usage: node find_hours.js candidates.json found.json [concurrency]
//   candidates.json: from find_candidates.py, [{id, name, addr, phone, urls: [{url, src}], socials}]
//   found.json: {id: {status, oh?, src?, url?, snippet?, verified?, err?}}
//
// Compared with scrape_hours.js (the first pass, OpenStreetMap websites only), this one:
//   - reads websites found in Overture Maps as well as OpenStreetMap;
//   - follows link-in-bio pages (Linktree and the like) through to the business's own site;
//   - reads Squarespace's built-in business hours, schema.org JSON-LD and microdata, then
//     any weekly schedule in the JSON the site itself loads (its own API calls and app state:
//     Square Online, Toast, Wix and the like), then the page text, looking first right after
//     this place's own address on sites that list several locations;
//   - reads embedded frames and follows up to four hours, contact, visit or location pages;
//   - checks robots.txt for every site it opens, not only the first;
//   - says how it knows the page is about this place: its street address or phone number
//     appears on the site ("address", "phone"), or the link came from OpenStreetMap ("osm").
//     Hours that only match by name are kept as "unverified" and not applied.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { fromText, fromTextNear, fromJsonLd, fromOhStrings, fromSquarespace, fromAnyJson, toOsm } = require('./hours_parse.js');

const [, , inPath, outPath, concArg] = process.argv;
const CONC = +(concArg || 4);
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PLACE_BUDGET_MS = 120000;
const PAGE_TIMEOUT = 25000;
const LINK_HINT = [[/hours?|horario/i, 4], [/visit|location|find-?us|directions|store-?info/i, 3], [/contact|info/i, 2], [/about/i, 1]];
// Not the business's own site: reviews, maps, social networks, directories, licensing lookups.
const SKIP_HOST = /(^|\.)(yelp|google|goo\.gl|facebook|fb|instagram|twitter|x|tiktok|youtube|groupon|99designs|dca\.ca|locality|nextdoor|tripadvisor|doordash|ubereats|grubhub|postmates|seamless|opentable|resy|bbb|yellowpages|mapquest|foursquare|linkedin|wheree|mapcarta|cylex|chamberofcommerce|manta|zaubee)\.(com|org|gov|co|me|net)$/i;
const BIO_HOST = /(^|\.)(linktr\.ee|linkin\.bio|bio\.site|beacons\.ai|lnk\.bio|campsite\.bio)$/i;
// Online ordering pages for one store, which list its hours; not the platforms' own sites.
const ORDER_PAGE = u => {
  const h = u.hostname.replace(/^www\./, ''), p = u.pathname;
  if (/privacy|terms|legal|login|sign-?up|careers|blog|support/i.test(p)) return false;
  return (/^(order\.)?toasttab\.com$/.test(h) && p.length > 1)
    || /\.square\.site$/.test(h)
    || (h === 'squareup.com' && p.startsWith('/store/'))
    || /^(direct|ordering)\.chownow\.com$/.test(h)
    || (h.endsWith('clover.com') && p.includes('online-ordering'))
    || /\.(popmenu|getbento)\.com$/.test(h);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function robotsRules(txt) {
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
  return new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : '')).test(target);
}
const robotsOk = (rules, path) => {
  const longest = list => Math.max(0, ...list.filter(p => robotsMatch(p, path)).map(p => p.replace(/\*/g, '').length));
  return longest(rules.allow) >= longest(rules.dis);
};
const robotsCache = new Map();
async function allowed(browser, url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    robotsCache.set(u.origin, (async () => {
      const page = await browser.newPage();
      try {
        const r = await page.goto(u.origin + '/robots.txt', { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (r && r.ok() && /text\/plain/.test(r.headers()['content-type'] || '')) return robotsRules(await r.text());
      } catch { /* no robots.txt */ } finally { await page.close().catch(() => {}); }
      return { dis: [], allow: [] };
    })());
  }
  return robotsOk(await robotsCache.get(u.origin), u.pathname + u.search);
}

// How to tell the page is about this place.
function needlesFor(rec) {
  const out = { addr: null, phone: null };
  const m = (rec.addr || '').toLowerCase().match(/^(\d+[a-z]?)\s+(?:(\d+)(?:st|nd|rd|th)\s+avenue|([a-z]+))/);
  if (m) out.addr = m[2] ? new RegExp(`${m[1]}\\s+${m[2]}(?:st|nd|rd|th)?\\s+(?:ave|avenue)`, 'i') : new RegExp(`${m[1]}\\s+${m[3]}`, 'i');
  const d = String(rec.phone || '').replace(/\D/g, '').slice(-7);
  if (d.length === 7) out.phone = new RegExp(`${d.slice(0, 3)}\\D{0,3}${d.slice(3)}`);
  return out;
}

async function readPage(page, u) {
  // Keep the JSON the site fetches for itself while the page loads.
  const json = [];
  const onResponse = async res => {
    try {
      if (!/json/.test(res.headers()['content-type'] || '') || json.length >= 40) return;
      const len = +(res.headers()['content-length'] || 0);
      if (len > 1500000) return;
      const t = await res.text();
      if (t.length < 1500000 && /day|hour|open/i.test(t)) json.push(JSON.parse(t));
    } catch { /* not JSON, or the body is gone */ }
  };
  page.on('response', onResponse);
  try { return await readPageInner(page, u, json); } finally { page.off('response', onResponse); }
}
async function readPageInner(page, u, json) {
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
  await page.waitForNetworkIdle({ idleTime: 700, timeout: 8000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, document.body ? document.body.scrollHeight : 0)).catch(() => {});
  await sleep(600);
  const d = await page.evaluate(() => ({
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent),
    micro: [...document.querySelectorAll('[itemprop="openingHours"]')].map(e => e.getAttribute('content') || e.textContent),
    sq: (window.Static && window.Static.SQUARESPACE_CONTEXT && window.Static.SQUARESPACE_CONTEXT.website && window.Static.SQUARESPACE_CONTEXT.website.businessHours) || null,
    text: document.body ? document.body.innerText : '',
    state: ['__NEXT_DATA__', '__BOOTSTRAP_STATE__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__NUXT__', '__APOLLO_STATE__']
      .map(k => { try { const s = window[k] && JSON.stringify(window[k]); return s && s.length < 3000000 ? s : null; } catch { return null; } })
      .concat([...document.querySelectorAll('script[type="application/json"]')].map(s => s.textContent).filter(t => t.length < 3000000))
      .filter(Boolean),
    links: [...document.querySelectorAll('a[href]')].slice(0, 600).map(a => ({ h: a.href, t: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 50) })),
  }));
  d.json = json;
  for (const s of d.state) { try { d.json.push(JSON.parse(s)); } catch { /* not JSON */ } }
  // Text inside embedded frames (hours widgets, map cards, ordering menus).
  for (const f of page.frames().slice(1, 8)) {
    try { d.text += '\n' + await f.evaluate(() => (document.body ? document.body.innerText : '')); } catch { /* cross-origin or gone */ }
  }
  return d;
}

function hoursFrom(d, near, houseNumber) {
  let hit = fromSquarespace(d.sq);
  if (hit) return { ...hit, src: 'squarespace' };
  hit = fromJsonLd(d.ld, houseNumber);
  if (hit) return { ...hit, src: 'json-ld' };
  const per = d.micro.length ? fromOhStrings(d.micro) : null;
  if (per) return { oh: toOsm(per), snippet: 'schema.org microdata', src: 'microdata' };
  hit = fromAnyJson(d.json);
  if (hit) return { ...hit, src: 'page data' };
  hit = fromTextNear(d.text, near);
  if (hit) return { ...hit, src: 'text near address' };
  hit = fromText(d.text);
  return hit ? { ...hit, src: 'text' } : null;
}

async function readSite(browser, page, startUrl, rec, nd) {
  let url = startUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!(await allowed(browser, url))) return { blocked: true };
  const site = hostOf(url), seen = new Set(), found = { verified: null, hit: null, extra: [] };
  const near = [];
  const houseNumber = ((rec.addr || '').match(/^(\d+)/) || [])[1];
  const addrText = (rec.addr || '').toLowerCase().match(/^\d+[a-z]?\s+[a-z0-9]+/);
  if (addrText) near.push(addrText[0]);
  const check = text => {
    if (!found.verified && nd.addr && nd.addr.test(text)) found.verified = 'address';
    if (!found.verified && nd.phone && nd.phone.test(text)) found.verified = 'phone';
  };
  async function visit(u) {
    seen.add(u.replace(/#.*$/, ''));
    const d = await readPage(page, u);
    check(d.text);
    if (!found.hit) { const h = hoursFrom(d, near, houseNumber); if (h) found.hit = { ...h, url: u }; }
    return d;
  }
  const first = await visit(url);
  // Link-in-bio pages: their outbound links are the candidates.
  if (BIO_HOST.test(site)) {
    found.extra = [...new Set(first.links.map(l => l.h).filter(h => /^https?:/.test(h) && !BIO_HOST.test(hostOf(h)) && !SKIP_HOST.test(hostOf(h))))].slice(0, 3);
    return found;
  }
  const cand = [];
  for (const l of first.links) {
    let u; try { u = new URL(l.h); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    u.hash = '';
    if (ORDER_PAGE(u)) { if (!found.extra.includes(u.href)) found.extra.push(u.href); continue; }
    if (hostOf(u.href) !== site || seen.has(u.href) || cand.some(c => c.u === u.href)) continue;
    let score = 0;
    for (const [re, w] of LINK_HINT) if (re.test(u.pathname) || re.test(l.t)) score = Math.max(score, w);
    if (score) cand.push({ u: u.href, score });
  }
  cand.sort((a, b) => b.score - a.score);
  for (const c of cand.slice(0, 4)) {
    if (found.hit && found.verified) break;
    if (!(await allowed(browser, c.u))) continue;
    try { await visit(c.u); } catch { /* next page */ }
  }
  found.extra = found.extra.slice(0, 2);
  return found;
}

async function findPlace(browser, rec) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    const ua = await browser.userAgent();
    await page.setUserAgent(ua.replace('HeadlessChrome', 'Chrome') + ' SunsetIdleSpace/0.2 (neighborhood map; reads posted hours)');
    await page.setRequestInterception(true);
    page.on('request', r => (['image', 'media', 'font'].includes(r.resourceType()) ? r.abort() : r.continue()));
    const nd = needlesFor(rec);
    const queue = rec.urls.filter(u => !SKIP_HOST.test(hostOf(u.url))).map(u => ({ ...u }));
    const tried = [];
    let fallback = null, blocked = 0;
    while (queue.length && tried.length < 6) {
      const { url, src } = queue.shift();
      if (tried.includes(url)) continue;
      tried.push(url);
      let r;
      try { r = await readSite(browser, page, url, rec, nd); } catch (e) { continue; }
      if (r.blocked) { blocked++; continue; }
      for (const x of r.extra || []) if (!tried.includes(x) && !SKIP_HOST.test(hostOf(x))) queue.push({ url: x, src: src + '>link' });
      // A location page whose address names this place's street ("irvingstreet.example.com").
      const street = ((rec.addr || '').toLowerCase().match(/^\d+[a-z]?\s+([a-z]{5,})/) || [])[1];
      const viaUrl = street && r.hit && r.hit.url.toLowerCase().includes(street) ? 'url' : null;
      // An OpenStreetMap link vouches for its own site, not for pages it links out to.
      const verified = r.verified || viaUrl || (/^osm:[a-z:]+$/.test(src) && hostOf(r.hit ? r.hit.url : '') === hostOf(url) ? 'osm' : null);
      // Platforms fill a blank schedule with Monday to Friday 9 to 5; from page data alone
      // that is more likely the default than the owner's hours.
      const template = r.hit && r.hit.src === 'page data' && /^Mo 09:00-17:00; Tu 09:00-17:00; We 09:00-17:00; Th 09:00-17:00; Fr 09:00-17:00; Sa off; Su off$/.test(r.hit.oh);
      if (r.hit && verified && !template) return { status: 'hours', ...r.hit, verified, tried };
      if (r.hit && !fallback) fallback = { status: 'unverified', ...r.hit, verified: 'name', tried };
    }
    if (fallback) return fallback;
    if (!tried.length) return { status: 'nourl' };
    return { status: blocked === tried.length ? 'blocked' : 'none', tried };
  } catch (e) {
    return { status: 'error', err: String(e.message || e).slice(0, 120) };
  } finally {
    await page.close().catch(() => {});
  }
}

(async () => {
  const recs = JSON.parse(fs.readFileSync(inPath, 'utf8')).filter(r => r.urls.length);
  const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  // --retry reads again the places a pass found nothing for (after the readers improve).
  const again = process.argv.includes('--retry') ? ['error', 'none', 'unverified'] : ['error'];
  const todo = recs.filter(r => !out[r.id] || again.includes(out[r.id].status));
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, acceptInsecureCerts: false });
  let next = 0, done = 0;
  async function worker() {
    while (next < todo.length) {
      const rec = todo[next++];
      const res = await Promise.race([findPlace(browser, rec), sleep(PLACE_BUDGET_MS).then(() => ({ status: 'error', err: 'place timeout' }))]);
      out[rec.id] = res;
      done++;
      console.log(`[${done}/${todo.length}] ${res.status.padEnd(10)} ${rec.name}${res.oh ? ` <- ${res.src}, ${res.verified}` : res.err ? ` (${res.err})` : ''}`);
      fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  await browser.close();
  const c = {};
  Object.values(out).forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
  console.log('summary', JSON.stringify(c));
})();
