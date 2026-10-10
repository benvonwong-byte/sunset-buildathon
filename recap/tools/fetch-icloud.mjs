#!/usr/bin/env node
// Downloads every photo in a shared iCloud album, in the order taken.
//
//   node recap/tools/fetch-icloud.mjs <share link or token> <work folder>
//
// Writes <work>/raw/01_<name>.jpg, 02_..., and <work>/items.json with each
// photo's number, file, original name, local time taken, width and height.
// Photos come down at iCloud's medium size (about 2200px on the long side),
// with any edits made in Photos applied, which is plenty for the web.
//
// iCloud has no public API for shared albums: anonymous calls to CloudKit
// answer 401. So this opens the album in headless Chromium the way a browser
// would, keeps the record lists the page itself asks for, scrolls until all
// of them have loaded, then downloads each photo through the same browser.
// Needs Playwright (npm i -g playwright, or set PLAYWRIGHT to its path).
// Keep the album link private: it opens every photo in it, and nothing in
// this repo should name it.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const [link, work] = process.argv.slice(2);
if (!link || !work) {
  console.error("usage: node recap/tools/fetch-icloud.mjs <share link or token> <work folder>");
  process.exit(1);
}
const token = link.replace(/^.*[#/]/, "");
mkdirSync(join(work, "raw"), { recursive: true });

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();

const masters = new Map();
const assets = new Map();
let expected = null;
page.on("response", async (res) => {
  if (!/records\/(query|lookup)/.test(res.url())) return;
  try {
    for (const r of (await res.json()).records ?? []) {
      if (r.recordType === "CPLMaster") masters.set(r.recordName, r.fields);
      else if (r.recordType === "CPLAsset") assets.set(r.recordName, r.fields);
      else if (r.recordType === "IndexCountResult") expected = Math.max(expected ?? 0, r.fields.itemCount?.value ?? 0);
    }
  } catch {}
});

await page.goto(`https://www.icloud.com/photos/#${token}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(12000);
let still = 0;
for (let i = 0; i < 80 && still < 6; i++) {
  const before = assets.size;
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(1200);
  still = assets.size === before ? still + 1 : 0;
  if (expected && assets.size >= expected) break;
}
console.log(`found ${assets.size} photos${expected ? ` of ${expected}` : ""}`);

const b64 = (v) => (v ? Buffer.from(v, "base64").toString("utf8") : "");
const list = [...assets.values()]
  .filter((a) => !a.isDeleted?.value && !a.isHidden?.value)
  .map((a) => {
    const m = masters.get(a.masterRef?.value?.recordName) ?? {};
    const res = a.resJPEGMedRes?.value ?? m.resJPEGMedRes?.value;
    const w = (a.resJPEGMedRes ? a.resJPEGMedWidth : m.resJPEGMedWidth)?.value;
    const h = (a.resJPEGMedRes ? a.resJPEGMedHeight : m.resJPEGMedHeight)?.value;
    return { name: b64(m.filenameEnc?.value) || "photo.jpg", taken: a.assetDate?.value, offset: a.timeZoneOffset?.value ?? 0, url: res?.downloadURL, w, h };
  })
  .filter((x) => x.url && x.taken)
  .sort((a, b) => a.taken - b.taken);

const items = [];
for (const [i, x] of list.entries()) {
  const n = i + 1;
  const file = `raw/${String(n).padStart(2, "0")}_${x.name.replace(/[^\w.-]+/g, "_").replace(/\.\w+$/, "")}.jpg`;
  const res = await ctx.request.get(x.url.replace("${f}", encodeURIComponent(x.name)));
  if (!res.ok()) {
    console.error(`photo ${n}: download failed (${res.status()})`);
    continue;
  }
  writeFileSync(join(work, file), await res.body());
  // Local clock time where the photo was taken, like "2:41 pm".
  const local = new Date(x.taken + x.offset * 1000);
  const hh = local.getUTCHours(), mm = String(local.getUTCMinutes()).padStart(2, "0");
  const time = `${hh % 12 || 12}:${mm} ${hh < 12 ? "am" : "pm"}`;
  items.push({ n, file, name: x.name, taken: new Date(x.taken).toISOString(), time, w: x.w, h: x.h });
}
writeFileSync(join(work, "items.json"), JSON.stringify(items, null, 2) + "\n");
console.log(`saved ${items.length} photos to ${join(work, "raw")} and ${join(work, "items.json")}`);
await browser.close();
