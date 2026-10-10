// Where is the Sunset? A bounding box for the feed filters, a rough outline
// for the map, neighborhood labels from coordinates, and a grid geocoder.
//
// The district is a near-perfect street grid, slightly rotated: numbered
// avenues run north-south about 0.001076 degrees of longitude apart, and the
// alphabet streets (Irving, Judah, Kirkham ... Wawona) run east-west about
// 0.001875 degrees of latitude apart. The constants below were fitted to
// US Census geocodes of real addresses in October 2026 and land within a few
// meters of them, which is enough to place "37th Ave between Ortega and
// Quintara" or "Irving & 9th" without a geocoding service.

// The Inner and Outer Sunset only: Lincoln Way to Taraval, the edge of
// UCSF and Mount Sutro to the beach. Golden Gate Park, Golden Gate Heights
// and Parkside are outside.
export const BOX = { south: 37.741, north: 37.7672, west: -122.5135, east: -122.454 };

export function inBox(lat, lng, box = BOX) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= box.south &&
    lat <= box.north &&
    lng >= box.west &&
    lng <= box.east
  );
}

export const HOODS = [
  { id: "inner-sunset", label: "Inner Sunset" },
  { id: "outer-sunset", label: "Outer Sunset" },
  { id: "sunset-wide", label: "Sunset-wide" },
];

// ---- The grid -------------------------------------------------------------
const LAT0 = 37.7655; // Lincoln Way at 19th Ave
const LNG19 = -122.4772; // 19th Ave at Lincoln Way
const AVE_STEP = 0.001076; // one avenue, in longitude
const STREET_STEP = 0.001875; // one alphabet street, in latitude
const AVE_SKEW = 0.072; // avenues drift east as you go south
const STREET_TILT = 0.043; // streets rise as you go east

// East-west streets, Lincoln Way = 0.
const STREETS = [
  "lincoln", "irving", "judah", "kirkham", "lawton", "moraga", "noriega", "ortega",
  "pacheco", "quintara", "rivera", "santiago", "taraval", "ulloa", "vicente", "wawona",
];

export const avenueLng = (n, lat) => LNG19 - (n - 19) * AVE_STEP - (lat - LAT0) * AVE_SKEW;
export const streetLat = (i, lng) => LAT0 - i * STREET_STEP + (lng - LNG19) * STREET_TILT;
// Sloat Blvd runs on its own diagonal.
const sloatLat = (lng) => 37.73442 + (lng + 122.48609) * -0.0697;

// Lincoln Way and Taraval St, fitted separately because they bound labels.
const lincolnLat = (lng) => 37.766 + (lng + 122.4665) * 0.0453;
const taravalLat = (lng) => 37.743 + (lng + 122.4755) * 0.0404;

export function hoodFor(lat, lng) {
  if (!inDistrict(lat, lng)) return null;
  // 19th Avenue divides the Inner Sunset from the Outer Sunset. The beach
  // and Sunset Dunes count as the Outer Sunset's shoreline.
  return lng > avenueLng(19, lat) ? "inner-sunset" : "outer-sunset";
}

