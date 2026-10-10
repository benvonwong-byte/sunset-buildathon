#!/usr/bin/env node
// Draws the 1200x630 share cards that WhatsApp, Signal, iMessage and search
// show for a link: a masthead panel (series line, title in brush lettering,
// dateline, footer with the Dear Crisis pigeon) beside a photo panel. One
// layout for every page, the same one dearcrisis.com uses for its salons.
//
//   node recap/tools/card.mjs            draw every card in recap/cards/cards.json
//   node recap/tools/card.mjs og-space   draw only cards whose output path matches
//
// Needs Playwright (npm i -g playwright, or set PLAYWRIGHT to its path) and
// network access for the Google fonts. Each card is written as a JPEG and
// must stay under 280,000 bytes: WhatsApp drops larger images without saying
// so. The photo panel is 468x630; give it an image at twice that (936x1260)
// cropped the way you want it shown.

import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_BYTES = 280_000;
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const page = (c) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat+Brush&family=Figtree:wght@600;700&family=Special+Elite&display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;overflow:hidden;background:#fbfaf5}
.card{display:grid;grid-template-columns:732px 468px;width:1200px;height:630px}
.text{padding:52px 60px 44px;display:flex;flex-direction:column;color:#1b1a17}
.top{border-top:7px solid #1b1a17;border-bottom:1.5px solid #1b1a17;padding:16px 0 13px;display:flex;justify-content:space-between;font:400 21px/1 'Special Elite',monospace;letter-spacing:.06em;text-transform:uppercase}
.top .l{color:#8a5a06}.top .r{color:#6f6a5e}
.bar{width:104px;height:7px;background:#e3a63f;border-radius:4px;margin-top:62px}
h1{font:400 ${c.titleSize ?? 98}px/.98 'Caveat Brush',cursive;margin-top:20px;letter-spacing:.005em}
.under{width:420px;height:16px;margin-top:6px}
.under path{fill:none;stroke:#e3a63f;stroke-width:3;stroke-linecap:round}
.date{margin-top:22px;font:400 22px/1.45 'Special Elite',monospace;letter-spacing:.05em;text-transform:uppercase;color:#4b483f}
.foot{margin-top:auto;border-top:1.5px solid #1b1a17;padding-top:16px;display:flex;justify-content:space-between;align-items:center;font:700 19px/1 'Figtree',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#4b483f}
.foot img{height:34px}
.photo{background:#ddd ${c.position ?? "center"}/cover no-repeat url('${pathToFileURL(resolve(ROOT, c.panel)).href}')${c.panelRule ? ";border-left:1.5px solid #1b1a17" : ""}}
</style></head><body><div class="card">
<div class="text">
 <div class="top"><span class="l">${c.series}</span><span class="r">${c.kind}</span></div>
 <div class="bar"></div>
 <h1>${c.title.join("<br>")}</h1>
 <svg class="under" viewBox="0 0 420 16" preserveAspectRatio="none"><path d="M3 5 C 110 2, 270 5, 417 3"/><path d="M8 12 C 120 10, 280 12, 412 10"/></svg>
 <p class="date">${c.dateline.join("<br>")}</p>
 <div class="foot"><span>${c.footer}</span><img src="${pathToFileURL(join(ROOT, "site/assets/pigeon.png")).href}" alt=""></div>
</div>
<div class="photo"></div>
</div></body></html>`;

const only = process.argv[2];
const cards = JSON.parse(readFileSync(join(ROOT, "recap/cards/cards.json"), "utf8")).filter((c) => !only || c.out.includes(only));
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
let failed = false;
for (const c of cards) {
  const tmp = join(ROOT, "dist", ".card.html");
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, page(c));
  await tab.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
  await tab.evaluate(() => document.fonts.ready);
  const fonts = await tab.evaluate(() => document.fonts.check('40px "Caveat Brush"') && document.fonts.check('20px "Special Elite"'));
  const out = join(ROOT, c.out);
  for (const quality of [86, 80, 74, 68]) {
    await tab.screenshot({ path: out, type: "jpeg", quality });
    if (statSync(out).size <= MAX_BYTES) break;
  }
  const bytes = statSync(out).size;
  if (bytes > MAX_BYTES || !fonts) failed = true;
  console.log(`${c.out}: ${bytes} bytes${fonts ? "" : ", FONTS DID NOT LOAD"}${bytes > MAX_BYTES ? ", OVER 280,000" : ""}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
