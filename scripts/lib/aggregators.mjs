// Sunset District event aggregators (sunset.dearcrisis.com).
//
// Node 20+, zero dependencies (global fetch only). Every exported fetcher takes
// `{ box, days, now, budgetMs }`, never throws, paces its own requests
// sequentially, and returns normalized events:
//
//   { title, start, end, allDay, url, venue, address, lat, lng, org, source,
//     image, description, free }
//
// `start`/`end` are ISO 8601 with a numeric offset (America/Los_Angeles wall
// time). Research notes, endpoints and caveats: docs/aggregators.md
//
// Run `node scripts/lib/aggregators.mjs` to hit every source and print counts
// and samples. Flags: --days=N, --only=luma,meetup, --out=events.json

export const SUNSET_BOX = { minLat: 37.73, maxLat: 37.7725, minLng: -122.514, maxLng: -122.452 };
const TZ = "America/Los_Angeles";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const DEFAULT_BUDGET_MS = 100_000; // per source; the whole run is parallel across sources

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, { method = "GET", headers = {}, body, timeout = 25_000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...headers },
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        // 429/503/529 are throttling: back off harder than for a plain 5xx
        const throttled = res.status === 429 || res.status === 503 || res.status === 529;
        await sleep((throttled ? 5000 : 2000) * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await sleep(1500);
        continue;
      }
      throw err;
    }
  }
}

