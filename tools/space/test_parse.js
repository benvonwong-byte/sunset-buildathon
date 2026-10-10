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
  ['dotted days', 'HOURS Mon.: Closed | Tues. - Sat.: 11am - 7pm | Sun.: 12 - 5pm'],
  ['seven days', 'We are open 7 days a week, 8am - 8pm'],
  ['today marker', 'monday | 5:00 am - 11:00 pm | tuesday | 5:00 am - 11:00 pm | wednesday | 5:00 am - 11:00 pm | thursday | 5:00 am - 11:00 pm | friday | 5:00 am - 11:00 pm | saturday · today | 6:00 am - 11:00 pm | sunday | 6:00 am - 11:00 pm'],
  ['bare twelve', 'Hours | tuesday 10:00-5:00 | wednesday 10:00-5:00 | thursday 10:00-5:00 | friday 12:00- 5:00 | saturday 10:00-4:00'],
  ['dot and brunch', '4001 Judah Street\nDinner\nMonday . 5:00pm - 9:00pm (Special)\nTuesday . 5:00pm - 9:00pm\nWednesday . 5:00pm - 9:00pm\nThursday . 5:00pm - 9:00pm\nFriday . 5:00pm - 9:30pm\nSaturday . 4:30pm - 9:30pm\nSunday . 4:30pm - 9:00pm\nMAKE DINNER RESERVATION\nBrunch\nSaturday . 9:30am - 2:00pm\nSunday . 9:30am - 2:00pm'],
];
for (const [n, t] of cases) console.log(n.padEnd(22), JSON.stringify(fromText(t)?.oh ?? null));
console.log('jsonld', JSON.stringify(fromJsonLd([JSON.stringify({ '@type': 'Restaurant', openingHoursSpecification: [
  { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], opens: '16:00', closes: '22:00' },
  { dayOfWeek: ['Friday', 'Saturday'], opens: '12:00', closes: '23:00' }, { dayOfWeek: 'Sunday', opens: '12:00', closes: '21:00' }] })])?.oh));
const { fromOhStrings, toOsm } = require('./hours_parse.js');
const mp = fromOhStrings(['Mo-Fr 09:00-17:00', 'Sa 10:00-14:00']); console.log('microdata', mp && toOsm(mp));
const { fromSquarespace, fromTextNear } = require('./hours_parse.js');
const r = (a, b) => ({ ranges: [{ from: a, to: b }] });
console.log('squarespace', JSON.stringify(fromSquarespace({ monday: { ranges: [] }, tuesday: r(600, 1080), wednesday: r(600, 1080), thursday: r(600, 1080), friday: r(600, 1200), saturday: r(540, 1200), sunday: r(540, 960) })?.oh));
console.log('near address', JSON.stringify(fromTextNear('Chinatown 1520 Stockton St Hours: Mon-Fri 8am-5pm | Sunset 2308 Taraval St Hours: Mon-Sat 9am-6pm | Sun closed', ['2308 taraval'])?.oh));
const { fromAnyJson } = require('./hours_parse.js');
console.log('json keyed', JSON.stringify(fromAnyJson([{ site: { hours: { monday: '11:00 AM - 9:00 PM', tuesday: '11:00 AM - 9:00 PM', wednesday: 'Closed', thursday: '11am-9pm', friday: '11am-10pm', saturday: '11am-10pm', sunday: '12pm-8pm' } } }])?.oh));
console.log('json list', JSON.stringify(fromAnyJson([{ location: { business_hours: [{ day: 'MONDAY', start: '07:00', end: '15:00' }, { day: 'TUESDAY', start: '07:00', end: '15:00' }, { day: 'WEDNESDAY', start: '07:00', end: '15:00' }, { day: 'THURSDAY', start: '07:00', end: '15:00' }, { day: 'FRIDAY', start: '07:00', end: '15:00' }, { day: 'SATURDAY', start: '08:00:00', end: '16:00:00' }] } }])?.oh));
console.log('json wix', JSON.stringify(fromAnyJson([{ businessSchedule: { periods: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map(d => ({ openDay: d, openTime: '10:00', closeDay: d, closeTime: '18:00' })) } }])?.oh));
console.log('json noise', JSON.stringify(fromAnyJson([{ shipping: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true } }])?.oh ?? null));
console.log('jsonld other address', JSON.stringify(fromJsonLd([JSON.stringify({ '@type': 'Hospital', address: { streetAddress: '845 Jackson St' }, openingHours: ['Mo-Su 09:00-17:00'] })], '2407') ?? null));
