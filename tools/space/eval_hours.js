// Reads [{id, oh}] JSON on argv[2]; writes {id: {week, pretty, err}} to argv[3].
// week = 7 days (Mon..Sun) x 48 half-hour slots from 00:00 to 24:00; '1' open, '0' closed, '?' unknown.
const fs = require('fs');
const OH = require('opening_hours');

const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const nominatim = { lat: 37.75, lon: -122.48, address: { country_code: 'us', state: 'California' } };
// Reference week with no US public holidays: Mon 2026-10-19 .. Sun 2026-10-25 (local time).
const out = {};
for (const { id, oh } of items) {
  try {
    const o = new OH(oh, nominatim, { mode: 0, warnings_severity: 0 });
    let week = '';
    for (let d = 0; d < 7; d++) {
      for (let s = 0; s < 48; s++) {
        const minutes = s * 30 + 1;
        const t = new Date(2026, 9, 19 + d, Math.floor(minutes / 60), minutes % 60);
        week += o.getUnknown(t) ? '?' : (o.getState(t) ? '1' : '0');
      }
    }
    let pretty = oh;
    try { pretty = o.prettifyValue({ conf: { locale: 'en' } }); } catch (e) { /* keep raw */ }
    out[id] = { week, pretty };
  } catch (e) {
    out[id] = { err: String(e).slice(0, 120) };
  }
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
const ok = Object.values(out).filter(v => v.week).length;
console.log(`parsed ${ok}/${items.length}`);