async function getJSON(url, opts = {}) {
  const res = await http(url, { ...opts, headers: { accept: "application/json", ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getText(url, opts = {}) {
  const res = await http(url, { ...opts, headers: { accept: "text/html,application/xhtml+xml,*/*", ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const inBox = (box, lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// --- time zones

const offsetFmt = new Map();
function tzOffsetMinutes(ms, tz = TZ) {
  let f = offsetFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset", year: "numeric" });
    offsetFmt.set(tz, f);
  }
  const name = f.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3] || "0", 10));
}

const fmtOffset = (min) => {
  const a = Math.abs(min);
  return `${min < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
};

/** Any instant (ms, Date, or parseable string) -> "YYYY-MM-DDTHH:mm:ss-07:00" in tz. */
export function toZonedISO(input, tz = TZ) {
  const ms = typeof input === "number" ? input : input instanceof Date ? input.getTime() : Date.parse(input);
  if (!Number.isFinite(ms)) return null;
  const off = tzOffsetMinutes(ms, tz);
  return new Date(ms + off * 60_000).toISOString().slice(0, 19) + fmtOffset(off);
}

/** Wall-clock parts in tz -> ISO with that zone's offset (DST-correct). */
function wallToISO(y, mo, d, h = 0, mi = 0, s = 0, tz = TZ) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!Number.isFinite(guess)) return null;
  const off1 = tzOffsetMinutes(guess, tz);
  let ms = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(ms, tz);
  if (off2 !== off1) ms = guess - off2 * 60_000;
  return toZonedISO(ms, tz);
}

/** "2026-10-10 14:00", "2026-10-10T14:00:00", "2026-10-10" + "14:00" -> ISO in tz. */
function wallStringToISO(date, time = "", tz = TZ) {
  const s = `${date || ""} ${time || ""}`.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return wallToISO(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), tz);
}

// --- text

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "\u2013", mdash: "\u2014", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", eacute: "é", aacute: "á", iacute: "í", oacute: "ó",
  uacute: "ú", ntilde: "ñ", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™",
};
export function decodeEntities(s) {
  if (!s) return s;
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (n === 150) return "–"; // cp1252 en dash, Funcheap uses &#150;
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

function htmlToText(html) {
  if (!html) return "";
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

const squash = (s) => (s == null ? s : String(s).replace(/\s+/g, " ").trim());

function clip(s, max = 400) {
  const t = squash(s);
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, "") + "…";
}

const clean = (s) => {
  const t = squash(decodeEntities(s));
  return t || null;
};

// --- location rules (for sources without coordinates)

// Known in-district places. Coordinates are the ones Eventbrite/Luma/Meetup
// return for these venues (October 2026), or the venue's own site.
const GAZETTEER = [
  [/botanical garden|strybing/i, 37.76771, -122.46931],
  [/(san francisco|s\.?f\.?) county fair|county fair building|hall of flowers|1199 9th av/i, 37.76644, -122.46704],
  [/academy of sciences|cal academy|calacademy|55 music concourse/i, 37.76986, -122.46609],
  [/\bde ?young\b/i, 37.77147, -122.46868],
  [/japanese tea garden/i, 37.77009, -122.47044],
  [/music concourse|spreckels temple|(golden gate park|ggp) bandshell/i, 37.76991, -122.46852],
  [/conservatory of flowers/i, 37.77265, -122.46022],
  [/stow lake|blue heron (lake|boathouse)|strawberry hill/i, 37.77084, -122.47683],
  [/polo field/i, 37.76843, -122.49459],
  [/spreckels lake/i, 37.77048, -122.49646],
  [/kezar (stadium|pavilion)/i, 37.76681, -122.45601],
  [/mclaren lodge|501 stanyan/i, 37.77178, -122.45477],
  [/lawn bowling|bowling green dr/i, 37.7686, -122.45898],
  [/aids memorial grove/i, 37.77038, -122.46028],
  [/beach chalet/i, 37.76946, -122.51021],
  [/golden gate park golf|archery range/i, 37.76842, -122.50508],
  [/chain of lakes|bison paddock/i, 37.76851, -122.49943],
  [/robin williams meadow|sharon meadow|hippie hill/i, 37.76889, -122.45816],
  [/mother'?s meadow/i, 37.76655, -122.47612],
  [/marx (event )?meadow/i, 37.77116, -122.48561],
  [/lindley meadow/i, 37.76845, -122.48707],
  [/skatin'?g? place/i, 37.77155, -122.46273],
  [/whale'?s ta(il|le)|14th ave(nue)? east (picnic )?meadow/i, 37.77117, -122.47239],
  [/j(ohn)?\.? ?f\.? ?k(ennedy)?\.? (dr(ive)?\.? )?promenade/i, 37.77118, -122.47378],
  [/murphy windmill|dutch windmill|queen wilhelmina/i, 37.77066, -122.50909],
  [/sunset dunes|upper great h(igh)?wa?y/i, 37.75282, -122.50893],
  [/stern grove|pine lake/i, 37.73553, -122.47667],
  [/s(an )?f(rancisco)? zoo\b|sfzoo/i, 37.73297, -122.50297],
  [/sunset rec(reation)? cent(er|re)|2201 lawton/i, 37.75719, -122.48665],
  [/west sunset (playground|field|rec)/i, 37.74929, -122.49935],
  [/larsen (park|playground)/i, 37.73833, -122.47697],
  [/mccoppin (square|park)/i, 37.74376, -122.48003],
  [/parkside square/i, 37.73843, -122.48459],
  [/grandview park|turtle hill/i, 37.75614, -122.47162],
  [/golden gate heights park/i, 37.75353, -122.46931],
  [/sunset branch|1305 18th av/i, 37.763385, -122.476292],
  [/ortega branch|3223 ortega/i, 37.751258, -122.498025],
  [/parkside branch|1200 taraval/i, 37.743191, -122.479389],
  [/united irish cultural|2700 45th av/i, 37.73589, -122.50301],
  [/garden for the environment/i, 37.75842, -122.46364],
];
const RICHMOND_HINT = /\b(balboa|fulton|cabrillo|anza|geary|clement|point lobos|cliff house|sutro baths?|94121)\b/i;
const OCEAN_BEACH = [/ocean beach/i, 37.75939, -122.51073];
const STREETS = "irving|judah|noriega|taraval|sloat|ortega|quintara|kirkham|lawton|moraga|santiago|rivera|vicente|wawona";
const STREET_RE = new RegExp(
  [
    `\\b(?:${STREETS})\\s+(?:st|street|blvd|boulevard|ave|avenue)\\b`, // "Irving St"
    `\\b(?:${STREETS})\\s*(?:&|and|at|@|\\/)\\s*\\d{1,2}(?:st|nd|rd|th)\\b`, // "Irving & 22nd"
    `\\b\\d{1,2}(?:st|nd|rd|th)\\s*(?:ave(?:nue)?\\.?)?\\s*(?:&|and|at|@|\\/)\\s*(?:${STREETS})\\b`, // "22nd Ave & Irving"
    `\\blincoln\\s+way\\b`,
    `\\b(?:upper\\s+)?great\\s+h(?:igh)?wa?y\\b`,
  ].join("|"),
  "i",
);

/**
 * Decide whether a coordinate-less venue/address is in the district.
 * Order: gazetteer (gives coords) -> ZIP (94122/94116 yes, other 9xxxx no)
 * -> Sunset street names. Only venue/address text should be passed in.
 */
export function locateByText(text, box = SUNSET_BOX) {
  const t = (squash(decodeEntities(text || "")) || "").replace(/[‘’`´]/g, "'");
  if (!t) return { ok: false, lat: null, lng: null };
  const zips = t.match(/\b9[0-9]{4}\b/g) || [];
  if (zips.length && zips.every((z) => !z.startsWith("941"))) return { ok: false, lat: null, lng: null }; // not San Francisco
  for (const [re, lat, lng] of GAZETTEER) {
    if (re.test(t)) return inBox(box, lat, lng) ? { ok: true, lat, lng } : { ok: false, lat: null, lng: null };
  }
  if (OCEAN_BEACH[0].test(t) && !RICHMOND_HINT.test(t)) {
    return inBox(box, OCEAN_BEACH[1], OCEAN_BEACH[2]) ? { ok: true, lat: OCEAN_BEACH[1], lng: OCEAN_BEACH[2] } : { ok: false, lat: null, lng: null };
  }
  if (zips.some((z) => z === "94122" || z === "94116")) return { ok: true, lat: null, lng: null };
  if (zips.length) return { ok: false, lat: null, lng: null };
  if (STREET_RE.test(t) && !RICHMOND_HINT.test(t)) return { ok: true, lat: null, lng: null };
  return { ok: false, lat: null, lng: null };
}

/**
 * Optional second pass. The bounding box is a rectangle, so it also catches
 * West Portal / St. Francis Wood (94127), the Ocean Ave strip (94132), the
 * west end of Haight St east of Stanyan (94117) and Parnassus (94143).
 * This drops coordinate-matched events whose own address names a ZIP other
 * than 94122/94116, or a neighbourhood that is not the Sunset, unless the
 * venue is a known in-district place (Golden Gate Park venues, Stern Grove,
 * the Zoo, Ocean Beach). Events with no ZIP and no neighbourhood name pass.
 */
const GGP_ROADS = /\b(martin luther king,? jr\.? (dr|drive)|mlk (jr\.? )?(dr|drive)|hagiwara tea garden (dr|drive)|music concourse (dr|drive)|nancy pelosi (dr|drive)|bowling green (dr|drive)|stow lake (dr|drive)|chain of lakes (dr|drive)|blue heron (lake )?(dr|drive)|kezar (dr|drive)|transverse (dr|drive))\b/i;
const NOT_SUNSET = /\b(west portal|st\.? francis wood|forest hill|haight|cole valley|lakeshore|stonestown|parnassus|laguna honda|mt\.? davidson|ingleside|richmond)\b/i;
export function refineToDistrict(events) {
  return events.filter((e) => {
    const t = (squash(decodeEntities([e.venue, e.address].filter(Boolean).join(" | "))) || "").replace(/[‘’`´]/g, "'");
    if (!t) return true;
    if (GAZETTEER.some(([re]) => re.test(t)) || GGP_ROADS.test(t) || /golden gate park/i.test(t)) return true;
    // organisers file Ocean Beach / Great Highway under 94121 as often as 94122; keep unless a Richmond street is named
    if (/ocean beach|great h(igh)?wa?y/i.test(t) && !/\b(balboa|fulton|cabrillo|anza|geary|clement|point lobos|cliff house|sutro)\b/i.test(t)) return true;
    const zips = t.match(/\b9[0-9]{4}\b/g) || [];
    if (zips.some((z) => z === "94122" || z === "94116")) return true;
    if (zips.length) return false;
    return !NOT_SUNSET.test(t);
  });
}

// --- normalization

function makeEvent(source, o) {
  return {
    title: clean(o.title),
    start: o.start || null,
    end: o.end || null,
    allDay: !!o.allDay,
    url: o.url || null,
    venue: clean(o.venue) || null,
    address: clean(o.address)?.replace(/\s*,(\s*,)+/g, ",").replace(/^,\s*|,\s*$/g, "") || null,
    lat: num(o.lat),
    lng: num(o.lng),
    org: clean(o.org) || null,
    source,
    image: o.image || null,
    description: o.description ? clip(o.description, 400) : null,
    free: typeof o.free === "boolean" ? o.free : null,
  };
}

function windowOf(days, now) {
  const from = now.getTime();
  return { from, to: from + days * 86_400_000 };
}

/** Keep events not yet over, starting before the horizon, and not long-running (started >1 day ago). */
function finalize(events, win, keyFn = (e) => `${e.url}|${e.start}`) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (!e || !e.title || !e.start) continue;
    const s = Date.parse(e.start);
    const end = e.end ? Date.parse(e.end) : s;
    if (!Number.isFinite(s)) continue;
    if (s > win.to || s < win.from - 86_400_000) continue;
    if ((Number.isFinite(end) ? end : s) < win.from) continue;
    const k = keyFn(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

async function guarded(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[${name}] failed: ${err?.message || err}`);
    return [];
  }
}

const opts0 = (o = {}) => ({
  box: o.box || SUNSET_BOX,
  days: o.days ?? 60,
  now: o.now ? new Date(o.now) : new Date(),
  budgetMs: o.budgetMs ?? DEFAULT_BUDGET_MS,
});

function extractBalancedJSON(s, from) {
  const start = s.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  return null;
}

// --- iCalendar

function parseICS(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    const p = {};
    for (const kv of params) {
      const j = kv.indexOf("=");
      if (j > 0) p[kv.slice(0, j).toUpperCase()] = kv.slice(j + 1).replace(/^"|"$/g, "");
    }
    cur[name.toUpperCase()] = { value: line.slice(i + 1), params: p };
  }
  return events;
}

const icsText = (prop) =>
  prop ? prop.value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1") : "";

function icsDate(prop) {
  if (!prop) return { iso: null, allDay: false };
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return { iso: null, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || prop.params.VALUE === "DATE") return { iso: wallToISO(+y, +mo, +d), allDay: true };
  if (z || /^(utc|gmt|z)$/i.test(prop.params.TZID || "")) {
    return { iso: toZonedISO(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))), allDay: false };
  }
  let tz = prop.params.TZID || TZ;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = TZ; }
  return { iso: wallToISO(+y, +mo, +d, +h, +mi, +(s || 0), tz), allDay: false };
}

// ====================================================================
// 1. Luma (api.lu.ma discover, lat/lng mode)
// ====================================================================

function prosemirrorText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hard_break") return " ";
  const inner = (node.content || []).map(prosemirrorText).join("");
  return /paragraph|heading|list_item|blockquote/.test(node.type || "") ? inner + " " : inner;
}

