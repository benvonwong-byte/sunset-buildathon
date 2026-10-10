#!/usr/bin/env node
// Renders an event recap from recap/content.json and recap/template.html.
//
//   node recap/render.mjs site        > page for this site's /recap/ (the build does this)
//   node recap/render.mjs dearcrisis  > page for dearcrisis.com/buildathon
//   node recap/render.mjs doc         > the same words as plain HTML for a Google Doc
//
// content.json holds every word and every photo choice. template.html holds
// the look (CSS, the line-drawn skyline, the photo viewer, the thread
// filters) and never needs editing for a new event. Everything that can be
// counted is counted here, never typed: the filter chips and their numbers,
// "Showing all N dreams", the thread bars, the screen split, the photo count.
// The thread chips sit directly above the dream cards so pressing one visibly
// changes the list; keep it that way.
//
// Text fields are HTML: use &amp; for "&" and write links as <a> tags.
// "{site}" in any field becomes the Sunset site's address (SITE_URL), so the
// tool links follow the site when its domain changes.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SQUIG = '<svg class="squig" viewBox="0 0 120 9" preserveAspectRatio="none" aria-hidden="true"><path d="M3 5 C 30 2, 80 6.5, 117 3.5"/></svg>';
const SKY = (id) => `<svg class="skyline" id="${id}" viewBox="0 0 1200 110" preserveAspectRatio="xMidYMax slice" aria-hidden="true"></svg>`;
const SECTIONS = ["afternoon", "dreams", "built", "threads", "next", "thanks"];
const FORMATS = [
  { id: "analog", cls: "a", label: "Analog" },
  { id: "both", cls: "b", label: "Both" },
  { id: "digital", cls: "d", label: "Digital" },
];

// Attribute text. Photo captions also escape the apostrophe, so a caption is
// safe in any attribute and in the viewer's caption line.
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cap = (s) => attr(s).replace(/'/g, "&#x27;");
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&middot;/g, "·").replace(/&nbsp;/g, " ").replace(/&ndash;/g, "–").replace(/&times;/g, "×").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const pad = (n) => String(n).padStart(2, "0");
const clock = (t) => t.replace(/\s*[ap]m$/i, "");

