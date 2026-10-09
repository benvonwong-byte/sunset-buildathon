// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIcs } from "../scripts/lib/ics.mjs";
import { toPacificIso, zonedToUtc } from "../scripts/lib/time.mjs";
import { gridGeocode, hoodFor, sunsetByText, inDistrict } from "../scripts/lib/geo.mjs";
import { classify } from "../scripts/lib/classify.mjs";
import { parseSquarespace, parseJsonLd } from "../scripts/lib/parsers.mjs";

const window = { from: Date.parse("2026-10-09T00:00:00Z"), to: Date.parse("2026-11-23T00:00:00Z") };
const starts = (ics) => parseIcs(ics, window).map((e) => `${toPacificIso(e.startMs).slice(0, 16)} ${e.title}`);

test("weekly series expands across DST and honours EXDATE", () => {
  const out = starts(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:m
DTSTART;TZID=America/Los_Angeles:20240107T090000
RRULE:FREQ=WEEKLY;BYDAY=SU
EXDATE;TZID=America/Los_Angeles:20261018T090000
SUMMARY:Market
END:VEVENT
END:VCALENDAR`);
  assert.deepEqual(out.slice(0, 4), [
    "2026-10-11T09:00 Market",
    "2026-10-25T09:00 Market",
    "2026-11-01T09:00 Market",
    "2026-11-08T09:00 Market",
  ]);
});

test("RECURRENCE-ID moves one instance of a monthly series", () => {
  const out = starts(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
DTSTART;TZID=America/Los_Angeles:20250113T190000
RRULE:FREQ=MONTHLY;BYDAY=2MO
SUMMARY:Meeting
END:VEVENT
BEGIN:VEVENT
UID:a
RECURRENCE-ID;TZID=America/Los_Angeles:20261012T190000
DTSTART;TZID=America/Los_Angeles:20261013T190000
SUMMARY:Meeting (moved)
END:VEVENT
END:VCALENDAR`);
  assert.deepEqual(out.sort(), ["2026-10-13T19:00 Meeting (moved)", "2026-11-09T19:00 Meeting"]);
});

test("last-Friday rule with BYSETPOS and all-day dates", () => {
  const ev = parseIcs(
    `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:f
DTSTART;VALUE=DATE:20250101
RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1
SUMMARY:Last Friday
END:VEVENT
END:VCALENDAR`,
    window
  );
  assert.equal(ev.length, 1);
  assert.equal(ev[0].allDay, true);
  assert.equal(toPacificIso(ev[0].startMs).slice(0, 10), "2026-10-30");
});

test("cancelled events are dropped", () => {
  assert.equal(
    starts(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:c
DTSTART:20261020T170000Z
STATUS:CANCELLED
SUMMARY:Gone
END:VEVENT
END:VCALENDAR`).length,
    0
  );
});

test("Pacific conversion picks the right offset either side of DST", () => {
  assert.equal(toPacificIso(zonedToUtc(2026, 10, 31, 10, 0, 0)), "2026-10-31T10:00:00-07:00");
  assert.equal(toPacificIso(zonedToUtc(2026, 11, 1, 10, 0, 0)), "2026-11-01T10:00:00-08:00");
});

test("grid geocoder places intersections and block descriptions", () => {
  const g = gridGeocode("Irving St between 9th and 10th Ave");
  assert.ok(Math.abs(g.lat - 37.7639) < 0.0004 && Math.abs(g.lng + 122.4673) < 0.0006);
  assert.equal(hoodFor(...Object.values(gridGeocode("Noriega St & 45th Ave"))), "outer-sunset");
  assert.equal(hoodFor(...Object.values(gridGeocode("Judah & La Playa"))), "ocean-beach");
  assert.equal(gridGeocode("Clement St & 9th Ave"), null, "the Richmond reuses avenue numbers");
});

test("neighborhood labels match known places", () => {
  assert.equal(hoodFor(37.7651, -122.4664), "inner-sunset"); // Green Apple Books on the Park
  assert.equal(hoodFor(37.75497, -122.47237), "golden-gate-heights"); // Grandview Park
  assert.equal(hoodFor(37.73609, -122.4786), "parkside"); // Stern Grove
  assert.equal(hoodFor(37.76982, -122.4661), "golden-gate-park"); // Cal Academy
  assert.equal(inDistrict(37.7749, -122.4194), false); // Civic Center
  assert.equal(inDistrict(37.7405, -122.4655), false); // West Portal
  assert.equal(inDistrict(37.77261, -122.46023), false); // Conservatory, north of JFK
  assert.equal(inDistrict(37.73275, -122.50239), true); // the Zoo, south of Sloat
});

test("text test accepts Sunset ZIPs and rejects other SF ZIPs", () => {
  assert.equal(sunsetByText("1305 18th Ave, San Francisco, CA 94122"), true);
  assert.equal(sunsetByText("3321 16th St, San Francisco, CA 94114"), false);
  assert.equal(sunsetByText("Zoom"), null);
  assert.equal(sunsetByText("Sloat Pleasant Hill"), false); // another branch of a Sunset business
});

test("classifier", () => {
  assert.equal(classify("Ocean Beach Cleanup"), "ocean-parks");
  assert.equal(classify("Toddler Storytime"), "neighbors");
  assert.equal(classify("NERT Training"), "resilience");
  assert.equal(classify("Sunrise Yoga on the Dunes"), "wellbeing");
});

test("Squarespace and JSON-LD parsers decode what they read", () => {
  const sq = parseSquarespace(
    JSON.stringify({ upcoming: [{ title: "Serenades", startDate: 1791900000000, fullUrl: "/e/1", location: { addressTitle: "Sunset Dunes &#64; Judah" } }] }),
    { url: "https://example.org/events?format=json" }
  );
  assert.equal(sq[0].url, "https://example.org/e/1");
  const ld = parseJsonLd(
    `<script type="application/ld+json">{"@type":"Event","name":"Reading &amp; Talk","startDate":"2026-10-20T19:00:00-07:00","location":{"@type":"Place","name":"Bookstore","geo":{"latitude":37.76,"longitude":-122.5}}}</script>`,
    { url: "https://example.org" }
  );
  assert.equal(ld[0].title, "Reading & Talk");
  assert.equal(ld[0].lat, 37.76);
});