export async function fetchLuma(options) {
  return guarded("luma", async () => {
    const { box, days, now, budgetMs } = opts0(options);
    const win = windowOf(days, now);
    const deadline = Date.now() + budgetMs;
    const lat = ((box.minLat + box.maxLat) / 2).toFixed(4);
    const lng = ((box.minLng + box.maxLng) / 2).toFixed(4);
    // Without discover_place_api_id the endpoint returns every discoverable
    // event near latitude/longitude (~70 km), sorted by start_at.
    const base = `https://api.lu.ma/discover/get-paginated-events?latitude=${lat}&longitude=${lng}&pagination_limit=50`;
    const hits = [];
    let cursor = null;
    for (let page = 0; page < 40 && Date.now() < deadline; page++) {
      let d;
      try {
        d = await getJSON(base + (cursor ? `&pagination_cursor=${encodeURIComponent(cursor)}` : ""));
      } catch (err) {
        if (page === 0) throw err;
        console.warn(`[luma] stopped at page ${page}, keeping ${hits.length}: ${err.message}`);
        break;
      }
      for (const entry of d.entries || []) {
        const ev = entry.event || {};
        const c = ev.coordinate || {};
        if (ev.location_type && ev.location_type !== "offline") continue;
        if (!inBox(box, c.latitude, c.longitude)) continue;
        hits.push(entry);
      }
      const last = d.entries?.at(-1)?.start_at;
      if (!d.has_more || !d.next_cursor || (last && Date.parse(last) > win.to)) break;
      cursor = d.next_cursor;
      await sleep(300);
    }

    const out = [];
    let details = 0;
    for (const entry of hits) {
      const ev = entry.event;
      if (Date.parse(ev.start_at) > win.to) continue;
      const g = ev.geo_address_info || {};
      const shown = g.mode === "shown";
      let description = null;
      if (details < 50 && Date.now() < deadline) {
        try {
          details++;
          const det = await getJSON(`https://api.lu.ma/event/get?event_api_id=${encodeURIComponent(ev.api_id)}`);
          description = squash(prosemirrorText(det.description_mirror)) || null;
        } catch (err) {
          console.warn(`[luma] detail ${ev.api_id}: ${err.message}`);
        }
        await sleep(250);
      }
      const tz = ev.timezone || TZ;
      const cal = entry.calendar || {};
      const hosts = (entry.hosts || []).map((h) => h.name).filter(Boolean);
      const ticket = entry.ticket_info || {};
      out.push(
        makeEvent("luma", {
          title: ev.name,
          start: toZonedISO(ev.start_at, tz),
          end: ev.end_at ? toZonedISO(ev.end_at, tz) : null,
          url: `https://luma.com/${ev.url}`,
          venue: shown ? g.address : null,
          // obfuscated events only expose the neighbourhood; the coordinate is jittered
          address: shown ? g.full_address : [g.sublocality, g.city_state].filter(Boolean).join(", ") || null,
          lat: ev.coordinate?.latitude,
          lng: ev.coordinate?.longitude,
          org: !cal.is_personal && cal.name ? cal.name : hosts.join(", ") || null,
          image: ev.cover_url,
          description,
          free: typeof ticket.is_free === "boolean" ? ticket.is_free : null,
        }),
      );
    }
    return finalize(out, win);
  });
}

