#!/usr/bin/env node
// Builds data/events.json: every upcoming public event we can find in the
// Inner and Outer Sunset over the next HORIZON_DAYS.
//
// Two kinds of source:
//   1. Org feeds. Each group in data/orgs.json can list feeds (ICS, Luma,
//      Meetup, Squarespace, WordPress, JSON-LD...). A feed's `scope` says
//      how to treat locations: "local" keeps events unless they are clearly
//      elsewhere, "filter" keeps only events with positive Sunset evidence.
//      Optional: `skip` (regex of titles to drop) and `maxPerDay` (for
//      calendars that list every daily session).
//   2. Aggregators (scripts/lib/aggregators.mjs): Luma, Eventbrite, Meetup,
//      the public library and others, filtered to the district box.
//
// Never fails the build: a broken source is logged and skipped, and if most
// sources fail at once the previous file is kept.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { get, sleep } from "./lib/http.mjs";
import { parseByFormat } from "./lib/parsers.mjs";
import { inBox, hoodFor, sunsetByText } from "./lib/geo.mjs";
import { classify } from "./lib/classify.mjs";
import { openGeocoder } from "./lib/geocode.mjs";
import { toPacificIso, pacificDayKey, parseLooseDate, partsIn } from "./lib/time.mjs";
import { decodeEntities } from "./lib/ics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "events.json");
const ORGS = JSON.parse(readFileSync(join(ROOT, "data", "orgs.json"), "utf8"));

const HORIZON_DAYS = 60;
const PER_ORG_PER_DAY = 6;
const TOTAL_CAP = 3000;
const GEOCODE_BUDGET = Number(process.env.GEOCODE_BUDGET ?? 150);

// Which copy wins when two sources list the same event.
const PRIORITY = { org: 0, sfpl: 1, recpark: 2, luma: 3, eventbrite: 4, meetup: 5, funcheap: 6 };
const SOURCE_LABELS = {
  org: "Group calendar",
  sfpl: "SF Public Library",
  recpark: "SF Rec & Park",
  luma: "Luma",
  eventbrite: "Eventbrite",
  meetup: "Meetup",
  funcheap: "Funcheap",
};

const now = Date.now();
const from = now - 6 * 3600 * 1000;
const to = now + HORIZON_DAYS * 86400 * 1000;
const geo = openGeocoder(join(ROOT, "data", "geocache.json"));

const ONLINE_RE = /^(online|virtual|zoom|google meet|livestream|webinar)\b|zoom\.us|meet\.google/i;
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|a|an|and|of|at|in|sf|san francisco)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ORG_INDEX = ORGS.map((o) => ({ org: o, key: norm(o.name) })).filter((x) => x.key.length >= 5);
function matchOrg(...names) {
  for (const n of names) {
    const k = norm(n);
    if (k.length < 5) continue;
    const hit = ORG_INDEX.find((x) => x.key === k) ?? ORG_INDEX.find((x) => k.includes(x.key) || (k.length > 8 && x.key.includes(k)));
    if (hit) return hit.org;
  }
  return null;
}

function pickDomain(org, title, description) {
  if (!org) return classify(title, description);
  if (org.domains.length === 1) return org.domains[0];
  const guess = classify(title, description);
  return org.domains.includes(guess) ? guess : org.domains[0];
}

const idFor = (...parts) => createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);

// Decide where an org-feed instance happens and whether it is in the Sunset.
async function placeOrgInstance(inst, org, scope) {
  const location = inst.location?.trim() || null;
  if (location && ONLINE_RE.test(location)) {
    return scope === "local" ? { keep: true, online: true, lat: null, lng: null } : { keep: false };
  }
  let lat = inst.lat;
  let lng = inst.lng;
  if (!Number.isFinite(lat) && location) {
    const textSays = sunsetByText(location);
    if (textSays === false) return { keep: false };
    const g = await geo.geocode(location, { budget: GEOCODE_BUDGET });
    if (g) ({ lat, lng } = g);
    else if (textSays === true) return { keep: true, lat: org.lat ?? null, lng: org.lng ?? null, approx: true };
  }
  if (Number.isFinite(lat)) return { keep: inBox(lat, lng), lat, lng };
  if (!location && scope === "local") return { keep: true, lat: org.lat ?? null, lng: org.lng ?? null, approx: true };
  return { keep: scope === "local" && sunsetByText(location) !== false, lat: org.lat ?? null, lng: org.lng ?? null, approx: true };
}

