// Address to coordinates, cached in data/geocache.json so a daily run only
// looks up strings it has never seen. Street addresses go to the US Census
// geocoder; venue names fall back to OpenStreetMap Nominatim, limited to San
// Francisco and paced at one request a second per its usage policy.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { UA, sleep } from "./http.mjs";
import { landmark, gridGeocode } from "./geo.mjs";

const RETRY_AFTER_MS = 30 * 86400000;
const SF_VIEWBOX = "-122.52,37.81,-122.35,37.70";

const GENERIC = new Set(
  "the and of at park street st ave avenue blvd boulevard way center centre church school san francisco sf lawn field room hall library branch building garden gardens cafe house main north south east west upper lower inner outer".split(" ")
);
function significantWords(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
}

export function openGeocoder(cachePath) {
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  let lastNominatim = 0;
  let lookups = 0;

  const key = (s) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.,]+$/, "").trim();

  async function census(q) {
    const u = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    u.searchParams.set("address", q);
    u.searchParams.set("benchmark", "Public_AR_Current");
    u.searchParams.set("format", "json");
    const res = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const m = (await res.json()).result?.addressMatches?.[0];
    return m ? { lat: m.coordinates.y, lng: m.coordinates.x } : null;
  }

  async function nominatim(q) {
    const wait = 1100 - (Date.now() - lastNominatim);
    if (wait > 0) await sleep(wait);
    lastNominatim = Date.now();
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q", q);
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("limit", "1");
    u.searchParams.set("viewbox", SF_VIEWBOX);
    u.searchParams.set("bounded", "1");
    const res = await fetch(u, {
      headers: { "User-Agent": `${UA} (+https://github.com/benvonwong-byte/sunset-buildathon)` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const hit = (await res.json())[0];
    if (!hit) return null;
    // Free-text search happily matches part of a name ("Sloat Pleasant Hill"
    // lands on Sloat Blvd). Every distinctive word of the place has to show
    // up in the answer, or it is not the place.
    const words = significantWords(q.split(",")[0]);
    const found = String(hit.display_name).toLowerCase();
    if (!words.length || !words.every((w) => found.includes(w))) return null;
    return { lat: Number(hit.lat), lng: Number(hit.lon) };
  }

  async function geocode(raw, { budget = Infinity } = {}) {
    if (!raw || /^(online|virtual|zoom|tbd|tba)\b/i.test(raw.trim())) return null;
    // Landmarks and grid intersections need no network and no cache.
    // A leading house number ("1305 18th Ave") goes to the Census instead.
    const hasHouseNumber = /^\s*\d+[a-z]?\s/i.test(raw.split(",")[0]);
    const local = landmark(raw) ?? (hasHouseNumber ? null : gridGeocode(raw));
    if (local) return local;
    const k = key(raw);
    const hit = cache[k];
    if (hit && (hit.lat != null || Date.now() - hit.at < RETRY_AFTER_MS)) {
      return hit.lat != null ? { lat: hit.lat, lng: hit.lng } : null;
    }
    if (lookups >= budget) return null;
    lookups++;
    let q = raw.replace(/\s+/g, " ").trim();
    if (!/san francisco|\bsf\b|, ca\b|california/i.test(q)) q += ", San Francisco, CA";
    let result = null;
    try {
      if (/^\s*\d+[a-z]?\s+\w/i.test(q.split(",").find((p) => /\d/.test(p)) ?? "")) {
        const street = q.split(",").find((p) => /^\s*\d+[a-z]?\s+\w/i.test(p));
        result = await census(`${street.trim()}, San Francisco, CA`);
      }
      if (!result) result = await nominatim(q);
    } catch (err) {
      console.warn(`geocode: "${raw}" failed (${err.message})`);
      return null;
    }
    cache[k] = result ? { ...result, at: Date.now() } : { lat: null, lng: null, at: Date.now() };
    return result;
  }

  function save() {
    const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(cachePath, JSON.stringify(sorted, null, 1) + "\n");
  }

  return { geocode, save, stats: () => ({ lookups, cached: Object.keys(cache).length }) };
}
