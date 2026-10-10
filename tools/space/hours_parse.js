// Turn rendered page text / JSON-LD into an OSM-style opening_hours string.
// per[d] = array of [openMin, closeMin] (closeMin may exceed 1440 for after-midnight), or [] for a closed day. d: 0=Mon..6=Sun.
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY = '(?:monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)(?![a-z])';
const DAYSPEC = `(?<![a-z])(?:${DAY}(?:\\s*(?:-|to|through|thru)\\s*${DAY})?(?:\\s*(?:,|&|and|\\+|/)\\s*${DAY}(?:\\s*(?:-|to|through|thru)\\s*${DAY})?)*|daily|every ?day|weekdays|weekends)`;
const T = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?|noon|midnight)';
const RANGE = `${T}\\s*(?:-|to|until|till)\\s*${T}`;
const ENTRY = new RegExp(`(${DAYSPEC})\\s*[:|,.]?\\s*(?:\\|\\s*)?(closed|${RANGE}(?:\\s*(?:,|&|and|\\|)\\s*${RANGE})*)`, 'g');
const BAD_CONTEXT = /(happy hour|delivery|pick-?up|take-?out|kitchen|brunch|special|lunch menu|dinner menu|reservation|bar hours|order online|breakfast only|holiday|thanksgiving|christmas|new year)/;
// Meal services listed as separate blocks (dinner, then weekend brunch) are all open hours.
const MEAL_CONTEXT = /(brunch|lunch|breakfast|dinner)\s*[|:]?\s*$/;

const dayIdx = s => ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'].indexOf(s.slice(0, 2));

function expandDays(spec) {
  spec = spec.trim();
  if (/^(daily|every ?day)$/.test(spec)) return [0, 1, 2, 3, 4, 5, 6];
  if (spec === 'weekdays') return [0, 1, 2, 3, 4];
  if (spec === 'weekends') return [5, 6];
  const out = new Set();
  for (const part of spec.split(/\s*(?:,|&|and|\+|\/)\s*/)) {
    const m = part.match(new RegExp(`^(${DAY})(?:\\s*(?:-|to|through|thru)\\s*(${DAY}))?$`));
    if (!m) continue;
    const a = dayIdx(m[1]);
    if (!m[2]) { out.add(a); continue; }
    const b = dayIdx(m[2]);
    for (let d = a, n = 0; n < 7; n++, d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  }
  return [...out];
}

function tok(s) {
  s = s.trim();
  if (s === 'noon') return { h: 12, mi: 0, mer: 'p', lead0: false };
  if (s === 'midnight') return { h: 12, mi: 0, mer: 'a', lead0: false };
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m?\.?)?$/);
  if (!m) return null;
  const h = +m[1], mi = +(m[2] || 0);
  if (h > 24 || mi > 59) return null;
  return { h, mi, mer: m[3] || null, lead0: /^0\d/.test(s) };
}
const to24 = (t, mer) => {
  if (!mer) return t.h * 60 + t.mi;
  const h = t.h === 12 ? 0 : t.h;
  return (mer === 'p' ? h + 12 : h) * 60 + t.mi;
};