// ====================================================================
// 2. Eventbrite (destination/search with bbox; needs csrftoken cookie)
// ====================================================================

export async function fetchEventbrite(options) {
  return guarded("eventbrite", async () => {
    const { box, days, now, budgetMs } = opts0(options);
    const win = windowOf(days, now);
    const deadline = Date.now() + budgetMs;
    // 1) any HTML page sets the csrftoken cookie; /signin/ is the lightest (~40 KB)
    const r0 = await http("https://www.eventbrite.com/signin/", { headers: { accept: "text/html" } });
    const cookies = r0.headers.getSetCookie?.() || [];
    await r0.text();
    const csrf = cookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("csrftoken="))?.slice(10);
    if (!csrf) throw new Error("no csrftoken cookie");
    const referer = "https://www.eventbrite.com/d/ca--san-francisco/events/";
    const bbox = `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`;

    const out = [];
    for (let page = 1; page <= 12 && Date.now() < deadline; page++) {
      await sleep(400);
      const body = {
        event_search: { dates: "current_future", dedup: false, bbox, page, page_size: 50, online_events_only: false },
        "expand.destination_event": ["primary_venue", "image", "ticket_availability", "primary_organizer"],
        browse_surface: "search",
      };
      let res;
      try {
        res = await http("https://www.eventbrite.com/api/v3/destination/search/", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "x-csrftoken": csrf,
            "x-requested-with": "XMLHttpRequest",
            referer,
            cookie: `csrftoken=${csrf}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`search HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      } catch (err) {
        if (page === 1) throw err;
        console.warn(`[eventbrite] stopped at page ${page}, keeping ${out.length}: ${err.message}`);
        break;
      }
      const d = await res.json();
      const results = d.events?.results || [];
      for (const e of results) {
        if (e.is_online_event || e.is_cancelled) continue;
        const v = e.primary_venue || {};
        const a = v.address || {};
        const lat = num(a.latitude), lng = num(a.longitude);
        if (!inBox(box, lat, lng)) continue;
        const tz = e.timezone || TZ;
        out.push(
          makeEvent("eventbrite", {
            title: e.name,
            start: wallStringToISO(e.start_date, e.start_time, tz),
            end: e.end_date ? wallStringToISO(e.end_date, e.end_time, tz) : null,
            url: e.url,
            venue: v.name,
            address: a.localized_address_display,
            lat,
            lng,
            org: e.primary_organizer?.name,
            image: e.image?.url || e.image?.original?.url,
            description: e.summary,
            free: e.ticket_availability?.is_free,
          }),
        );
      }
      if (!d.events?.pagination?.continuation || results.length === 0) break;
    }
    return finalize(out, win, (e) => e.url);
  });
}

// ====================================================================
// 3. Meetup (gql2, recommendedEvents by lat/lon/radius; no auth)
// ====================================================================

const MEETUP_QUERY = `query($filter: RecommendedEventsFilter!, $first: Int, $after: String, $sort: RecommendedEventsSort) {
  recommendedEvents(filter: $filter, first: $first, after: $after, sort: $sort) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title description dateTime endTime eventUrl eventType status
      feeSettings { amount currency }
      featuredEventPhoto { highResUrl }
      venue { name address city state postalCode lat lon }
      group { name urlname }
    } }
  }
}`;

