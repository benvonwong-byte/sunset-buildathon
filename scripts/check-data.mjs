#!/usr/bin/env node
// Validates data/orgs.json so a hand edit cannot break the site: required
// fields, known categories, neighborhoods and kinds, unique ids, https
// links, and feed formats the fetcher can read.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOODS, inBox } from "./lib/geo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const orgs = JSON.parse(readFileSync(join(ROOT, "data/orgs.json"), "utf8"));
const domains = new Set(JSON.parse(readFileSync(join(ROOT, "data/domains.json"), "utf8")).map((d) => d.id));
const hoods = new Set(HOODS.map((h) => h.id));
const KINDS = new Set(["nonprofit", "civic", "government", "business", "faith", "school", "informal", "venue", "market", "media"]);
const FORMATS = new Set(["ics", "luma", "meetup", "tockify", "civicplus", "squarespace", "tribe", "mobilize", "rss", "rss-future", "jsonld", "eventbrite"]);

const errors = [];
const warnings = [];
const ids = new Set();
const isHttp = (u) => typeof u === "string" && /^https?:\/\/[^\s]+$/.test(u);

for (const [i, o] of orgs.entries()) {
  const at = `orgs[${i}] ${o.id ?? o.name ?? "?"}`;
  if (!o.id || !/^[a-z0-9-]+$/.test(o.id)) errors.push(`${at}: id must be lowercase-kebab`);
  if (ids.has(o.id)) errors.push(`${at}: duplicate id`);
  ids.add(o.id);
  if (!o.name) errors.push(`${at}: missing name`);
  if (!isHttp(o.url)) errors.push(`${at}: url must be http(s)`);
  if (!o.what || o.what.length > 260) errors.push(`${at}: "what" is missing or longer than 260 characters`);
  if (!Array.isArray(o.domains) || !o.domains.length) errors.push(`${at}: needs at least one domain`);
  for (const d of o.domains ?? []) if (!domains.has(d)) errors.push(`${at}: unknown domain "${d}"`);
  if (!hoods.has(o.hood)) errors.push(`${at}: unknown hood "${o.hood}"`);
  if (!KINDS.has(o.kind)) errors.push(`${at}: unknown kind "${o.kind}"`);
  for (const k of ["eventsPage", "instagram"]) if (o[k] != null && !isHttp(o[k])) errors.push(`${at}: ${k} must be http(s) or null`);
  if ((o.lat == null) !== (o.lng == null)) errors.push(`${at}: lat and lng go together`);
  if (o.lat != null && !inBox(o.lat, o.lng) && o.hood !== "sunset-wide") warnings.push(`${at}: coordinates fall outside the district box`);
  for (const f of o.feeds ?? []) {
    if (!FORMATS.has(f.format)) errors.push(`${at}: unknown feed format "${f.format}"`);
    if (!isHttp(f.url)) errors.push(`${at}: feed url must be http(s)`);
    if (f.scope && !["local", "filter"].includes(f.scope)) errors.push(`${at}: feed scope must be "local" or "filter"`);
    if (f.skip) {
      try {
        new RegExp(f.skip, "i");
      } catch {
        errors.push(`${at}: feed skip is not a valid regex`);
      }
    }
  }
}

for (const w of warnings) console.warn("check-data: warning: " + w);
if (errors.length) {
  console.error(`check-data: ${errors.length} error(s)\n` + errors.map((e) => "  " + e).join("\n"));
  process.exit(1);
}
console.log(`check-data: ${orgs.length} groups valid (${orgs.filter((o) => o.feeds?.length).length} with feeds)`);