function parseRange(str, prevEnd = 0) {
  const m = str.match(new RegExp(`^(${T})\\s*(?:-|to|until|till)\\s*(${T})$`));
  if (!m) return null;
  const a = tok(m[1]), b = tok(m[2]);
  if (!a || !b) return null;
  let am = a.mer, bm = b.mer;
  const is24 = !am && !bm && (a.h > 12 || b.h > 12 || a.h === 0 || a.lead0 || b.lead0 || a.mi || b.mi) && (a.h > 12 || b.h > 12 || a.lead0 || b.lead0);
  let s, e;
  if (is24) { s = a.h * 60 + a.mi; e = b.h * 60 + b.mi; }
  else {
    if (!am && !bm) {
      // ambiguous like "3:30-6": pick the reading that follows the previous range of the day
      // a bare "12" opening the day is noon, not midnight ("Friday 12:00- 5:00")
      const tries = a.h === 12 ? [['p', 'p'], ['a', 'p'], ['a', 'a']] : [['a', 'p'], ['p', 'p'], ['a', 'a']];
      [am, bm] = tries.find(([x, y]) => to24(a, x) >= prevEnd && to24(b, y) > to24(a, x)) || tries[0];
    }
    else if (!am) { am = bm; if (to24(a, am) >= to24(b, bm)) am = bm === 'p' ? 'a' : 'p'; }
    else if (!bm) { bm = am; if (to24(b, bm) <= to24(a, am)) bm = am === 'a' ? 'p' : 'a'; }
    s = to24(a, am); e = to24(b, bm);
    if (e === 0 && b.h === 12 && bm === 'a') e = 1440;
  }
  if (e === 0) e = 1440;
  return [s, e];
}