export async function fetchMeetup(options) {
  return guarded("meetup", async () => {
    const { box, days, now, budgetMs } = opts0(options);
    const win = windowOf(days, now);
    const deadline = Date.now() + budgetMs;
    // recommendedEvents ranks and truncates each query, so tile the box with
    // six small circles (radius in miles) and union the results.
    const centers = [];
    for (const fy of [0.25, 0.75]) {
      for (const fx of [1 / 6, 0.5, 5 / 6]) {
        centers.push([box.minLat + (box.maxLat - box.minLat) * fy, box.minLng + (box.maxLng - box.minLng) * fx]);
      }
    }
    const startRange = `${toZonedISO(win.from)}[US/Pacific]`;
    const endRange = `${toZonedISO(win.to)}[US/Pacific]`;
    const seen = new Map();
    for (const [lat, lon] of centers) {
      let after = null;
      for (let page = 0; page < 6 && Date.now() < deadline; page++) {
        await sleep(350);
        const res = await http("https://www.meetup.com/gql2", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", origin: "https://www.meetup.com", referer: "https://www.meetup.com/find/" },
          body: JSON.stringify({
            query: MEETUP_QUERY,
            variables: {
              filter: { lat, lon, radius: 1.5, eventType: "PHYSICAL", startDateRange: startRange, endDateRange: endRange },
              first: 50,
              after,
              sort: { sortField: "DATETIME" },
            },
          }),
        });
        const d = res.ok ? await res.json() : null;
        if (!d || d.errors?.length) {
          const msg = d ? `gql2: ${d.errors[0].message}` : `gql2 HTTP ${res.status}`;
          if (seen.size === 0 && lat === centers[0][0] && lon === centers[0][1]) throw new Error(msg);
          console.warn(`[meetup] ${lat.toFixed(3)},${lon.toFixed(3)}: ${msg}`);
          break;
        }
        const rc = d.data?.recommendedEvents;
        for (const { node: e } of rc?.edges || []) {
          if (!e || seen.has(e.id) || e.eventType !== "PHYSICAL" || (e.status && e.status !== "ACTIVE")) continue;
          const v = e.venue || {};
          if (!inBox(box, num(v.lat), num(v.lon))) continue;
          seen.set(
            e.id,
            makeEvent("meetup", {
              title: e.title,
              start: toZonedISO(e.dateTime),
              end: e.endTime ? toZonedISO(e.endTime) : null,
              url: e.eventUrl,
              venue: v.name,
              address: [v.address, v.city, [v.state, v.postalCode].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join(", "),
              lat: v.lat,
              lng: v.lon,
              org: e.group?.name,
              image: e.featuredEventPhoto?.highResUrl,
              description: e.description,
              free: e.feeSettings ? !(num(e.feeSettings.amount) > 0) : true,
            }),
          );
        }
        if (!rc?.pageInfo?.hasNextPage) break;
        after = rc.pageInfo.endCursor;
      }
    }
    return finalize([...seen.values()], win, (e) => e.url);
  });
}

// ====================================================================
// 4. San Francisco Public Library (sfpl.org Drupal calendar view)
// ====================================================================

// BiblioCommons' events gateway is switched off for SFPL ("The Events feature
// is not available at San Francisco Public Library"). sfpl.org's own calendar
// view embeds every event for the filtered branches as JSON.
export const SFPL_BRANCHES = {
  48: { name: "Sunset Branch Library", address: "1305 18th Ave, San Francisco, CA 94122", lat: 37.763385, lng: -122.476292 },
  46: { name: "Ortega Branch Library", address: "3223 Ortega St, San Francisco, CA 94122", lat: 37.751258, lng: -122.498025 },
  55: { name: "Parkside Branch Library", address: "1200 Taraval St, San Francisco, CA 94116", lat: 37.743191, lng: -122.479389 },
};
const SFPL_SHORT = { Sunset: 48, Ortega: 46, Parkside: 55, "West Portal": 50 };

