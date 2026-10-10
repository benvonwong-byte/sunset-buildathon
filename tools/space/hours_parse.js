// Turn rendered page text / JSON-LD into an OSM-style opening_hours string.
// per[d] = array of [openMin, closeMin] (closeMin may exceed 1440 for after-midnight), or [] for a closed day. d: 0=Mon..6=Sun.
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY = '(?:monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)(?![a-z])';
const DAYSPEC = `(?<![a-z])(?:${DAY}(?:\\s*(?:-|to|through|thru)\\s*${DAY})?(?:\\s*(?:,|&|and|\\+|/)\\s*${DAY}(?:\\s*(?:-|to|through|thru)\\s*${DAY})?)*|daily|every ?day|weekdays|weekends)`;
const T = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?|noon|midnight)';
const RANGE = `${T}\\s*(?:-|to|until|till)\\s*${T}`;
const ENTRY = new RegExp(`(${DAYSPEC})\\s*[:|,]?\\s*(?:\\|\\s*)?(closed|${RANGE}(?:\\s*(?:,|&|and|\\|)\\s*${RANGE})*)`, 'g');
const BAD_CONTEXT = /(happy hour|delivery|pick-?up|take-?out|kitchen|brunch|special|lunch menu|dinner menu|reservation|bar hours|order online|breakfast only|holiday|thanksgiving|christmas|new year)/;

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
      const tries = [['a', 'p'], ['p', 'p'], ['a', 'a']];
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

const hh = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function sane(per) {
  if (per.filter(r => r.length).length < 4) return false;
  const all24 = per.every(r => r.length === 1 && r[0][0] === 0 && r[0][1] >= 1439);
  if (all24) return false; // placeholder 24/7 claims from website templates
  for (const rs of per) for (const [s, e0] of rs) {
    const e = e0 <= s ? e0 + 1440 : e0;
    if (e - s > 18 * 60 || e - s < 30) return false;     // "09:00-06:00" style AM/PM slips
    if (s > 0 && s < 5 * 60) return false;                // nobody opens at 3:30 AM
    if (e > 1440 + 5 * 60) return false;
  }
  return true;
}

function toOsm(per) {
  const close = (s, e) => { const x = e <= s ? e + 1440 : e; return x === 1440 ? '24:00' : hh(x % 1440); };
  return DAYS.map((d, i) => per[i].length ? `${d} ` + per[i].map(([s, e]) => `${hh(s)}-${close(s, e)}`).join(',') : `${d} off`).join('; ');
}

function normText(t) {
  return t.toLowerCase().replace(/[\u2013\u2014\u2012\u2212]/g, '-').replace(/\u00a0/g, ' ').replace(/\s*\n\s*/g, ' | ').replace(/[ \t]+/g, ' ');
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
    for (const it of c.items) for (const d of it.days) if (per[d] === null) per[d] = it.ranges;
    const covered = per.filter(x => x !== null).length;
    if (covered < 5) continue;
    const near = /(hours|open|opening)/.test(text.slice(Math.max(0, c.start - 120), c.start)) ? 3 : 0;
    const score = covered + near;
    if (!best || score > best.score) best = { per, score, covered, snippet: text.slice(c.start, c.end).slice(0, 220) };
  }
  if (!best) return null;
  const per = best.per.map(x => x === null ? [] : x);
  if (!sane(per)) return null;
  return { oh: toOsm(per), snippet: best.snippet };
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
  for (const raw of Array.isArray(vals) ? vals : [vals]) {
    const full = { mo: 'mon', tu: 'tue', we: 'wed', th: 'thu', fr: 'fri', sa: 'sat', su: 'sun' };
    const txt = normText(String(raw)).trim().replace(/(?<![a-z])(mo|tu|we|th|fr|sa|su)(?![a-z])/g, x => full[x]);
    const m = txt.match(new RegExp(`^(${DAYSPEC})\\s+(\\d{1,2}:\\d{2})\\s*-\\s*(\\d{1,2}:\\d{2})$`));
    if (!m) continue;
    const days = expandDays(m[1]);
    const a = m[2].split(':'), b = m[3].split(':');
    for (const d of days) { per[d].push([+a[0] * 60 + +a[1], (+b[0] * 60 + +b[1]) || 1440]); any = true; }
  }
  return any ? per : null;
}

function* walk(n) {
  if (Array.isArray(n)) for (const v of n) yield* walk(v);
  else if (n && typeof n === 'object') { yield n; for (const v of Object.values(n)) yield* walk(v); }
}

function fromJsonLd(texts) {
  for (const t of texts) {
    let data;
    try { data = JSON.parse(t); } catch { continue; }
    for (const n of walk(data)) {
      let per = null;
      if (n.openingHoursSpecification) per = specToPer(n.openingHoursSpecification);
      if (!per && n.openingHours) per = fromOhStrings(n.openingHours);
      if (per && sane(per)) return { oh: toOsm(per), snippet: 'schema.org JSON-LD' };
    }
  }
  return null;
}

module.exports = { fromText, fromJsonLd, fromOhStrings, toOsm, sane };