function venueFrom(location, fallback) {
  if (!location) return fallback ?? null;
  const first = location.split(",")[0].trim();
  return /^\d/.test(first) ? fallback ?? first : first;
}

const sources = [];
const all = [];

// --- 1. Org feeds --------------------------------------------------------
for (const org of ORGS) {
  for (const feed of org.feeds ?? []) {
    if (feed.disabled) continue;
    const scope = feed.scope ?? (inBox(org.lat, org.lng) ? "local" : "filter");
    const label = `${org.name} (${feed.format})`;
    try {
      const text = await get(feed.url);
      const instances = parseByFormat(feed.format, text, feed, { from, to });
      const skip = feed.skip ? new RegExp(feed.skip, "i") : null;
      const perDay = {};
      let kept = 0;
      instances.sort((a, b) => a.startMs - b.startMs);
      for (const inst of instances) {
        if (!inst.title || !Number.isFinite(inst.startMs)) continue;
        if (inst.startMs < from || inst.startMs > to) continue;
        if (skip && skip.test(inst.title)) continue;
        const dk = pacificDayKey(inst.startMs);
        if ((perDay[dk] = (perDay[dk] ?? 0) + 1) > (feed.maxPerDay ?? Infinity)) continue;
        const place = await placeOrgInstance(inst, org, scope);
        if (!place.keep) continue;
        kept++;
        all.push({
          id: idFor("org", org.id, inst.uid ?? inst.url ?? inst.title, inst.startMs),
          title: inst.title.trim(),
          startMs: inst.startMs,
          endMs: inst.endMs ?? null,
          allDay: !!inst.allDay,
          url: inst.url || org.eventsPage || org.url,
          venue: place.online ? "Online" : venueFrom(inst.location, org.name),
          address: place.online ? null : inst.location ?? org.address ?? null,
          lat: place.lat ?? null,
          lng: place.lng ?? null,
          approxLocation: place.approx || undefined,
          online: place.online || undefined,
          org: org.name,
          orgId: org.id,
          source: "org",
          sourceLabel: `${org.name} calendar`,
          domain: pickDomain(org, inst.title, inst.description),
          description: inst.description ?? null,
          image: inst.image ?? null,
        });
      }
      sources.push({ id: `${org.id}:${feed.format}`, label, kind: "org", ok: true, count: kept });
      console.log(`fetch-events: ${label}: ${kept} in window and in the Sunset (${instances.length} parsed)`);
    } catch (err) {
      sources.push({ id: `${org.id}:${feed.format}`, label, kind: "org", ok: false, count: 0, error: String(err.message ?? err) });
      console.warn(`fetch-events: ${label} failed (${err.message ?? err})`);
    }
    await sleep(150);
  }
}

// --- 2. Aggregators ------------------------------------------------------
let aggregators = {};
try {
  aggregators = await import("./lib/aggregators.mjs");
} catch (err) {
  console.warn(`fetch-events: no aggregators module (${err.message})`);
}
for (const [name, fn] of Object.entries(aggregators)) {
  if (!/^fetch[A-Z]/.test(name) || typeof fn !== "function") continue;
  const label = name.replace(/^fetch/, "");
  try {
    const list = (await fn({ days: HORIZON_DAYS })) ?? [];
    let kept = 0;
    for (const e of list) {
      const startMs = parseLooseDate(e.start);
      if (!e.title || !startMs || startMs < from || startMs > to) continue;
      let { lat, lng } = e;
      if (!Number.isFinite(lat)) {
        lat = null;
        lng = null;
      }
      const where = [e.venue, e.address].filter(Boolean).join(", ");
      if (lat != null ? !inBox(lat, lng) : sunsetByText(where) !== true) continue;
      const org = matchOrg(e.org, e.venue);
      const source = e.source ?? label.toLowerCase();
      kept++;
      all.push({
        id: idFor(source, e.url, startMs),
        title: String(e.title).trim(),
        startMs,
        endMs: parseLooseDate(e.end) ?? null,
        allDay: !!e.allDay,
        url: e.url,
        venue: e.venue ?? null,
        address: e.address ?? null,
        lat,
        lng,
        org: org?.name ?? e.org ?? null,
        orgId: org?.id ?? null,
        source,
        sourceLabel: SOURCE_LABELS[source] ?? label,
        domain: pickDomain(org, e.title, e.description),
        description: e.description ?? null,
        image: e.image ?? null,
        free: e.free ?? undefined,
      });
    }
    sources.push({ id: label.toLowerCase(), label, kind: "aggregator", ok: true, count: kept });
    console.log(`fetch-events: aggregator ${label}: ${kept} in window and in the Sunset (${list.length} returned)`);
  } catch (err) {
    sources.push({ id: label.toLowerCase(), label, kind: "aggregator", ok: false, count: 0, error: String(err.message ?? err) });
    console.warn(`fetch-events: aggregator ${label} failed (${err.message ?? err})`);
  }
}

