#!/usr/bin/env node
// Assembles dist/ for GitHub Pages: the static site, the public data files,
// subscribable calendar feeds (everything, plus one per category), the
// /events/ page, JSON-LD and geo tags for every page, sitemap.xml, robots.txt,
// llms.txt, and the CNAME for sunset.dearcrisis.com.
//
// INDEX=1 makes the site indexable. Without it every page ships noindex.
//
// SITE_URL is the address the site is served from. It defaults to
// https://sunset.dearcrisis.com/, and every canonical link, share image,
// sitemap entry and calendar link is written against it. Set it to the
// github.io address while the custom domain is not yet set in the repo's
// Pages settings, or WhatsApp and Signal fetch share images from a host that
// answers "Site not found".

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { HOODS, OUTLINE, BOX } from "./lib/geo.mjs";
import { loadContent, renderRecap } from "../recap/render.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const DOMAIN = "sunset.dearcrisis.com";
const BASE = (process.env.SITE_URL || `https://${DOMAIN}/`).replace(/\/*$/, "/");
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
    const desc = [e.org ? `Hosted by ${e.org}.` : "", e.url ?? "", e.description ?? "", `${BASE}events/#event=${e.id}`]
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

// --- Pages ---------------------------------------------------------------
const version = createHash("sha1")
  .update(readFileSync(join(ROOT, "site/app.js")))
  .update(readFileSync(join(ROOT, "site/style.css")))
  .update(String(events.fetchedAt))
  .digest("hex")
  .slice(0, 10);

const indexable = process.env.INDEX === "1";
const robotsMeta = indexable
  ? `<meta name="robots" content="index, follow, max-image-preview:large">`
  : `<meta name="robots" content="noindex, follow">`;

// Geo tags from the district box in geo.mjs, so the numbers live in one place.
const mid = { lat: ((BOX.south + BOX.north) / 2).toFixed(4), lng: ((BOX.west + BOX.east) / 2).toFixed(4) };
const geoMeta = [
  `<meta name="geo.region" content="US-CA">`,
  `<meta name="geo.placename" content="Inner and Outer Sunset, San Francisco">`,
  `<meta name="geo.position" content="${mid.lat};${mid.lng}">`,
  `<meta name="ICBM" content="${mid.lat}, ${mid.lng}">`,
].join("\n  ");

// JSON-LD shared by every page: the site, who made it, and the place it covers.
const publisher = { "@type": "Organization", "@id": "https://dearcrisis.com/#org", name: "Dear Crisis", url: "https://dearcrisis.com" };
const creator = {
  "@type": "Person",
  "@id": "https://vonwong.com/#person",
  name: "Benjamin Von Wong",
  url: "https://vonwong.com",
  affiliation: { "@id": publisher["@id"] },
};
const place = {
  "@type": "Place",
  "@id": `${BASE}#sunset`,
  name: "Inner and Outer Sunset, San Francisco",
  address: { "@type": "PostalAddress", addressLocality: "San Francisco", addressRegion: "CA", addressCountry: "US" },
  geo: { "@type": "GeoShape", box: `${BOX.south},${BOX.west} ${BOX.north},${BOX.east}` },
  containedInPlace: { "@type": "City", name: "San Francisco" },
};
const website = {
  "@type": "WebSite",
  "@id": `${BASE}#website`,
  url: BASE,
  name: "Sunset Events",
  inLanguage: "en",
  creator: { "@id": creator["@id"] },
  publisher: { "@id": publisher["@id"] },
};
const page = (url, name, description, image) => ({
  "@type": "WebPage",
  "@id": url,
  url,
  name,
  description,
  inLanguage: "en",
  isPartOf: { "@id": website["@id"] },
  about: { "@id": place["@id"] },
  spatialCoverage: { "@id": place["@id"] },
  primaryImageOfPage: { "@type": "ImageObject", url: `${BASE}assets/${image}`, width: 1200, height: 630 },
  creator: { "@id": creator["@id"] },
  publisher: { "@id": publisher["@id"] },
  ...(events.fetchedAt && image === "og-events.jpg" ? { dateModified: events.fetchedAt } : {}),
});
const ldTag = (graph) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [website, creator, publisher, place, ...graph] }).replace(/</g, "\\u003c")}</script>`;

const next = events.events.slice(0, 50);
const eventList = {
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
      url: e.url ?? `${BASE}events/#event=${e.id}`,
      eventAttendanceMode: e.online
        ? "https://schema.org/OnlineEventAttendanceMode"
        : "https://schema.org/OfflineEventAttendanceMode",
      location: e.online
        ? { "@type": "VirtualLocation", url: e.url }
        : { "@type": "Place", name: e.venue ?? "Sunset District", address: e.address ?? "San Francisco, CA" },
      ...(e.org ? { organizer: { "@type": "Organization", name: e.org } } : {}),
    },
  })),
};
const eventData = {
  "@type": "Dataset",
  name: "Public events in the Inner and Outer Sunset",
  description: "The next 60 days of public events in San Francisco's Inner and Outer Sunset, read every morning from each group's own calendar and from Luma, Eventbrite, Meetup, the San Francisco Public Library and other listings.",
  spatialCoverage: { "@id": place["@id"] },
  creator: { "@id": creator["@id"] },
  publisher: { "@id": publisher["@id"] },
  isAccessibleForFree: true,
  ...(events.fetchedAt ? { dateModified: events.fetchedAt } : {}),
  distribution: [
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${BASE}data/events.json` },
    { "@type": "DataDownload", encodingFormat: "text/calendar", contentUrl: `${BASE}sunset.ics` },
  ],
};

const fill = (html, ld) =>
  html
    .replaceAll("__VERSION__", version)
    .replaceAll("__SITE__", BASE)
    .replace("<!--ROBOTS-->", robotsMeta)
    .replace("<!--GEO-->", geoMeta)
    .replace("<!--JSONLD-->", ld ?? "");

const SITE_DESC = "Every public event in San Francisco's Inner and Outer Sunset, gathered every morning, plus the groups that hold them, on a map.";
const rootHtml = readFileSync(join(DIST, "index.html"), "utf8");
writeFileSync(
  join(DIST, "index.html"),
  fill(rootHtml, ldTag([page(BASE, "Sunset Events", SITE_DESC, "og-events.jpg"), eventList, eventData]))
);

// /events/ is the same app opened on the event list, so the list has a plain
// address to share and index. Relative links move one folder down; app.js
// resolves its own data paths.
const EVENTS_URL = `${BASE}events/`;
const EVENTS_TITLE = "What's on in the Sunset: every public event, updated every morning";
const EVENTS_DESC = "Every public event in San Francisco's Inner and Outer Sunset for the next 60 days, by day, with calendar feeds to subscribe to. Gathered every morning from neighborhood groups, the library, Luma, Eventbrite and Meetup.";
const eventsHtml = fill(
  rootHtml
    .replace('<html lang="en">', '<html lang="en" data-view="events">')
    .replace(/<title>[^<]*<\/title>/, `<title>${EVENTS_TITLE}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${EVENTS_DESC}"`)
    .replace(/(<link rel="canonical" href=")[^"]*"/, `$1${EVENTS_URL}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${EVENTS_URL}"`)
    .replace(/(<meta (?:property|name)="(?:og|twitter):title" content=")[^"]*"/g, `$1What's on in the Sunset"`)
    .replace(/ aria-current="page"/, "")
    .replace(/\b(href|src)="(?!https?:|\/|#|mailto:|data:|__SITE__)([^"]*)"/g, (_, a, u) => `${a}="${u === "./" ? "../" : "../" + u}"`),
  ldTag([page(EVENTS_URL, "What's on in the Sunset", EVENTS_DESC, "og-events.jpg"), eventList, eventData])
);
mkdirSync(join(DIST, "events"), { recursive: true });
writeFileSync(join(DIST, "events/index.html"), eventsHtml);

// --- Spaces page (site/space) -------------------------------------------
// GOOGLE_MAPS_BROWSER_KEY is optional. It is a browser key, so it ends up in
// the page either way: restrict it in Google Cloud to this site's addresses
// and to the Street View Static API. Without it the page shows the lot plans.
const SPACE_URL = `${BASE}space/`;
const SPACE_DESC = "Storefronts in San Francisco's Inner and Outer Sunset that are closed at a given hour between 9 AM and midnight, with an estimate of how much floor space each one holds.";
const spacePage = join(DIST, "space/index.html");
let spaceCount = 0;
if (existsSync(spacePage)) {
  const streetViewKey = process.env.GOOGLE_MAPS_BROWSER_KEY ?? "";
  writeFileSync(join(DIST, "space/config.js"), `window.SPACE_CONFIG = ${JSON.stringify({ streetViewKey })};\n`);
  spaceCount = JSON.parse(readFileSync(join(DIST, "space/spaces.json"), "utf8")).length;
  const spaceData = {
    "@type": "Dataset",
    name: "Storefront hours and floor space in the Sunset",
    description: `${spaceCount} storefronts in the Inner Sunset and Sunset/Parkside with their posted hours as half-hour slots and an estimate of ground-floor area from the SF Assessor's roll and mapped building footprints. Chains, banks and gas stations are left out.`,
    spatialCoverage: { "@id": place["@id"] },
    creator: { "@id": creator["@id"] },
    publisher: { "@id": publisher["@id"] },
    isAccessibleForFree: true,
    variableMeasured: ["Posted opening hours", "Estimated ground-floor area in square feet"],
    isBasedOn: [
      { "@type": "Dataset", name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright" },
      { "@type": "Dataset", name: "Assessor Historical Secured Property Tax Rolls (DataSF)", url: "https://data.sf.gov/d/wv5m-vpq2" },
      { "@type": "Dataset", name: "Parcels, Active and Retired (DataSF)", url: "https://data.sf.gov/d/acdm-wktn" },
      { "@type": "Dataset", name: "Registered Business Locations (DataSF)", url: "https://data.sf.gov/d/g8m3-pdis" },
    ],
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SPACE_URL}spaces.json` }],
  };
  writeFileSync(
    spacePage,
    fill(readFileSync(spacePage, "utf8"), ldTag([page(SPACE_URL, "Sunset Idle Space", SPACE_DESC, "og-space.jpg"), spaceData]))
  );
}

// --- Build-a-thon recap (recap/) -----------------------------------------
// Rendered from recap/content.json. Its canonical home is
// dearcrisis.com/buildathon; this copy serves the same page with its own
// photos, so the whole project lives in one repo. Not in the sitemap, since
// the canonical link points away from this site.
const recap = loadContent();
mkdirSync(join(DIST, "recap"), { recursive: true });
writeFileSync(join(DIST, "recap/index.html"), renderRecap(recap, "site", { site: BASE, robots: robotsMeta.match(/content="([^"]+)"/)[1] }));

const flyerPage = join(DIST, "flyer/index.html");
if (existsSync(flyerPage)) writeFileSync(flyerPage, fill(readFileSync(flyerPage, "utf8")));

// --- Sitemap, robots.txt, llms.txt ---------------------------------------
const PAGES = [
  { url: BASE, title: "Sunset Events", desc: "the directory of groups, the map and the event list", daily: true },
  { url: EVENTS_URL, title: "What's on in the Sunset", desc: "every upcoming public event, by day", daily: true },
  { url: SPACE_URL, title: "Sunset Idle Space", desc: "storefronts closed at a chosen hour, with estimated floor space", daily: false },
];
const today = (events.fetchedAt ?? new Date().toISOString()).slice(0, 10);
writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    PAGES.map(
      (p) => `  <url><loc>${p.url}</loc>${p.daily ? `<lastmod>${today}</lastmod><changefreq>daily</changefreq>` : "<changefreq>monthly</changefreq>"}</url>`
    ).join("\n") +
    `\n</urlset>\n`
);
writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${BASE}sitemap.xml\n`);

// llms.txt: the same facts as the pages, in plain text, for language models
// and anyone reading without JavaScript.
const when = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const fetched = Date.parse(events.fetchedAt ?? new Date().toISOString());
const week = events.events.filter((e) => Date.parse(e.end ?? e.start) >= fetched && Date.parse(e.start) < fetched + 7 * 86400000);
const line = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const llms = [
  "# Sunset Events",
  "",
  `> ${SITE_DESC} Made by Benjamin Von Wong of the Dear Crisis community (https://dearcrisis.com).`,
  "",
  "Coverage: the Inner and Outer Sunset only, bounded by Lincoln Way, the edge of UCSF Parnassus and Mount Sutro, Lawton St east of 19th Ave, 19th Ave, Taraval St and Ocean Beach. Golden Gate Park, Golden Gate Heights and Parkside are outside.",
  "",
  "## Pages",
  "",
  ...PAGES.map((p) => `- [${p.title}](${p.url}): ${p.desc}`),
  "",
  "## The Build-a-thon",
  "",
  `- [${recap.event.name} recap](${recap.page.canonical}): ${recap.page.summary} The same page is served at ${BASE}recap/.`,
  "",
  "## Data",
  "",
  `- [events.json](${BASE}data/events.json): the next ${events.horizonDays ?? 60} days of events, rebuilt every morning`,
  `- [sunset.ics](${BASE}sunset.ics): the whole calendar as a feed to subscribe to`,
  ...domains.map((d) => `- [sunset-${d.id}.ics](${BASE}sunset-${d.id}.ics): ${d.label} only`),
  `- [orgs.json](${BASE}data/orgs.json): the groups, with links and calendar feeds`,
  ...(spaceCount ? [`- [spaces.json](${SPACE_URL}spaces.json): ${spaceCount} storefronts with posted hours and estimated floor space`] : []),
  "",
  `## Groups (${publicOrgs.length})`,
  "",
  ...publicOrgs
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => `- [${line(o.name)}](${o.url ?? `${BASE}#group=${o.id}`}): ${line(o.what)}`),
  "",
  `## The next seven days (${week.length} events)`,
  "",
  ...week.map((e) => {
    const t = e.allDay ? day.format(new Date(e.day + "T12:00:00Z")) : when.format(new Date(e.start));
    const where = line(e.online ? "Online" : e.venue ?? e.address);
    return `- ${t}: [${line(e.title)}](${EVENTS_URL}#event=${e.id})${where ? `, ${where}` : ""}${e.org && line(e.org).toLowerCase() !== where.toLowerCase() ? ` (${line(e.org)})` : ""}`;
  }),
  "",
];
writeFileSync(join(DIST, "llms.txt"), llms.join("\n"));

// GitHub Pages reads the custom domain from the repo settings; the CNAME file
// only matters once the site is served from it.
if (new URL(BASE).host === DOMAIN) writeFileSync(join(DIST, "CNAME"), DOMAIN + "\n");
writeFileSync(join(DIST, ".nojekyll"), "");

console.log(
  `build: dist/ ready at ${BASE} (${events.events.length} events, ${publicOrgs.length} groups, ${domains.length + 1} calendar feeds, ${spaceCount} spaces, version ${version}${indexable ? "" : ", noindex"})`
);
