#!/usr/bin/env node
// Guard: every page someone might share ships its link preview and its search
// text. Runs on dist/ after scripts/build.mjs, because the build fills in the
// site address, the robots and geo tags and the JSON-LD.
//
//   node scripts/build.mjs && node scripts/check-preview.mjs
//
// Give it the same SITE_URL the build had.
//
// Von's rule from dearcrisis.com (2026-10-10): a page is not done until
// WhatsApp, Signal and search engines get a drawn 1200x630 card and plain
// text about it. For each page in PAGES this checks:
//
//   - <title>, meta description of 50 characters or more, canonical link
//   - og:title, og:description, og:url, og:image (+ width, height, alt)
//   - twitter:card summary_large_image and twitter:image
//   - robots and geo.position tags, and a JSON-LD block that parses
//   - no placeholder left unfilled (__SITE__, <!--ROBOTS--> and the rest)
//   - the og:image file itself: in dist/, JPEG, 1200x630, at most 280,000
//     bytes (WhatsApp drops the picture silently above 300,000)
//
// It cannot tell a drawn card from a cropped photo. That part is the rule in
// AGENTS.md.

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const W = 1200, H = 630, MAX_BYTES = 280_000;
// Same default and override as scripts/build.mjs.
const BASE = (process.env.SITE_URL || "https://sunset.dearcrisis.com/").replace(/\/*$/, "/");

// The flyer is left out on purpose: it is a print layout, noindex, and its
// share tags point at the home page.
const PAGES = ["index.html", "events/index.html", "space/index.html", "recap/index.html"];

// Width and height from a JPEG's start-of-frame marker, or null if it is not a JPEG.
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSOF) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

const attr = (html, re) => (html.match(re) || [])[1];
const meta = (html, key) => attr(html, new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`, "i"));

if (!existsSync(join(DIST, "index.html"))) {
  console.error("check-preview: dist/ is empty. Run node scripts/build.mjs first.");
  process.exit(1);
}

const problems = [];
let checked = 0;
for (const file of PAGES) {
  const at = join(DIST, file);
  if (!existsSync(at)) { problems.push(`${file}: page missing from dist/`); continue; }
  checked++;
  const html = readFileSync(at, "utf8");
  const miss = (what) => problems.push(`${file}: ${what}`);

  const left = html.match(/__[A-Z]+__|<!--(?:ROBOTS|GEO|JSONLD)-->/);
  if (left) miss(`placeholder left unfilled: ${left[0]}`);
  if (!/<title>[^<]{5,}<\/title>/i.test(html)) miss("no <title>");
  const desc = meta(html, "description");
  if (!desc || desc.length < 50) miss("meta description missing or under 50 characters");
  const canonical = attr(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
  if (!canonical || !/^https:\/\//.test(canonical)) miss("no absolute canonical link");
  for (const key of ["og:title", "og:description", "og:url", "og:image:alt", "twitter:image", "robots", "geo.position"]) {
    if (!meta(html, key)) miss(`no ${key}`);
  }
  if (meta(html, "twitter:card") !== "summary_large_image") miss("twitter:card is not summary_large_image");
  if (meta(html, "og:image:width") !== String(W) || meta(html, "og:image:height") !== String(H)) {
    miss(`og:image:width/height are not ${W}x${H}`);
  }

  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  if (blocks.length === 0) miss("no JSON-LD block");
  for (const [, body] of blocks) {
    try { JSON.parse(body); } catch { miss("JSON-LD block does not parse"); }
  }

  // The image must be served by this site, from the address the build used.
  const img = meta(html, "og:image");
  if (!img) { miss("no og:image"); continue; }
  if (!img.startsWith(BASE)) { miss(`og:image is not an absolute URL on ${BASE}: ${img}`); continue; }
  const rel = img.slice(BASE.length);
  const path = join(DIST, rel);
  if (!existsSync(path)) { miss(`og:image file not found: dist/${rel}`); continue; }
  const size = jpegSize(readFileSync(path));
  if (!size) miss(`og:image is not a JPEG: ${img}`);
  else if (size.width !== W || size.height !== H) miss(`og:image is ${size.width}x${size.height}, not ${W}x${H}`);
  const bytes = statSync(path).size;
  if (bytes > MAX_BYTES) miss(`og:image is ${bytes} bytes, over the ${MAX_BYTES} budget WhatsApp needs`);
}

for (const f of ["sitemap.xml", "robots.txt", "llms.txt"]) {
  if (!existsSync(join(DIST, f))) problems.push(`${f}: missing from dist/`);
}

if (problems.length) {
  console.error(
    `check-preview: ${problems.length} problem(s) with link previews or search text:\n` +
      problems.map((p) => `  - ${p}`).join("\n") +
      "\nEvery shared page needs a drawn 1200x630 card and the tags above. See AGENTS.md."
  );
  process.exit(1);
}
console.log(`check-preview: ok (${checked} pages ship a card and search text; sitemap, robots and llms.txt present)`);