// --- 3. Merge duplicates across sources ----------------------------------
all.sort((a, b) => a.startMs - b.startMs || (PRIORITY[a.source] ?? 9) - (PRIORITY[b.source] ?? 9));
const byKey = new Map();
const merged = [];
for (const e of all) {
  const key = norm(e.title).slice(0, 48) + "|" + pacificDayKey(e.startMs);
  const twins = byKey.get(key) ?? [];
  const twin = twins.find((t) => Math.abs(t.startMs - e.startMs) <= 90 * 60000);
  if (twin) {
    const eWins = (PRIORITY[e.source] ?? 9) < (PRIORITY[twin.source] ?? 9);
    const winner = { ...(eWins ? e : twin) };
    const loser = eWins ? { ...twin } : e;
    for (const f of ["lat", "lng", "image", "description", "address", "venue", "endMs", "orgId", "org"]) {
      if (winner[f] == null && loser[f] != null) winner[f] = loser[f];
    }
    if (winner.approxLocation && loser.lat != null && !loser.approxLocation) {
      winner.lat = loser.lat;
      winner.lng = loser.lng;
      delete winner.approxLocation;
    }
    const also = [...(twin.alsoAt ?? []), loser.url].filter((u) => u && u !== winner.url);
    if (also.length) winner.alsoAt = [...new Set(also)];
    // Replace in place: `twin` is the object already in `merged`.
    for (const k of Object.keys(twin)) delete twin[k];
    Object.assign(twin, winner);
    continue;
  }
  twins.push(e);
  byKey.set(key, twins);
  merged.push(e);
}

// --- 4. Cap runaway series, finish fields --------------------------------
const perOrgDay = {};
const events = [];
for (const e of merged) {
  const day = pacificDayKey(e.startMs);
  const k = (e.orgId ?? e.org ?? e.source) + "|" + day;
  perOrgDay[k] = (perOrgDay[k] ?? 0) + 1;
  if (perOrgDay[k] > PER_ORG_PER_DAY) continue;
  const { startMs, endMs, ...rest } = e;
  for (const f of ["title", "venue", "address", "org", "description"]) {
    if (rest[f]) rest[f] = decodeEntities(rest[f]).replace(/\s+\u2014\s+|\u2014/g, ", ").trim();
  }
  // Feeds that post all-day events as midnight starts
  const p = partsIn(startMs);
  if (!rest.allDay && p.h === 0 && p.mi === 0) {
    const q = endMs ? partsIn(endMs) : null;
    if (!q || (q.h === 23 && q.mi >= 59) || (q.h === 0 && q.mi === 0)) rest.allDay = true;
  }
  events.push({
    ...rest,
    start: toPacificIso(startMs),
    end: endMs ? toPacificIso(endMs) : null,
    day,
    hood: hoodFor(e.lat, e.lng) ?? ORGS.find((o) => o.id === e.orgId)?.hood ?? "sunset-wide",
  });
  if (events.length >= TOTAL_CAP) break;
}

geo.save();
const failures = sources.filter((s) => !s.ok).length;
if (events.length === 0 && failures > sources.length / 2 && existsSync(OUT)) {
  console.warn("fetch-events: run came back empty with most sources failing; keeping the previous file");
} else {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        horizonDays: HORIZON_DAYS,
        note: "Generated by scripts/fetch-events.mjs. Do not edit by hand.",
        sources,
        events,
      },
      null,
      1
    ) + "\n"
  );
  const s = geo.stats();
  console.log(
    `fetch-events: wrote ${events.length} events from ${sources.length - failures}/${sources.length} sources (geocoder: ${s.lookups} new lookups, ${s.cached} cached)`
  );
}
