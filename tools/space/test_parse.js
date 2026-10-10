const { fromText, fromJsonLd } = require('./hours_parse.js');
const cases = [
  ['standard', 'Our Hours\nMonday - Friday: 9:00 AM - 5:00 PM\nSaturday: 10am - 2pm\nSunday: Closed'],
  ['restaurant split', 'HOURS\nMon: Closed\nTue-Thu 11:30am-2:30pm, 5pm-9pm\nFri & Sat 11:30am-2:30pm, 5pm-10pm\nSun 12-8pm'],
  ['24h clock', 'Open Monday-Saturday 09:00 - 18:00 Sunday 10:00 - 16:00'],
  ['late night bar', 'Hours: Daily 4pm-2am'],
  ['happy hour only', 'Happy hour Mon-Fri 3-6pm'],
  ['short 9-5', 'Hours: Mon-Fri 9-5, Sat 10-2'],
  ['am/pm slip', 'Mon-Sun 09:00-06:00'],
  ['no hours', 'Welcome to our shop! Call 415-555-1234 for 2 free quotes'],
  ['sunset false positive', 'Sunset District favorite since 1987. Sun 12pm-6pm'],
];
for (const [n, t] of cases) console.log(n.padEnd(22), JSON.stringify(fromText(t)?.oh ?? null));
console.log('jsonld', JSON.stringify(fromJsonLd([JSON.stringify({ '@type': 'Restaurant', openingHoursSpecification: [
  { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], opens: '16:00', closes: '22:00' },
  { dayOfWeek: ['Friday', 'Saturday'], opens: '12:00', closes: '23:00' }, { dayOfWeek: 'Sunday', opens: '12:00', closes: '21:00' }] })])?.oh));
const { fromOhStrings, toOsm } = require('./hours_parse.js');
const mp = fromOhStrings(['Mo-Fr 09:00-17:00', 'Sa 10:00-14:00']); console.log('microdata', mp && toOsm(mp));