export async function fetchSfpl(options) {
  return guarded("sfpl", async () => {
    const { box, days, now } = opts0(options);
    const win = windowOf(days, now);
    const ids = options?.branches || [48, 46, 55];
    const qs = ids.map((id) => `field_event_location_target_id%5B%5D=${id}`).join("&");
    const html = await getText(`https://sfpl.org/events/calendar?${qs}`, { timeout: 45_000 });
    const m = html.match(/<script type="application\/json" data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error("drupal settings JSON not found");
    const list = JSON.parse(m[1])?.sfplEvents?.events || [];
    const out = [];
    for (const e of list) {
      const ft = e.formatted_title || "";
      const short = clean((ft.match(/field--name-field-event-location[\s\S]*?field__item">([^<]+)</) || [])[1]);
      const branch = SFPL_BRANCHES[SFPL_SHORT[short]] || null;
      if (!branch || !inBox(box, branch.lat, branch.lng)) continue;
      const audience = [...ft.matchAll(/field--name-field-event-audience[\s\S]*?<\/div>\s*<\/div>/g)]
        .map((x) => [...x[0].matchAll(/field__item">([^<]+)</g)].map((y) => clean(y[1])))
        .flat()
        .filter(Boolean);
      out.push(
        makeEvent("sfpl", {
          title: e.title,
          start: toZonedISO(e.start),
          end: e.end ? toZonedISO(e.end) : null,
          url: e.url ? new URL(e.url, "https://sfpl.org").href : null,
          venue: branch.name,
          address: branch.address,
          lat: branch.lat,
          lng: branch.lng,
          org: "San Francisco Public Library",
          description: audience.length ? `Audience: ${audience.join(", ")}.` : null,
          free: true,
        }),
      );
    }
    return finalize(out, win);
  });
}

// ====================================================================
// 5. SF Recreation & Parks (CivicPlus iCalendar, one feed per category)
// ====================================================================

// 41 (Polo Field Cycling Track "open after 6:45 PM" slots) is left out on purpose.
export const RECPARK_CATEGORIES = [14, 22, 28, 29, 30, 32, 33, 34, 35, 37, 39, 40, 42, 43];

export async function fetchRecPark(options) {
  return guarded("recpark", async () => {
    const { box, days, now, budgetMs } = opts0(options);
    const win = windowOf(days, now);
    const deadline = Date.now() + budgetMs;
    const out = [];
    let fails = 0;
    for (const cat of options?.categories || RECPARK_CATEGORIES) {
      if (Date.now() > deadline || fails >= 3) break;
      let ics;
      try {
        ics = await getText(`https://sfrecpark.org/common/modules/iCalendar/iCalendar.aspx?catID=${cat}&feed=calendar`);
        fails = 0;
      } catch (err) {
        fails++;
        console.warn(`[recpark] cat ${cat}: ${err.message}`);
        continue;
      } finally {
        await sleep(300);
      }
      for (const v of parseICS(ics)) {
        const loc = squash(htmlToText(icsText(v.LOCATION))) || "";
        // LOCATION is "<facility> - <street address>"; the facility part is often blank
        let venue = null, address = loc || null;
        const cut = loc.indexOf(" - ");
        if (/^-\s/.test(loc)) address = squash(loc.slice(2)) || null;
        else if (cut >= 0) { venue = squash(loc.slice(0, cut)) || null; address = squash(loc.slice(cut + 3)) || null; }
        const where = locateByText([venue, address].filter(Boolean).join(" | "), box);
        if (!where.ok) continue;
        const s = icsDate(v.DTSTART);
        const e = icsDate(v.DTEND);
        const descRaw = icsText(v.DESCRIPTION);
        const eid = (descRaw.match(/calendar\.aspx\?EID=(\d+)/i) || [])[1] || v.UID?.value;
        out.push(
          makeEvent("recpark", {
            title: icsText(v.SUMMARY),
            start: s.iso,
            end: e.iso,
            allDay: s.allDay,
            url: eid ? `https://sfrecpark.org/Calendar.aspx?EID=${eid}` : "https://sfrecpark.org/Calendar.aspx",
            venue,
            address,
            lat: where.lat,
            lng: where.lng,
            org: "San Francisco Recreation & Parks",
            description: descRaw.replace(/https?:\/\/\S+/g, "").trim() || null,
          }),
        );
      }
    }
    return finalize(out, win);
  });
}

// ====================================================================
// 6. Funcheap SF (region archive pages + per-event JSON-LD)
// ====================================================================

export const FUNCHEAP_REGIONS = ["sunset-district", "golden-gate-park", "ocean-beach"];

function parseFuncheapListing(html, region) {
  const items = [];
  const re = /<div id="post-(\d+)" class="tanbox left[^"]*">([\s\S]*?)(?=<div id="post-\d+" class="tanbox|<div class="tanbox see-more|<div class='archive_date_title'|<\/main>|$)/g;
  for (const m of html.matchAll(re)) {
    const block = m[2];
    const link = block.match(/<span class="title entry-title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const dt = block.match(/data-event-date="([^"]+)"(?:\s+data-event-date-end="([^"]*)")?/);
    if (!link || !dt) continue;
    // the meta div holds a nested tooltip div, so cut at the thumbnail instead of the first </div>
    const metaRaw = (block.match(/<div class="meta archive-meta date-time[^"]*"[^>]*>([\s\S]*?)<div class="thumbnail-wrapper/) || [])[1] || "";
    const meta = metaRaw.replace(/<div class="tooltip">[\s\S]*?<div class="bottom"><\/div>\s*<\/div>/g, "");
    const metaText = squash(htmlToText(meta)) || "";
    const cost = clean((metaText.match(/Cost:\s*([^|]*)/i) || [])[1] || "");
    const spans = [...meta.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => clean(htmlToText(x[1])));
    const allDay = /all day/i.test(metaText);
    items.push({
      id: m[1],
      url: link[1],
      title: clean(htmlToText(link[2])),
      startWall: dt[1],
      endWall: dt[2] || null,
      cost,
      venue: spans.at(-1) || null,
      allDay,
      region,
      teaser: clean(htmlToText((block.match(/<p>([\s\S]*?)<\/p>/) || [])[1] || "")),
    });
  }
  return items;
}

function funcheapFree(cost, offers) {
  if (cost) {
    if (/free/i.test(cost) && !/\$\s*[1-9]/.test(cost)) return true;
    if (/\$\s*[1-9]/.test(cost)) return false;
  }
  const o = Array.isArray(offers) ? offers[0] : offers;
  if (o && o.price !== undefined && o.price !== "") return !(parseFloat(o.price) > 0);
  return null;
}

export async function fetchFuncheap(options) {
  return guarded("funcheap", async () => {
    const { box, days, now, budgetMs } = opts0(options);
    const win = windowOf(days, now);
    const deadline = Date.now() + budgetMs;
    const listing = [];
    for (const region of options?.regions || FUNCHEAP_REGIONS) {
      for (let page = 1; page <= 4 && Date.now() < deadline; page++) {
        const url = `https://sf.funcheap.com/region/${region}/${page > 1 ? `page/${page}/` : ""}`;
        let html;
        try {
          html = await getText(url);
        } catch (err) {
          if (page === 1) console.warn(`[funcheap] ${region}: ${err.message}`);
          break;
        } finally {
          await sleep(350);
        }
        const items = parseFuncheapListing(html, region);
        listing.push(...items);
        const last = items.at(-1);
        if (!items.length || !/\/page\/\d+\//.test(html) || (last && Date.parse(wallStringToISO(last.startWall)) > win.to)) break;
      }
    }
    // one row per post URL + start (recurring posts repeat on each date)
    const uniq = new Map();
    for (const it of listing) {
      const start = wallStringToISO(it.startWall);
      if (!start || Date.parse(start) > win.to) continue;
      const k = `${it.url}|${start}`;
      if (!uniq.has(k)) uniq.set(k, { ...it, start });
    }
    const rows = [...uniq.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    const detailCache = new Map();
    let fetched = 0;
    const out = [];
    for (const it of rows) {
      let ld = detailCache.get(it.url);
      if (ld === undefined && fetched < 60 && Date.now() < deadline) {
        fetched++;
        ld = null;
        try {
          const html = await getText(it.url);
          for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
            try {
              const j = JSON.parse(m[1]);
              const ev = [j, ...(j["@graph"] || [])].find((x) => x && x["@type"] === "Event");
              if (ev) { ld = ev; break; }
            } catch { /* other JSON-LD blocks */ }
          }
          const og = html.match(/<meta property="og:image" content="([^"]+)"/);
          if (ld && og) ld.__ogImage = og[1];
        } catch (err) {
          console.warn(`[funcheap] detail ${it.url}: ${err.message}`);
        }
        detailCache.set(it.url, ld);
        await sleep(300);
      }
      const loc = ld?.location || {};
      const addr = typeof loc.address === "string" ? loc.address : [loc.address?.streetAddress, loc.address?.addressLocality, loc.address?.postalCode].filter(Boolean).join(", ");
      const venue = clean(loc.name) || it.venue;
      let where = locateByText([venue, addr].filter(Boolean).join(" | "), box);
      // Editors tag "Sunset District" by hand; trust it unless the address points elsewhere.
      if (!where.ok && it.region === "sunset-district" && !(addr && /\b9\d{4}\b/.test(addr))) {
        where = { ok: true, lat: null, lng: null };
      }
      if (!where.ok) continue;
      out.push(
        makeEvent("funcheap", {
          title: it.title,
          start: it.start,
          end: it.endWall ? wallStringToISO(it.endWall) : null,
          allDay: it.allDay,
          url: it.url,
          venue,
          address: addr || null,
          lat: where.lat,
          lng: where.lng,
          // JSON-LD only has the 80x80 crop; the WordPress original sits next to it
          image: ld?.__ogImage || (typeof ld?.image === "string" ? ld.image.replace(/-\d+x\d+(?=\.\w+$)/, "") : null),
          description: ld?.description ? htmlToText(ld.description) : it.teaser,
          free: funcheapFree(it.cost, ld?.offers),
        }),
      );
    }
    // Funcheap often double-posts the same listing under two URLs
    return finalize(out, win, (e) => `${e.title.toLowerCase()}|${e.start}`);
  });
}

// ====================================================================
// AllEvents.in is deliberately absent. During research it answered with
// Cloudflare 529 "Unauthorized Crawling Reported", and most of its Sunset
// rows were Eventbrite copies. Do not add it back without its permission.
// ====================================================================

// ====================================================================
// 8. DoTheBay / Do415 (DoStuff Media .json views)
// ====================================================================

// In-district venues seen on DoTheBay (October 2026). Always polled, on top of
// whatever the daily scan discovers.
export const DOTHEBAY_SEED_VENUES = [
  "/venues/san-francisco-county-fair-building",
  "/venues/california-academy-of-sciences",
  "/venues/de-young-museum",
  "/venues/san-francisco-botanical-garden",
  "/venues/robin-williams-meadow",
  "/venues/golden-gate-park",
  "/venues/irving-street",
  "/venues/the-riptide",
];

export async function fetchDoTheBay(options) {
  return guarded("dothebay", async () => {
    const { box, days, now, budgetMs } = opts0(options);
    const win = windowOf(days, now);
    const deadline = Date.now() + budgetMs;
    const scanDays = Math.min(days, options?.scanDays ?? 14);
    const venueOk = (v) => {
      if (!v) return { ok: false };
      const lat = num(v.latitude), lng = num(v.longitude);
      if (lat !== null && lng !== null) return { ok: inBox(box, lat, lng), lat, lng };
      return locateByText([v.title, v.full_address].filter(Boolean).join(" | "), box);
    };
    const venues = new Set(options?.seedVenues || DOTHEBAY_SEED_VENUES);
    const events = new Map();
    const take = (e) => {
      if (!e?.venue || events.has(e.id)) return;
      const where = venueOk(e.venue);
      if (!where.ok) return;
      venues.add(e.venue.permalink);
      events.set(e.id, { e, where });
    };
    let fails = 0; // stop hammering a host that is blocking us
    // 1) day-by-day scan to discover in-box venues (and grab their events)
    for (let i = 0; i < scanDays && Date.now() < deadline && fails < 3; i++) {
      const day = new Date(win.from + i * 86_400_000);
      const [y, mo, d] = toZonedISO(day).slice(0, 10).split("-").map(Number);
      for (let page = 1; page <= 10 && Date.now() < deadline; page++) {
        await sleep(200);
        let j;
        try {
          j = await getJSON(`https://dothebay.com/events/${y}/${mo}/${d}.json?page=${page}`);
          fails = 0;
        } catch (err) {
          fails++;
          console.warn(`[dothebay] ${y}-${mo}-${d} p${page}: ${err.message}`);
          break;
        }
        (j.events || []).forEach(take);
        if (page >= (j.paging?.total_pages || 1)) break;
      }
    }
    // 2) every upcoming event at each in-box venue (covers the rest of the window)
    for (const permalink of venues) {
      if (fails >= 3) break;
      for (let page = 1; page <= 3 && Date.now() < deadline; page++) {
        await sleep(250);
        let j;
        try {
          j = await getJSON(`https://dothebay.com${permalink}.json${page > 1 ? `?page=${page}` : ""}`);
          fails = 0;
        } catch (err) {
          fails++;
          console.warn(`[dothebay] ${permalink}: ${err.message}`);
          break;
        }
        for (const g of j.event_groups || []) for (const e of g.events || []) take({ ...e, venue: e.venue || j.venue });
        if (page >= (j.paging?.total_pages || 1)) break;
      }
    }
    const out = [];
    for (const { e, where } of events.values()) {
      const v = e.venue;
      const hasEnd = !!(e.end_time || e.end_date);
      out.push(
        makeEvent("dothebay", {
          title: e.title,
          start: e.tz_adjusted_begin_date ? toZonedISO(e.tz_adjusted_begin_date) : null,
          end: hasEnd && e.tz_adjusted_end_date ? toZonedISO(e.tz_adjusted_end_date) : null,
          url: `https://dothebay.com${e.permalink}`,
          venue: v.title,
          address: v.full_address,
          lat: where.lat ?? null,
          lng: where.lng ?? null,
          org: e.presented_by || null,
          image: e.imagery?.aws?.cover_image_h_630_w_1200 || e.imagery?.aws?.image || null,
          description: e.excerpt,
          free: typeof e.is_free === "boolean" ? e.is_free : null,
        }),
      );
    }
    return finalize(out, win, (e) => e.url);
  });
}

// ====================================================================
// 9. SF.gov events (Wagtail API behind www.sf.gov/events)
// ====================================================================

export async function fetchSfgov(options) {
  return guarded("sfgov", async () => {
    const { box, days, now } = opts0(options);
    const win = windowOf(days, now);
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const d = await getJSON(`https://api.sf.gov/api/related-events/?list=upcoming&locale=en&page=${page}&page_size=100`);
      const rows = d.events || [];
      for (const e of rows) {
        const addr = (e.location || []).find((l) => l.type === "address")?.value;
        if (!addr) continue;
        const address = [addr.line1, addr.line2, addr.city, [addr.state, addr.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        const where = locateByText([addr.location_name, address].filter(Boolean).join(" | "), box);
        if (!where.ok) continue;
        const dt = e.date_time?.[0]?.value || {};
        out.push(
          makeEvent("sfgov", {
            title: e.title,
            start: e.start_datetime ? toZonedISO(e.start_datetime) : null,
            end: e.end_datetime ? toZonedISO(e.end_datetime) : null,
            allDay: !!dt.is_all_day,
            url: e.meta?.slug ? `https://www.sf.gov/${e.meta.slug}` : null,
            venue: addr.location_name || addr.address_title,
            address,
            lat: where.lat,
            lng: where.lng,
            org: e.primary_agency?.title,
            description: e.description,
          }),
        );
      }
      if (rows.length < 100 || page * 100 >= (d.total || 0)) break;
      await sleep(300);
    }
    return finalize(out, win);
  });
}

// ====================================================================
// 10. Gardens of Golden Gate Park (The Events Calendar REST)
//     SF Botanical Garden, Japanese Tea Garden, Conservatory of Flowers
// ====================================================================

// ====================================================================
// 11. Sunset Dunes park calendar (Squarespace ?format=json)
// ====================================================================

// ====================================================================

export const FETCHERS = {
  luma: fetchLuma,
  eventbrite: fetchEventbrite,
  meetup: fetchMeetup,
  sfpl: fetchSfpl,
  recpark: fetchRecPark,
  funcheap: fetchFuncheap,
  dothebay: fetchDoTheBay,
  sfgov: fetchSfgov,
};

/** Sources run by default. AllEvents.in is left out on purpose: it blocks crawlers. */
export const DEFAULT_SOURCES = Object.keys(FETCHERS);

/** Run fetchers in parallel (each one is sequential inside). Returns { events, bySource, ms }. */
export async function fetchAll(options = {}, only = DEFAULT_SOURCES) {
  const t0 = Date.now();
  const bySource = {};
  await Promise.all(
    only.map(async (name) => {
      const t = Date.now();
      const events = await FETCHERS[name](options);
      bySource[name] = { events, ms: Date.now() - t };
    }),
  );
  const events = Object.values(bySource).flatMap((s) => s.events).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { events, bySource, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------- CLI

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  const days = arg("days") ? +arg("days") : 60;
  const only = arg("only") ? arg("only").split(",") : DEFAULT_SOURCES;
  const { events, bySource, ms } = await fetchAll({ days }, only);
  const fmt = (iso) => (iso ? iso.slice(0, 16).replace("T", " ") : "?");
  console.log(`\nSunset box ${JSON.stringify(SUNSET_BOX)}, next ${days} days, run ${(ms / 1000).toFixed(1)}s\n`);
  for (const name of only) {
    const s = bySource[name];
    const withCoords = s.events.filter((e) => e.lat !== null).length;
    console.log(`${name.padEnd(12)} ${String(s.events.length).padStart(4)} events  (${withCoords} with lat/lng, ${(s.ms / 1000).toFixed(1)}s)`);
    for (const e of s.events.slice(0, 3)) {
      console.log(`    ${fmt(e.start)}  ${e.title.slice(0, 70)}  @ ${e.venue || e.address || "?"}`);
    }
  }
  console.log(`${"TOTAL".padEnd(12)} ${String(events.length).padStart(4)} events (before cross-source dedupe)`);
  const refined = refineToDistrict(events);
  const dropped = {};
  for (const e of events) if (!refined.includes(e)) dropped[e.source] = (dropped[e.source] || 0) + 1;
  console.log(`refineToDistrict() keeps ${refined.length}; drops ${events.length - refined.length} edge-of-box events ${JSON.stringify(dropped)}`);
  const out = arg("out");
  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, JSON.stringify(events, null, 2));
    console.log(`wrote ${out}`);
  }
}
