// Writes hours found by find_hours.js into the published spaces.json, without rerunning the
// whole build (build.py and finalize.py need the full downloads; this does not).
// usage: node apply_hours.js found.json ../../site/space/spaces.json
//
// Only hours whose page is known to be about this place are applied: the place's street
// address or phone number is on the site, a location page's address names its street, or
// the link came from OpenStreetMap. Places that already have hours are left alone. Each
// one gets hs: "site" and hurl: the page the hours were read from, which the Spaces page
// shows as "Hours read from the business's website".
const fs = require('fs');
const OH = require('opening_hours');

const [, , foundPath, spacesPath] = process.argv;
const found = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
const spaces = JSON.parse(fs.readFileSync(spacesPath, 'utf8'));
const TRUST = new Set(['address', 'phone', 'url', 'osm']);
const nominatim = { lat: 37.75, lon: -122.48, address: { country_code: 'us', state: 'California' } };

// Same week grid as eval_hours.js: Mon 2026-10-19 .. Sun 2026-10-25, 48 half hours a day.
function week(oh) {
  const o = new OH(oh, nominatim, { mode: 0, warnings_severity: 0 });
  let w = '';
  for (let d = 0; d < 7; d++) for (let s = 0; s < 48; s++) {
    const m = s * 30 + 1, t = new Date(2026, 9, 19 + d, Math.floor(m / 60), m % 60);
    w += o.getUnknown(t) ? '?' : (o.getState(t) ? '1' : '0');
  }
  let pretty = oh;
  try { pretty = o.prettifyValue({ conf: { locale: 'en' } }); } catch { /* keep raw */ }
  return { w, pretty };
}

let added = 0, skipped = 0;
for (const r of spaces) {
  const f = found[r.id];
  if (r.w || !f || f.status !== 'hours' || !TRUST.has(f.verified)) { if (f && f.status === 'hours' && !r.w) skipped++; continue; }
  try {
    const { w, pretty } = week(f.oh);
    if (!/[01]/.test(w)) continue;
    Object.assign(r, { oh: pretty, w, hs: 'site', hurl: f.url });
    added++;
  } catch (e) {
    console.warn(`${r.n}: ${String(e).slice(0, 80)}`);
  }
}
fs.writeFileSync(spacesPath, JSON.stringify(spaces));
console.log(`added hours to ${added} places${skipped ? ` (${skipped} left out: not confirmed as this place)` : ''}; ${spaces.filter(r => r.w).length} of ${spaces.length} now have hours`);