// Named places the geocoders handle badly. Coordinates from OpenStreetMap.
export const LANDMARKS = [
  [/\bstern grove\b/i, 37.73609, -122.4786],
  [/\b(san francisco|sf) zoo\b/i, 37.73275, -122.50239],
  [/\bsunset dunes\b|\bupper great (?:hwy|highway)\b/i, 37.75069, -122.50851],
  [/\b(california academy of sciences|cal academy)\b/i, 37.76982, -122.4661],
  [/\bde young\b/i, 37.7715, -122.46909],
  [/\b(san francisco|sf) botanical garden\b|\bstrybing\b|\bgardens of golden gate park\b/i, 37.76736, -122.46968],
  [/\bjapanese tea garden\b/i, 37.77029, -122.47012],
  [/\bhall of flowers\b|\bcounty fair building\b/i, 37.7664, -122.468],
  [/\bstow lake\b|\bblue heron lake\b/i, 37.76899, -122.47285],
  [/\bpolo field\b/i, 37.7686, -122.493],
  [/\bkezar stadium\b/i, 37.76687, -122.45601],
  [/\bkezar pavilion\b/i, 37.76751, -122.45389],
  [/\b(national )?aids memorial grove\b/i, 37.76967, -122.46222],
  [/\bspreckels temple\b|\bmusic concourse\b|\bgolden gate (park )?bandshell\b/i, 37.76988, -122.46859],
  [/\bbeach chalet\b/i, 37.76947, -122.51022],
  // Generic "Ocean Beach": the Sunset stretch, at Judah.
  [/\bocean beach\b/i, 37.7604, -122.5108],
  [/\bmount sutro\b|\bmt\.? sutro\b/i, 37.7578, -122.4562],
  [/\bgarden for the environment\b/i, 37.7586, -122.4638],
  [/\bgrandview park\b/i, 37.75497, -122.47237],
  [/\bpine lake\b/i, 37.73649, -122.48807],
  [/\bsunset (rec(reation)? center|playground)\b/i, 37.7571, -122.48687],
  [/\bwest sunset (playground|rec)/i, 37.74954, -122.49862],
  [/\blarsen park\b/i, 37.7393, -122.47601],
  [/\bmccoppin square\b/i, 37.74357, -122.48005],
  [/\bparkside square\b/i, 37.73836, -122.48398],
  [/\bgolden gate heights park\b/i, 37.74999, -122.46957],
  [/\bhidden garden steps\b/i, 37.7596, -122.47363],
];

export function landmark(text) {
  for (const [re, lat, lng] of LANDMARKS) if (re.test(text)) return { lat, lng };
  return null;
}

// "Irving St & 9th Ave", "37th Ave between Ortega and Quintara",
// "Noriega at 45th". Returns null unless the text names both an avenue (or
// the Great Highway) and an alphabet street.
export function gridGeocode(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();
  if (/\b(clement|geary|balboa|cabrillo|fulton|anza|california st)\b/.test(s)) return null; // the Richmond reuses the avenues
  const aves = [];
  for (const m of s.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:ave|avenue|av)\b/g)) {
    const n = Number(m[1]);
    if (n >= 2 && n <= 48) aves.push(n);
  }
  if (/\blower great (hwy|highway)\b/.test(s)) aves.push(48.6);
  else if (/\bgreat (hwy|highway)\b|\bla playa\b/.test(s)) aves.push(49);
  if (/\bsunset (blvd|boulevard)\b/.test(s)) aves.push(36.5);
  const streets = [];
  STREETS.forEach((name, i) => {
    if (new RegExp(`\\b${name}\\b`).test(s)) streets.push(i);
  });
  const sloat = /\bsloat\b/.test(s);
  if (!aves.length || (!streets.length && !sloat)) return null;
  const n = aves.reduce((a, b) => a + b, 0) / aves.length;
  let lng = avenueLng(n, LAT0);
  let lat = LAT0;
  for (let k = 0; k < 3; k++) {
    lat = streets.length ? streets.reduce((a, i) => a + streetLat(i, lng), 0) / streets.length : sloatLat(lng);
    lng = avenueLng(n, lat);
  }
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

// ---- Text tests for events without coordinates ----------------------------
// Irving through Santiago; Taraval and everything south of it is Parkside.
const SUNSET_STREETS = new RegExp(
  `\\b(${STREETS.slice(1, 12).join("|")}|lincoln way|great (?:hwy|highway)|la playa|sunset blvd|sunset boulevard|parnassus|sunset dunes|ocean beach)\\b`,
  "i"
);
const NUMBERED_AVE = /\b([5-9]|[1-4]\d)(?:st|nd|rd|th)\s+(?:ave|avenue)\b/i;
// Every San Francisco ZIP except 94122 and 94116 (94116 is left to the
// other tests: part of it is the Outer Sunset, most of it is Parkside).
const OTHER_SF_ZIPS = /\b941(0[2-9]|1[0-5789]|2[0134-9]|3[0-4]|58)\b/;