function mergeRanges(rs) {
  const a = rs.map(([s, e]) => [s, e <= s ? e + 1440 : e]).sort((x, y) => x[0] - y[0]), out = [];
  for (const r of a) { const l = out[out.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else out.push(r.slice()); }
  return out.map(([s, e]) => [s, e > 1440 ? e - 1440 : e]);
}

const hh = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function sane(per) {
  if (per.filter(r => r.length).length < 4) return false;
  const all24 = per.every(r => r.length === 1 && r[0][0] === 0 && r[0][1] >= 1439);
  if (all24) return false; // placeholder 24/7 claims from website templates
  for (const rs of per) for (const [s, e0] of rs) {
    const e = e0 <= s ? e0 + 1440 : e0;
    if (e - s > 18 * 60 || e - s < 30) return false;     // "09:00-06:00" style AM/PM slips
    if (s > 0 && s < 5 * 60) return false;                // nobody opens at 3:30 AM
    if (s === 0 && e > 6 * 60 && e < 1440) return false;  // "00:00-17:00" is a misread noon, not the tail of a late night
    if (e > 1440 + 5 * 60) return false;
  }
  return true;
}

function toOsm(per) {
  const close = (s, e) => { const x = e <= s ? e + 1440 : e; return x === 1440 ? '24:00' : hh(x % 1440); };
  return DAYS.map((d, i) => per[i].length ? `${d} ` + per[i].map(([s, e]) => `${hh(s)}-${close(s, e)}`).join(',') : `${d} off`).join('; ');
}

function normText(t) {
  return t.toLowerCase().replace(/[\u2013\u2014\u2012\u2212]/g, '-').replace(/\u00a0/g, ' ').replace(/\s*\n\s*/g, ' | ').replace(/[ \t]+/g, ' ')
    // "Mon.:" and "Tues." as written on many sites
    .replace(/(?<![a-z])(mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\.(?=\s|-|:|,)/g, '$1')
    // "Saturday · today" and "Monday (today)" in hours widgets
    .replace(/(?<![a-z])(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*(?:[·•\-|(]\s*)?today\)?/g, '$1')
    // "Saturdays 10 am - 5 pm"
    .replace(/(?<![a-z])(mon|tues|wednes|thurs|fri|satur|sun)days(?![a-z])/g, '$1day')
    // "open 7 days a week", "seven days" and "everyday" mean daily
    .replace(/(?<![a-z])(?:open\s+)?(?:7|seven)\s+days(?:\s+a\s+week)?(?![a-z])/g, 'daily');
}

function fromText(raw) {
  const text = normText(raw);
  const entries = [];
  ENTRY.lastIndex = 0;
  let m;
  while ((m = ENTRY.exec(text))) {
    const days = expandDays(m[1]);
    if (!days.length) continue;
    let ranges = [];
    if (m[2] === 'closed') ranges = [];
    else {
      const parts = m[2].split(/\s*(?:,|&|and|\|)\s*/);
      let prev = 0;
      for (const p of parts) { const r = parseRange(p, prev); if (r) { ranges.push(r); prev = r[1]; } }
      if (!ranges.length) continue;
    }
    entries.push({ i: m.index, end: m.index + m[0].length, days, ranges, txt: m[0] });
  }
  // cluster nearby entries
  const clusters = [];
  for (const e of entries) {
    const c = clusters[clusters.length - 1];
    if (c && e.i - c.end < 70) { c.items.push(e); c.end = e.end; }
    else clusters.push({ items: [e], start: e.i, end: e.end });
  }
  let best = null;
  for (const c of clusters) {
    const ctx = text.slice(Math.max(0, c.start - 60), c.start);
    if (BAD_CONTEXT.test(ctx)) continue;
    const per = Array(7).fill(null);
    let prevEnd = c.start, meal = false, again = false;
    for (const it of c.items) {
      // Days listed again under "Brunch" or "Lunch" add hours; listed again otherwise
      // (summer hours, a second location), the first listing stands.
      meal = meal || /(brunch|lunch|breakfast|dinner)/.test(text.slice(prevEnd, it.i));
      for (const d of it.days) {
        if (per[d] === null) per[d] = it.ranges;
        else if (meal) per[d] = mergeRanges(per[d].concat(it.ranges));
        else if (JSON.stringify(per[d]) !== JSON.stringify(it.ranges)) again = true;
      }
      prevEnd = it.end;
    }
    const covered = per.filter(x => x !== null).length;
    if (covered < 5) continue;
    const near = /(hours|open|opening)/.test(text.slice(Math.max(0, c.start - 120), c.start)) ? 3 : 0;
    const score = covered + near;
    if (!best || score > best.score) best = { per, score, covered, again, snippet: text.slice(c.start, c.end).slice(0, 220) };
  }
  if (!best) return null;
  const per = best.per.map(x => x === null ? [] : x.slice());
  // Fold in nearby meal blocks ("Brunch Sat-Sun 9:30am-2pm" under the dinner hours), so a
  // restaurant is not shown closed while it serves brunch.
  const bestC = clusters.find(c => text.slice(c.start, c.end).slice(0, 220) === best.snippet);
  for (const c of clusters) {
    if (c === bestC || !bestC || Math.abs(c.start - bestC.end) > 800 || !MEAL_CONTEXT.test(text.slice(Math.max(0, c.start - 40), c.start))) continue;
    for (const it of c.items) for (const d of it.days) per[d] = mergeRanges(per[d].concat(it.ranges));
  }
  if (!sane(per)) return null;
  // several: the same block gives a day two different schedules (sales and service, two
  // locations, summer hours), so which one is this place's is a guess.
  return { oh: toOsm(per), snippet: best.snippet, several: best.again };
}

function specToPer(specs) {
  const per = Array(7).fill(null).map(() => []);
  let any = false;
  for (const s of Array.isArray(specs) ? specs : [specs]) {
    if (!s || typeof s !== 'object') continue;
    let days = s.dayOfWeek || [];
    days = Array.isArray(days) ? days : [days];
    const mm = x => { const m = String(x || '').match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
    const o = mm(s.opens); let c = mm(s.closes);
    if (o === null || c === null) continue;
    if (c === 0) c = 1440;
    for (const d of days) {
      const k = dayIdx(String(d).split('/').pop().toLowerCase());
      if (k >= 0 && o !== c) { per[k].push([o, c]); any = true; }
    }
  }
  return any ? per : null;
}

function fromOhStrings(vals) {
  const per = Array(7).fill(null).map(() => []);
  let any = false;
  // One rule per string or several split by ";", each with one or more time ranges:
  // "Sa-Su 12:00-15:00,17:00-23:00".
  const rules = (Array.isArray(vals) ? vals : [vals]).flatMap(v => String(v).split(';'));
  const full = { mo: 'mon', tu: 'tue', we: 'wed', th: 'thu', fr: 'fri', sa: 'sat', su: 'sun' };
  const ONE = '\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}';
  for (const raw of rules) {
    const txt = normText(raw).trim().replace(/(?<![a-z])(mo|tu|we|th|fr|sa|su)(?![a-z])/g, x => full[x]);
    const m = txt.match(new RegExp(`^(${DAYSPEC})\\s+(${ONE}(?:\\s*,\\s*${ONE})*)$`));
    if (!m) continue;
    const days = expandDays(m[1]);
    for (const r of m[2].match(new RegExp(ONE, 'g'))) {
      const [a, b] = r.split('-').map(x => x.trim().split(':'));
      for (const d of days) { per[d].push([+a[0] * 60 + +a[1], (+b[0] * 60 + +b[1]) || 1440]); any = true; }
    }
  }
  return any ? per : null;
}

function* walk(n) {
  if (Array.isArray(n)) for (const v of n) yield* walk(v);
  else if (n && typeof n === 'object') { yield n; for (const v of Object.values(n)) yield* walk(v); }
}

// houseNumber: skip entries whose own address is a different building (a hospital's page
// listing its clinics gives the hospital's own hours).
function fromJsonLd(texts, houseNumber) {
  for (const t of texts) {
    let data;
    try { data = JSON.parse(t); } catch { continue; }
    for (const n of walk(data)) {
      const street = n.address && (typeof n.address === 'string' ? n.address : n.address.streetAddress);
      if (houseNumber && street && !new RegExp(`(^|\\D)${houseNumber}(\\D|$)`).test(String(street))) continue;
      let per = null;
      if (n.openingHoursSpecification) per = specToPer(n.openingHoursSpecification);
      if (!per && n.openingHours) per = fromOhStrings(n.openingHours);
      // here: the entry names this building, not just the organisation behind it.
      if (per && sane(per)) return { oh: toOsm(per), snippet: 'schema.org JSON-LD', here: !!(houseNumber && street) };
    }
  }
  return null;
}

// Squarespace sites keep the owner's hours as data: Static.SQUARESPACE_CONTEXT.website.businessHours
// = { monday: { text, ranges: [{ from: 540, to: 1020 }] }, ... } with minutes after midnight.
function fromSquarespace(bh) {
  if (!bh || typeof bh !== 'object') return null;
  const names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const per = names.map(n => ((bh[n] && bh[n].ranges) || [])
    .map(r => [+r.from, +r.to === 0 ? 1440 : +r.to])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a !== b));
  if (!sane(per)) return null;
  return { oh: toOsm(per), snippet: 'Squarespace business hours' };
}

// Hours printed next to this place's own address or phone number, for sites that list
// several locations on one page. needles: lower-case strings, e.g. "2308 taraval".
function fromTextNear(raw, needles) {
  const low = raw.toLowerCase();
  for (const n of needles.filter(Boolean)) {
    let i = low.indexOf(n);
    while (i !== -1) {
      // What follows the address first, then just before it.
      const hit = fromText(raw.slice(i, i + 900)) || fromText(raw.slice(Math.max(0, i - 700), i + n.length));
      if (hit) return hit;
      i = low.indexOf(n, i + n.length);
    }
  }
  return null;
}

// Weekly hours inside any JSON a site loads: ordering and site-builder platforms (Square
// Online, Toast, Wix, Popmenu and others) keep the owner's hours as data and draw them with
// script, so the page text alone often misses them. Recognises:
//   { monday: "9am-5pm" | {open, close} | [{start, end}], tuesday: ..., ... }
//   [{ day | dayOfWeek | weekday: "Monday" | 1, open | start | from: "09:00", close | end | to: "17:00" }]
//   { periods: [{ openDay: "MONDAY", openTime: "09:00", closeTime: "17:00" }] }       (Wix)
//   { periods: [{ open: { day: 1, time: "0900" }, close: { day: 1, time: "1700" } }] } (Google style)
const WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const dayOf = v => {
  if (typeof v === 'number') return null;   // numbering differs between platforms; names only
  const k = dayIdx(String(v || '').toLowerCase().replace(/^.*\//, '').slice(0, 3));
  return k >= 0 ? k : null;
};
function minutesOf(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v >= 0 && v <= 1440 ? v : null;        // minutes after midnight
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?m?\.?$/) || s.match(/^(\d{1,2})\s*([ap])\.?m\.?$/);
  if (m && m.length === 3) m = [m[0], m[1], '00', m[2]];
  if (m) { let h = +m[1]; const mi = +m[2]; if (m[3]) { h = h % 12 + (m[3] === 'p' ? 12 : 0); } return h <= 24 && mi < 60 ? h * 60 + mi : null; }
  m = s.match(/^(\d{2})(\d{2})$/);                                       // "0930"
  if (m) return +m[1] * 60 + +m[2];
  m = s.match(/t(\d{2}):(\d{2})/);                                       // ISO date-time
  return m ? +m[1] * 60 + +m[2] : null;
}
const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
const OPEN = ['open', 'opens', 'start', 'startTime', 'start_time', 'from', 'openTime', 'open_time', 'opening', 'begin'];
const CLOSE = ['close', 'closes', 'end', 'endTime', 'end_time', 'to', 'closeTime', 'close_time', 'closing'];
function rangeOf(o) {
  if (typeof o === 'string') return null;
  let a = pick(o, OPEN), b = pick(o, CLOSE);
  if (a && typeof a === 'object') a = pick(a, ['time', 'hour', 'value']);
  if (b && typeof b === 'object') b = pick(b, ['time', 'hour', 'value']);
  a = minutesOf(a); b = minutesOf(b);
  if (a === null || b === null || a === b) return null;
  return [a, b === 0 ? 1440 : b];
}
function fromAnyJson(roots) {
  for (const root of roots) {
    for (const n of walk(root)) {
      let per = null;
      // keyed by weekday name
      const keys = Object.keys(n), dayKeys = keys.filter(k => dayOf(k) !== null && /^[a-z]{3,9}$/i.test(k));
      if (dayKeys.length >= 5) {
        per = WEEK.map(() => []);
        for (const k of dayKeys) {
          const v = n[k], d = dayOf(k);
          if (typeof v === 'string') {
            const r = v.toLowerCase().match(/(\d{1,2}(?::\d{2})?\s*[ap]?\.?m?\.?)\s*(?:-|to|until)\s*(\d{1,2}(?::\d{2})?\s*[ap]?\.?m?\.?)/);
            if (r) { const a = minutesOf(r[1].replace(/\s+/g, '')), b = minutesOf(r[2].replace(/\s+/g, '')); if (a !== null && b !== null && a !== b) per[d].push([a, b || 1440]); }
          } else for (const item of [].concat(v && v.ranges ? v.ranges : v || [])) { const r = item && rangeOf(item); if (r) per[d].push(r); }
        }
      }
      // a list of day entries
      if (!per && Array.isArray(n.periods || n.hours || n.schedule || n.openingHours || n.business_hours || n.businessHours)) {
        const list = n.periods || n.hours || n.schedule || n.openingHours || n.business_hours || n.businessHours;
        const p = WEEK.map(() => []); let any = false;
        for (const it of list) {
          if (!it || typeof it !== 'object') continue;
          const d = dayOf(pick(it, ['day', 'dayOfWeek', 'weekday', 'day_of_week', 'openDay', 'dayName', 'name']) ?? (it.open && it.open.day));
          const r = rangeOf(it.open && typeof it.open === 'object' && it.close ? { open: it.open.time, close: it.close.time } : it);
          if (d !== null && r) { p[d].push(r); any = true; }
        }
        if (any) per = p;
      }
      if (per && sane(per)) return { oh: toOsm(per), snippet: 'hours data in the page' };
    }
  }
  return null;
}

module.exports = { fromText, fromTextNear, fromJsonLd, fromOhStrings, fromSquarespace, fromAnyJson, toOsm, sane };