export function loadContent(path = join(HERE, "content.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Counts the page shows, from the cards themselves.
export function tally(c) {
  const cards = c.dreams.cards;
  const threads = c.dreams.threads
    .map((t, i) => ({ ...t, i, n: cards.filter((d) => d.threads.includes(t.id)).length }))
    .sort((a, b) => b.n - a.n || a.i - b.i);
  const formats = FORMATS.map((f) => ({ ...f, n: cards.filter((d) => d.format === f.id).length }));
  return { dreams: cards.length, threads, formats, photos: c.photos.length };
}

// Checks a content file before anything is rendered from it.
export function validate(c) {
  const problems = [];
  const photoIds = new Set(c.photos.map((p) => p.n));
  const threadIds = new Set(c.dreams.threads.map((t) => t.id));
  const formatIds = new Set(FORMATS.map((f) => f.id));
  const usePhoto = (n, where) => n == null || photoIds.has(n) || problems.push(`${where}: photo ${n} is not in photos`);
  // A card shows the 840x560 crop, which photos.py makes only for photos with a "crop".
  const cropped = new Set(c.photos.filter((p) => p.crop).map((p) => p.n));
  const useCrop = (n, where) => n == null || cropped.has(n) || problems.push(`${where}: photo ${n} needs a "crop" in photos for its card image`);
  usePhoto(c.hero.photo, "hero");
  usePhoto(c.event.photo, "event.photo");
  c.timeline.items.forEach((it, i) => (it.photos ?? []).forEach((n) => usePhoto(n, `timeline item ${i + 1}`)));
  c.dreams.cards.forEach((d, i) => {
    const where = `dream card ${i + 1} (${plain(d.sign)})`;
    usePhoto(d.photo, where);
    usePhoto(d.inset, where);
    useCrop(d.photo, where);
    useCrop(d.inset, where);
    if (!d.threads?.length) problems.push(`${where}: no threads`);
    for (const t of d.threads ?? []) if (!threadIds.has(t)) problems.push(`${where}: unknown thread "${t}"`);
    if (!formatIds.has(d.format)) problems.push(`${where}: format must be analog, both or digital`);
    if (!d.name) problems.push(`${where}: no name. Use an abstract name like "The Gear Swapper" and set nameNotCaught`);
  });
  c.dreams.others.forEach((d, i) => {
    for (const n of [d.photo, d.inset]) usePhoto(n, `other card ${i + 1}`), useCrop(n, `other card ${i + 1}`);
  });
  c.built.cards.forEach((b, i) => (usePhoto(b.photo, `built card ${i + 1}`), useCrop(b.photo, `built card ${i + 1}`)));
  c.photos.forEach((p, i) => {
    if (p.n !== i + 1) problems.push(`photos[${i}]: numbered ${p.n}, expected ${i + 1} (photos run 1, 2, 3 in the order taken)`);
    if (!p.caption) problems.push(`photo ${p.n}: no caption`);
  });
  return problems;
}

function render(c, o) {
  const T = tally(c);
  const A = o.assets;
  const ph = (n) => c.photos[n - 1];
  const imgTag = (n, suffix, w, h) =>
    `<img src="${A}photos/${pad(n)}${suffix}.jpg" alt="${cap(ph(n).caption)}" width="${w}" height="${h}" loading="lazy">`;
  const thumb = (n) => {
    const p = ph(n);
    const [w, h] = p.w >= p.h ? [720, Math.round((720 * p.h) / p.w)] : [Math.round((720 * p.w) / p.h), 720];
    return `<button class="ph" type="button" role="listitem" data-i="${n}" aria-label="Open photo: ${cap(p.caption)}">${imgTag(n, "-t", w, h)}<span>${clock(p.time)}</span></button>`;
  };
  const cardPhoto = (d) =>
    d.photo == null
      ? ""
      : `      <div class="cphw"><button class="cph" type="button" data-i="${d.photo}" aria-label="Open photo: ${cap(ph(d.photo).caption)}">${imgTag(d.photo, "-c", 840, 560)}</button>` +
        (d.inset != null
          ? `<button class="cinset" type="button" data-i="${d.inset}" aria-label="Open photo: ${cap(ph(d.inset).caption)}">${imgTag(d.inset, "-c", 840, 560)}</button>`
          : "") +
        `<span class="ptime">${ph(d.photo).time}</span></div>\n`;
  const shead = (s) =>
    `  <div class="shead">\n    <p class="label">${s.label}</p>\n    <h2>${s.title}</h2>\n    ${SQUIG}\n` +
    (s.intro ? `    <p>${s.intro}</p>\n` : "") +
    `  </div>\n`;
  const chipLabel = Object.fromEntries(c.dreams.threads.map((t) => [t.id, t.chip]));
  const voice = (d, isDream) =>
    `    <article class="card${d.host ? " host" : ""}"${isDream ? ` data-t="${d.threads.join(" ")}"` : ""}>\n` +
    cardPhoto(d) +
    `      <div class="sign">${d.sign}</div>\n` +
    `      <div class="who"><p class="nm${d.nameNotCaught ? " anon" : ""}">${d.name}${d.nameNotCaught ? " <small>name not caught</small>" : ""}</p><p class="role">${d.role}</p></div>\n` +
    `      <p class="sum">${d.summary}</p>\n` +
    (d.quote ? `      <p class="quote">${d.quote}</p>\n` : "") +
    (d.ask ? `      <p class="ask"><b>Looking for</b>${d.ask}</p>\n` : "") +
    (isDream
      ? `      <div class="meta">${d.threads.map((t) => `<span class="tag">${chipLabel[t]}</span>`).join("")}<span class="fmt ${d.format}">${FORMATS.find((f) => f.id === d.format).label}</span></div>\n`
      : "") +
    `    </article>\n`;

  const m = c.masthead;
  const hero = ph(c.hero.photo);
  let b = "";
  b += `<header class="mast wrap">\n  <p class="pre">${m.pre}</p>\n  <h1>${m.title.map((t) => `<span>${t}</span>`).join("")}</h1>\n`;
  b += `  <svg class="under" viewBox="0 0 300 14" preserveAspectRatio="none" aria-hidden="true"><path d="M4 5 C 80 2, 190 4.5, 296 3"/><path d="M8 11 C 90 9, 200 11, 292 9"/></svg>\n`;
  b += `  <p class="when">${m.when}</p>\n  <p class="where">${m.where}</p>\n  <p class="lede">${m.lede}</p>\n`;
  b += `  <div class="facts">\n${m.facts.map(([n, l]) => `    <span><b>${n}</b>${l}</span>\n`).join("")}  </div>\n`;
  b += `  <p class="hosts">${m.hosts}</p>\n  ${SKY("sky-top")}\n</header>\n\n`;
  const titles = { afternoon: c.timeline.title, dreams: c.dreams.title, built: c.built.title, threads: c.threads.title, next: c.next.title, thanks: c.thanks.title };
  b += `<nav class="nav" aria-label="Sections"><div class="wrap">\n  ${SECTIONS.map((s) => `<a href="#${s}">${titles[s]}</a>`).join("")}\n</div></nav>\n\n<main class="wrap">\n\n`;
  b += `<figure class="hero">\n  <div class="frame"><img src="${A}photos/${pad(c.hero.photo)}.jpg" alt="${attr(c.hero.alt)}" width="${hero.w}" height="${hero.h}" fetchpriority="high"></div>\n`;
  b += `  <figcaption><span><span class="tm">${hero.time}</span>${c.hero.caption}</span><button class="allbtn" type="button" data-i="1">See all ${T.photos} photos</button></figcaption>\n</figure>\n\n`;

  // The afternoon: one fold-out row per step of the run of show. Closed, a
  // row shows its time, title and photo count; open, the text and photos.
  const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  b += `<section id="afternoon">\n${shead(c.timeline)}`;
  b += `  <div class="tlbar"><button class="tlall" type="button" id="tlall" aria-controls="timeline" aria-expanded="false">Open all steps</button></div>\n`;
  b += `  <ol class="timeline" id="timeline">\n`;
  for (const it of c.timeline.items) {
    const n = it.photos?.length ?? 0;
    b += `    <li${it.highlight ? ' class="walk"' : ""}><details class="step"><summary><span class="t">${it.time}</span><span class="sh"><h3>${it.title}</h3><span class="plan">${it.plan}</span></span>`;
    b += `<span class="more">${n ? `<span class="cnt">${n} photo${n === 1 ? "" : "s"}</span>` : ""}${CHEV}</span></summary><div class="body"><p>${it.text}</p>`;
    if (n) b += `<div class="strip" role="list">${it.photos.map(thumb).join("")}</div>`;
    b += `</div></details></li>\n`;
  }
  b += `  </ol>\n</section>\n\n`;

  // Dreams at the mic: chips straight above the cards they filter
  b += `<section id="dreams">\n${shead(c.dreams)}\n`;
  b += `  <div class="filters" id="filters" role="group" aria-label="Filter dreams by thread">\n`;
  b += `    <button class="chip" type="button" data-f="all" aria-pressed="true">All <span class="n">${T.dreams}</span></button>\n`;
  b += T.threads.map((t) => `    <button class="chip" type="button" data-f="${t.id}" aria-pressed="false">${t.chip} <span class="n">${t.n}</span></button>\n`).join("");
  b += `  </div>\n  <p class="showing" id="showing" aria-live="polite">Showing all ${T.dreams} dreams.</p>\n\n`;
  b += `  <div class="cards" id="dreamcards">\n\n${c.dreams.cards.map((d) => voice(d, true)).join("\n")}  </div>\n\n`;
  if (c.dreams.others?.length) {
    b += `  <p class="subhead">${c.dreams.othersLabel}</p>\n  <div class="cards">\n${c.dreams.others.map((d) => voice(d, false)).join("")}  </div>\n`;
  }
  b += `</section>\n\n`;

  // Built
  b += `<section id="built">\n${shead(c.built)}  <div class="built">\n`;
  b += c.built.cards
    .map((k) => {
      let s = `    <article class="bcard${k.wide ? " wide" : ""}">\n` + cardPhoto(k);
      s += `      <div class="top"><h3>${k.title}</h3><p class="by">${k.by}</p></div>\n`;
      if (k.date) s += `      <p class="date">${k.date}</p>\n`;
      if (k.summary) s += `      <p class="sum">${k.summary}</p>\n`;
      if (k.tools?.length) {
        s += `      <div class="tools">\n`;
        for (const t of k.tools) {
          s += `        <div class="tool">\n          <a class="shot" href="${t.url}" target="_blank" rel="noopener"><img src="${A}${t.shot}" alt="${attr(t.alt)}" width="${t.w ?? 1200}" height="${t.h ?? 800}" loading="lazy"></a>\n`;
          s += `          <h4>${t.name}</h4>\n          <p>${t.text}</p>\n          <p><a href="${t.url}" target="_blank" rel="noopener">${t.linkText}</a></p>\n        </div>\n`;
        }
        s += `      </div>\n`;
      }
      if (k.bullets?.length) s += `      <ul>\n${k.bullets.map((x) => `        <li>${x}</li>\n`).join("")}      </ul>\n`;
      if (k.quote) s += `      <p class="quote">${k.quote}</p>\n`;
      if (k.ask) s += `      <p class="ask"><b>${k.ask.label}</b>${k.ask.text}</p>\n`;
      return s + `    </article>\n`;
    })
    .join("\n");
  b += `  </div>\n</section>\n\n`;

  // Threads
  const th = c.threads;
  const max = Math.max(...T.threads.map((t) => t.n), 1);
  const fmts = T.formats.filter((f) => f.n > 0);
  b += `<section id="threads">\n${shead(th)}  <div class="threads">\n    <div class="panel">\n      <h3>${th.barsTitle}</h3>\n      <div class="bars">\n`;
  b += T.threads
    .map((t) => `        <div class="bar"><div class="row"><span>${t.bar}</span><span>${t.n}</span></div><div class="track"><div class="fill" style="width:${+((t.n / max) * 100).toFixed(1)}%"></div></div><p class="names">${t.names}</p></div>\n`)
    .join("");
  b += `      </div>\n    </div>\n    <div class="panel">\n      <h3>${th.screenTitle}</h3>\n`;
  b += `      <div class="split" role="img" aria-label="${fmts.map((f) => `${f.n} ${f.id}`).join(", ")}, out of ${T.dreams} dreams">\n`;
  b += fmts.map((f) => `        <div class="${f.cls}" style="flex:${f.n}">${f.n}</div>\n`).join("");
  b += `      </div>\n      <div class="legend">\n`;
  b += fmts.map((f) => `        <p><i class="sw ${f.cls}"></i><b>${f.label}, ${f.n}.</b> ${th.formats[f.id]}</p>\n`).join("");
  b += `      </div>\n      <ul class="findings">\n${th.findings.map((x) => `        <li><b>${x.lead}</b> ${x.text}</li>\n`).join("")}      </ul>\n    </div>\n  </div>\n</section>\n\n`;

  // What's next
  b += `<section id="next">\n${shead(c.next)}  <ul class="next">\n`;
  b += c.next.items.map((x) => `    <li><p class="d">${x.when}</p><h3>${x.title}</h3><p>${x.text}</p></li>\n`).join("");
  b += `  </ul>\n</section>\n\n`;

  // Thanks
  const k = c.thanks;
  b += `<section id="thanks">\n${shead(k)}  <div class="thanks">\n    <div>\n      <p class="closing">${k.closing}</p>\n      <p>${k.closingNote}</p>\n    </div>\n`;
  b += `    <ul class="credits">\n${k.credits.map((x) => `      <li>${x}</li>\n`).join("")}    </ul>\n  </div>\n</section>\n\n</main>\n\n`;

  b += `<footer>\n  ${SKY("sky-bottom")}\n  <div class="wrap">\n    <p>${c.footer}</p>\n    <p>${c.footerLine} &middot; Published by <a href="${o.home}">Dear Crisis</a></p>\n  </div>\n</footer>\n\n`;
  b += `<dialog class="lb" id="lb" aria-label="Photos">\n  <div class="lbin">\n    <div class="lbtop"><span id="lbcount">1 / ${T.photos}</span><button class="lbbtn" type="button" id="lbclose" aria-label="Close photos">&times;</button></div>\n`;
  b += `    <div class="lbstage" id="lbstage">\n      <img id="lbimg" alt="">\n      <button class="lbbtn lbnav prev" type="button" id="lbprev" aria-label="Previous photo">&lsaquo;</button>\n      <button class="lbbtn lbnav next" type="button" id="lbnext" aria-label="Next photo">&rsaquo;</button>\n    </div>\n    <p class="lbcap" id="lbcap"></p>\n  </div>\n</dialog>\n`;

  // Head: share preview and search text, every time (AGENTS.md).
  const p = c.page, e = c.event, v = e.venue;
  const img = `${o.imageBase}og.jpg`;
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${p.canonical}#recap`,
        headline: p.headline,
        description: p.summary,
        image: img,
        datePublished: p.published,
        dateModified: p.modified,
        url: p.canonical,
        mainEntityOfPage: p.canonical,
        inLanguage: "en-US",
        author: { "@type": "Organization", name: "Dear Crisis", url: "https://dearcrisis.com" },
        publisher: { "@type": "Organization", name: "Dear Crisis", url: "https://dearcrisis.com", logo: { "@type": "ImageObject", url: "https://dearcrisis.com/pigeon-logo.png" } },
        about: { "@id": `${p.canonical}#event` },
        keywords: p.keywords,
      },
      {
        "@type": "Event",
        "@id": `${p.canonical}#event`,
        name: e.name,
        description: e.description,
        startDate: e.start,
        endDate: e.end,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: {
          "@type": "Place",
          name: v.name,
          address: { "@type": "PostalAddress", streetAddress: v.street, addressLocality: v.locality, addressRegion: v.region, postalCode: v.postalCode, addressCountry: v.country },
          ...(v.lat != null ? { geo: { "@type": "GeoCoordinates", latitude: v.lat, longitude: v.lng } } : {}),
        },
        organizer: e.organizers.map((x) => ({ "@type": "Organization", name: x.name, url: x.url })),
        image: [img, `${o.imageBase}photos/${pad(e.photo)}.jpg`],
        url: e.url,
      },
    ],
  };
  const h = [
    `<title>${p.title}</title>`,
    `<meta name="description" content="${attr(p.description)}">`,
    `<link rel="canonical" href="${p.canonical}">`,
    `<meta name="robots" content="${o.robots}">`,
    ...(v.lat != null
      ? [
          `<meta name="geo.region" content="${v.country}-${v.region}">`,
          `<meta name="geo.placename" content="${attr(`${v.name}, ${v.locality}`)}">`,
          `<meta name="geo.position" content="${v.lat};${v.lng}">`,
          `<meta name="ICBM" content="${v.lat}, ${v.lng}">`,
        ]
      : []),
    `<link rel="icon" href="${o.favicon}" type="image/svg+xml">`,
    `<meta name="theme-color" content="#fbfaf5">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="Dear Crisis">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:title" content="${attr(p.shareTitle)}">`,
    `<meta property="og:description" content="${attr(p.shareDescription)}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:secure_url" content="${img}">`,
    `<meta property="og:image:type" content="image/jpeg">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${attr(p.shareImageAlt)}">`,
    `<meta property="og:url" content="${p.canonical}">`,
    `<meta property="article:published_time" content="${p.published}">`,
    `<meta property="article:modified_time" content="${p.modified}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${attr(p.shareTitle)}">`,
    `<meta name="twitter:description" content="${attr(p.shareDescription)}">`,
    `<meta name="twitter:image" content="${img}">`,
    `<meta name="twitter:image:alt" content="${attr(p.shareImageAlt)}">`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].join("\n");

  const photos = JSON.stringify(c.photos.map((x) => ({ n: pad(x.n), t: x.time, c: x.caption, w: x.w, h: x.h })));
  const names = JSON.stringify(Object.fromEntries(c.dreams.threads.map((t) => [t.id, plain(t.chip)])));
  return readFileSync(join(HERE, "template.html"), "utf8")
    .replace("{{head}}", () => h)
    .replace("{{body}}", () => b)
    .replace("{{photos}}", () => photos.replace(/</g, "\\u003c"))
    .replace("{{threadNames}}", () => names.replace(/</g, "\\u003c"))
    .replace("{{dreamCount}}", String(T.dreams))
    .replaceAll("{{assets}}", A)
    .replaceAll("{site}", o.site);
}

