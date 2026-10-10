#!/usr/bin/env node
// Screenshots for a recap's "built that day" cards: opens each page at
// 1440x960 in light mode, waits for it to settle, and saves a 1200x800 JPEG.
//
//   node recap/tools/screenshot.mjs <url> <out.jpg> [<url> <out.jpg> ...]
//
// For this recap:
//   node recap/tools/screenshot.mjs https://sunset.dearcrisis.com/events/ site/recap/tools/events.jpg \
//     https://sunset.dearcrisis.com/space/ site/recap/tools/space.jpg
//
// Needs Playwright (npm i -g playwright, or set PLAYWRIGHT to its path).

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const args = process.argv.slice(2);
if (!args.length || args.length % 2) {
  console.error("usage: node recap/tools/screenshot.mjs <url> <out.jpg> [<url> <out.jpg> ...]");
  process.exit(1);
}
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "light" });
for (let i = 0; i < args.length; i += 2) {
  const [url, out] = [args[i], args[i + 1]];
  const page = await ctx.newPage();
  // Smooth scrolling mid-capture leaves blank bands, so turn it off.
  await page.addInitScript(() => document.documentElement.style.setProperty("scroll-behavior", "auto", "important"));
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(4000);
  const png = await page.screenshot();
  const small = await ctx.newPage();
  await small.setViewportSize({ width: 1200, height: 800 });
  await small.setContent(`<body style="margin:0"><img src="data:image/png;base64,${png.toString("base64")}" style="width:1200px;height:800px;display:block">`);
  await small.screenshot({ path: out, type: "jpeg", quality: 82 });
  console.log(`${url} -> ${out}`);
  await small.close();
  await page.close();
}
await browser.close();
