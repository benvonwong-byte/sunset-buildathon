#!/usr/bin/env node
// Fills lat/lng for every group in data/orgs.json that has a street address
// and no coordinates yet, through the shared geocode cache. Run it after
// adding groups; CI runs it too, and cached addresses cost nothing.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openGeocoder } from "./lib/geocode.mjs";
import { inBox, hoodFor } from "./lib/geo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATH = join(ROOT, "data/orgs.json");
const orgs = JSON.parse(readFileSync(PATH, "utf8"));
const geo = openGeocoder(join(ROOT, "data/geocache.json"));

let filled = 0;
for (const o of orgs) {
  if (!o.address || (o.lat != null && o.lng != null)) continue;
  const hit = await geo.geocode(o.address);
  if (!hit) {
    console.warn(`geocode-orgs: no match for ${o.name} (${o.address})`);
    continue;
  }
  o.lat = Math.round(hit.lat * 1e5) / 1e5;
  o.lng = Math.round(hit.lng * 1e5) / 1e5;
  filled++;
  if (!inBox(o.lat, o.lng)) console.warn(`geocode-orgs: ${o.name} lands outside the district (${o.lat}, ${o.lng})`);
  else if (o.hood !== hoodFor(o.lat, o.lng) && o.hood !== "sunset-wide") {
    console.log(`geocode-orgs: ${o.name}: listed as ${o.hood}, coordinates say ${hoodFor(o.lat, o.lng)}`);
  }
}
geo.save();
writeFileSync(PATH, JSON.stringify(orgs, null, 2) + "\n");
console.log(`geocode-orgs: filled ${filled} groups (${geo.stats().lookups} new lookups)`);