// The two places the page is published. site: this repo's /recap/, with its
// own copy of the photos. dearcrisis: dearcrisis.com/buildathon, where the
// photos live under public/buildathon/.
export function renderRecap(c, target, { site, robots = "index, follow, max-image-preview:large" } = {}) {
  const problems = validate(c);
  if (problems.length) throw new Error(`recap/content.json:\n  ${problems.join("\n  ")}`);
  if (target === "site") {
    return render(c, { assets: "", imageBase: `${site}recap/`, favicon: "../assets/favicon.svg", home: "https://dearcrisis.com/", robots, site });
  }
  if (target === "dearcrisis") {
    const base = `/${c.slug}/`;
    return render(c, { assets: base, imageBase: `https://dearcrisis.com${base}`, favicon: "/favicon.svg", home: "/", robots, site });
  }
  throw new Error(`unknown target "${target}": use site or dearcrisis`);
}

// Every word on the page, in reading order, as simple HTML. Upload it to
// Google Drive and open it as a Google Doc for editing; then copy the edits
// back into content.json.
export function renderDoc(c, { site }) {
  const T = tally(c);
  const chip = Object.fromEntries(c.dreams.threads.map((t) => [t.id, t.chip]));
  const p = (s) => `<p>${s}</p>`;
  const card = (d) =>
    `<h3>${d.sign}</h3>` +
    p(`<b>${d.name}</b>${d.nameNotCaught ? " (name not caught)" : ""}. ${d.role}`) +
    p(d.summary) +
    (d.quote ? p(`<i>"${d.quote}"</i>`) : "") +
    (d.ask ? p(`<b>Looking for:</b> ${d.ask}`) : "") +
    (d.threads ? p(`<small>Threads: ${d.threads.map((t) => chip[t]).join(", ")}. Needs a screen: ${d.format}.</small>`) : "");
  let o = `<html><head><meta charset="utf-8"><title>${plain(c.page.title)}: text</title></head><body>`;
  o += `<h1>${c.masthead.title.join(" ")}</h1>`;
  o += `<h2>Link preview and search text</h2>`;
  o += p(`<b>Page title:</b> ${c.page.title}`) + p(`<b>Description:</b> ${c.page.description}`);
  o += p(`<b>Share title:</b> ${c.page.shareTitle}`) + p(`<b>Share description:</b> ${c.page.shareDescription}`) + p(`<b>Share image alt text:</b> ${c.page.shareImageAlt}`);
  o += `<h2>Masthead</h2>` + p(c.masthead.pre) + p(c.masthead.when) + p(c.masthead.where) + p(c.masthead.lede);
  o += p(c.masthead.facts.map(([n, l]) => `${n} ${l}`).join(" · ")) + p(c.masthead.hosts) + p(`<b>Hero caption:</b> ${c.hero.caption}`);
  o += `<h2>${c.timeline.title}</h2>` + p(c.timeline.intro ?? "");
  for (const it of c.timeline.items) o += `<h3>${it.time} ${it.title}</h3>` + p(`<i>${it.plan}</i>`) + p(it.text);
  o += `<h2>${c.dreams.title}</h2>` + p(c.dreams.intro ?? "") + c.dreams.cards.map(card).join("");
  o += `<h2>${c.dreams.othersLabel}</h2>` + c.dreams.others.map(card).join("");
  o += `<h2>${c.built.title}</h2>` + p(c.built.intro ?? "");
  for (const k of c.built.cards) {
    o += `<h3>${k.title}</h3>` + p(`<i>${k.by}</i>`) + (k.date ? p(k.date) : "") + (k.summary ? p(k.summary) : "");
    for (const t of k.tools ?? []) o += `<h4>${t.name}</h4>` + p(t.text) + p(t.url);
    if (k.bullets) o += `<ul>${k.bullets.map((x) => `<li>${x}</li>`).join("")}</ul>`;
    if (k.quote) o += p(`<i>"${k.quote}"</i>`);
    if (k.ask) o += p(`<b>${k.ask.label}:</b> ${k.ask.text}`);
  }
  o += `<h2>${c.threads.title}</h2>` + p(c.threads.intro ?? "");
  o += `<h3>${c.threads.barsTitle}</h3><ul>${T.threads.map((t) => `<li><b>${t.bar}, ${t.n}.</b> ${t.names}</li>`).join("")}</ul>`;
  o += `<h3>${c.threads.screenTitle}</h3><ul>${T.formats.map((f) => `<li><b>${f.label}, ${f.n}.</b> ${c.threads.formats[f.id]}</li>`).join("")}</ul>`;
  o += `<ul>${c.threads.findings.map((x) => `<li><b>${x.lead}</b> ${x.text}</li>`).join("")}</ul>`;
  o += `<h2>${c.next.title}</h2>` + p(c.next.intro ?? "") + `<ul>${c.next.items.map((x) => `<li><b>${x.when}: ${x.title}.</b> ${x.text}</li>`).join("")}</ul>`;
  o += `<h2>${c.thanks.title}</h2>` + p(c.thanks.closing) + p(c.thanks.closingNote) + `<ul>${c.thanks.credits.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  o += `<h2>Footer</h2>` + p(c.footer) + p(c.footerLine);
  o += `<h2>Photo captions</h2><ol>${c.photos.map((x) => `<li>${x.time}: ${attr(x.caption)}</li>`).join("")}</ol>`;
  return (o + `</body></html>\n`).replaceAll("{site}", site);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  const site = (process.env.SITE_URL || "https://sunset.dearcrisis.com/").replace(/\/*$/, "/");
  const c = loadContent();
  try {
    process.stdout.write(target === "doc" ? renderDoc(c, { site }) : renderRecap(c, target, { site }));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