// Other Bay Area places that show up in feeds from groups with several
// branches. Moraga and Richmond are left out on purpose: both are also
// Sunset or San Francisco names.
const ELSEWHERE =
  /\b(oakland|berkeley|alameda|emeryville|el cerrito|albany|san leandro|hayward|fremont|union city|walnut creek|pleasant hill|concord|lafayette|orinda|danville|san ramon|dublin|pleasanton|livermore|daly city|colma|pacifica|south san francisco|san bruno|millbrae|burlingame|san mateo|belmont|san carlos|redwood city|menlo park|palo alto|mountain view|sunnyvale|santa clara|san jose|cupertino|sausalito|mill valley|san rafael|novato|larkspur|corte madera|tiburon|petaluma|napa|sonoma|santa cruz|boulder creek|half moon bay|rosemead|los angeles)\b/i;

// Neighboring San Francisco neighborhoods. A listing that names one is not
// in the Sunset, even when a platform rounds its pin to a point inside the
// outline (Luma does this for hidden addresses).
const OTHER_HOODS =
  /\b(parkside|golden gate heights|stern grove|(?:san francisco|sf) zoo|lake merced|west portal|st\.? francis wood|forest hill|cole valley|haight|lakeshore|stonestown|laguna honda|mt\.? davidson|mount davidson|ingleside|miraloma|balboa terrace|noe valley|mission district|tenderloin|north beach|inner richmond|outer richmond|richmond district)\b/i;

// True when the text names another neighborhood or city outright. Used as a
// veto even when a listing has coordinates. ZIP codes are not used here:
// Golden Gate Park spans 94117, 94118 and 94121, and the Zoo is 94132.
export function namesElsewhere(text) {
  if (!text) return false;
  const s = String(text);
  return (ELSEWHERE.test(s) || OTHER_HOODS.test(s)) && !/\b94122\b/.test(s);
}

// Returns true, false, or null when the text says nothing either way.
export function sunsetByText(text) {
  if (!text) return null;
  const s = String(text);
  if (namesElsewhere(s)) return false;
  const lm = landmark(s);
  if (lm) return inDistrict(lm.lat, lm.lng);
  // 94122 is the Inner and Outer Sunset; 94116 is mostly Parkside, so it
  // proves nothing on its own.
  if (/\b94122\b/.test(s)) return true;
  if (/\binner sunset\b|\bouter sunset\b/i.test(s)) return true;
  const g = gridGeocode(s);
  if (g && inDistrict(g.lat, g.lng)) return true;
  if (OTHER_SF_ZIPS.test(s)) return false;
  if (SUNSET_STREETS.test(s) && /san francisco|\bsf\b/i.test(s) && !NUMBERED_AVE.test(s)) return true;
  return null;
}

// The district: Lincoln Way (Golden Gate Park is outside), the edge of UCSF
// Parnassus and Mount Sutro, Lawton St east of 19th Ave (Golden Gate Heights
// is outside), 19th Ave, Taraval St (Parkside, including Taraval itself, is
// outside) and the beach. Corners come from the street-grid model above.
// Every keep-or-drop decision runs through inDistrict(); BOX is only a
// coarse prefilter for searches.
export const OUTLINE = [
  [37.7642, -122.513],
  [37.7667, -122.4575],
  [37.76, -122.4555],
  [37.7565, -122.4545],
  [37.7552, -122.4605],
  [37.757, -122.4655],
  [37.758, -122.4692],
  [37.7578, -122.4766],
  [37.7433, -122.4756],
  [37.7418, -122.513],
];

export function inDistrict(lat, lng) {
  if (!inBox(lat, lng)) return false;
  let inside = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [yi, xi] = OUTLINE[i];
    const [yj, xj] = OUTLINE[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
