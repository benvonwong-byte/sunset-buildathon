#!/usr/bin/env node
// Assembles dist/ for GitHub Pages: the static site, the public data files,
// subscribable calendar feeds (everything, plus one per category), JSON-LD
// for the next fifty events, and the CNAME for sunset.dearcrisis.com.
//
// INDEX=1 makes the site indexable. Until then it ships with noindex.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { HOODS, OUTLINE, BOX } from "./lib/geo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const DOMAIN = "sunset.dearcrisis.com";
const BASE = `https://${DOMAIN}/`;
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const events = existsSync(join(ROOT, "data/events.json"))
  ? read("data/events.json")
  : { fetchedAt: null, horizonDays: 60, sources: [], events: [] };
const orgs = read("data/orgs.json");
const domains = read("data/domains.json");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, "data"), { recursive: true });
cpSync(join(ROOT, "site"), DIST, { recursive: true });

// --- Public data ---------------------------------------------------------
const publicOrgs = orgs.map(({ evidence, notes, ...o }) => ({
  ...o,
  feeds: (o.feeds ?? []).filter((f) => !f.disabled).map(({ format, url }) => ({ format, url })),
}));
writeFileSync(join(DIST, "data/events.json"), JSON.stringify(events));
writeFileSync(join(DIST, "data/orgs.json"), JSON.stringify(publicOrgs));
writeFileSync(join(DIST, "data/domains.json"), JSON.stringify(domains));
writeFileSync(join(DIST, "data/geo.json"), JSON.stringify({ hoods: HOODS, outline: OUTLINE, box: BOX }));

// --- Calendar feeds ------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (day, plus = 0) =>
  new Date(Date.parse(day + "T12:00:00Z") + plus * 86400000).toISOString().slice(0, 10).replace(/-/g, "");

// Fold at 75 octets per RFC 5545.
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (parts.length ? 74 : 75), bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.join("\r\n ");
}

const domainLabel = Object.fromEntries(domains.map((d) => [d.id, d.label]));
const stamp = utc(events.fetchedAt ?? new Date().toISOString());

function ics(list, name) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dear Crisis//Sunset Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "X-WR-TIMEZONE:America/Los_Angeles",
    `X-WR-CALDESC:${esc("Public events in San Francisco's Inner and Outer Sunset, rebuilt every morning. " + BASE)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of list) {
    const end = e.end ?? new Date(Date.parse(e.start) + 3600000).toISOString();
    const desc = [e.org ? `Hosted by ${e.org}.` : "", e.url ?? "", e.description ?? "", `${BASE}#event=${e.id}`]
      .filter(Boolean)
      .join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@${DOMAIN}`,
      `DTSTAMP:${stamp}`,
      e.allDay ? `DTSTART;VALUE=DATE:${dateOnly(e.day)}` : `DTSTART:${utc(e.start)}`,
      e.allDay ? `DTEND;VALUE=DATE:${dateOnly(e.day, 1)}` : `DTEND:${utc(end)}`,
      `SUMMARY:${esc(e.title)}`,
      `LOCATION:${esc(e.venue && e.address?.toLowerCase().startsWith(e.venue.toLowerCase()) ? e.address : [e.venue, e.address].filter(Boolean).join(", "))}`,
      ...(e.url && /^https?:\/\//.test(e.url) ? [`URL:${e.url}`] : []),
      `CATEGORIES:${esc(domainLabel[e.domain] ?? "")}`,
      `DESCRIPTION:${esc(desc)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

writeFileSync(join(DIST, "sunset.ics"), ics(events.events, "Sunset Calendar"));
for (const d of domains) {
  writeFileSync(
    join(DIST, `sunset-${d.id}.ics`),
    ics(events.events.filter((e) => e.domain === d.id), `Sunset Calendar: ${d.label}`)
  );
}

// --- index.html ----------------------------------------------------------
const version = createHash("sha1")
  .update(readFileSync(join(ROOT, "site/app.js")))
  .update(readFileSync(join(ROOT, "site/style.css")))
  .update(String(events.fetchedAt))
  .digest("hex")
  .slice(0, 10);

const next = events.events.slice(0, 50);
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": BASE,
      url: BASE,
      name: "The Sunset Calendar",
      description: "Public events in San Francisco's Inner and Outer Sunset, gathered every morning from neighborhood groups, the library, Luma, Eventbrite and Meetup.",
      inLanguage: "en",
      publisher: { "@type": "Organization", name: "Dear Crisis", url: "https://www.dearcrisis.com" },
    },
    {
      "@type": "ItemList",
      name: "Upcoming events in the Sunset",
      numberOfItems: next.length,
      itemListElement: next.map((e, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Event",
          name: e.title,
          startDate: e.start,
          ...(e.end ? { endDate: e.end } : {}),
          url: e.url,
          eventAttendanceMode: e.online
            ? "https://schema.org/OnlineEventAttendanceMode"
            : "https://schema.org/OfflineEventAttendanceMode",
          location: e.online
            ? { "@type": "VirtualLocation", url: e.url }
            : { "@type": "Place", name: e.venue ?? "Sunset District", address: e.address ?? "San Francisco, CA" },
          ...(e.org ? { organizer: { "@type": "Organization", name: e.org } } : {}),
        },
      })),
    },
  ],
};
const ldTag = `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`;
const robotsMeta = process.env.INDEX === "1" ? "" : `<meta name="robots" content="noindex, follow">`;

let html = readFileSync(join(DIST, "index.html"), "utf8");
html = html.replaceAll("__VERSION__", version).replace("<!--ROBOTS-->", robotsMeta).replace("<!--JSONLD-->", ldTag);
writeFileSync(join(DIST, "index.html"), html);

// --- Spaces page (site/space) -------------------------------------------
// GOOGLE_MAPS_BROWSER_KEY is optional. It is a browser key, so it ends up in
// the page either way: restrict it in Google Cloud to this site's addresses
// and to the Street View Static API. Without it the page shows the lot plans.
const spacePage = join(DIST, "space/index.html");
if (existsSync(spacePage)) {
  const streetViewKey = process.env.GOOGLE_MAPS_BROWSER_KEY ?? "";
  writeFileSync(join(DIST, "space/config.js"), `window.SPACE_CONFIG = ${JSON.stringify({ streetViewKey })};\n`);
  writeFileSync(spacePage, readFileSync(spacePage, "utf8").replaceAll("__VERSION__", version).replace("<!--ROBOTS-->", robotsMeta));
}

// --- /flyer/: a parallel copy of the main page --------------------------
// The flyer redesign at its own address, with its own copy of the data, so
// it can be shared and reviewed apart from the main link (and a browser that
// cached an older main page still sees the new look here).
const FLYER = join(DIST, "flyer");
mkdirSync(FLYER, { recursive: true });
for (const name of ["app.js", "style.css", "assets", "data", "sunset.ics", ...domains.map((d) => `sunset-${d.id}.ics`)]) {
  cpSync(join(DIST, name), join(FLYER, name), { recursive: true });
}
writeFileSync(join(FLYER, "index.html"), html.replaceAll('href="space/"', 'href="../space/"'));

writeFileSync(join(DIST, "CNAME"), DOMAIN + "\n");
writeFileSync(join(DIST, ".nojekyll"), "");
writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n`);

console.log(
  `build: dist/ ready (${events.events.length} events, ${publicOrgs.length} groups, ${domains.length + 1} calendar feeds, version ${version}${robotsMeta ? ", noindex" : ""})`
);
