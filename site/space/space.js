// Sunset Idle Space, the anti-opening hours: storefronts in the Inner and Outer Sunset that
// are closed at a chosen hour between 9 AM and midnight, with an estimate of their floor
// space, so a group can ask the owner to host it while the doors are shut.
//
// Three separate pieces: the time bar (always on screen), the list of spaces (left panel
// on desktop, bottom sheet on phones) and one space (a drawer on desktop, its own sheet on
// phones). Choosing a time never moves the space you are reading, and the other way round.
// Data: spaces.json and basemap.json, made by tools/space (see tools/space/README.md).
// Street View photos appear when the build sets a browser key in config.js.

const SV_KEY = (window.SPACE_CONFIG && window.SPACE_CONFIG.streetViewKey) || "";

Promise.all(["spaces.json", "basemap.json"].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); })))
  .then(([data, base]) => start(data, base))
  .catch((e) => {
    console.error(e);
    document.getElementById("cards").innerHTML = '<div class="empty"><b>The map data did not load</b><span>Reload the page to try again.</span></div>';
  });

function start(DATA, BASE) {
  
  /* ================= constants & helpers ================= */
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const W0 = 18, W1 = 48, PAGE = 30;
  const ICON = {
    food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2.5 1.5-3.5 4-3.5 7s1 3.5 3.5 3.5"/>',
    retail: '<path d="M5 8h14l-1 12H6L5 8zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
    personal: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8 8l12 9M8 16 20 7"/>',
    health: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
    active: '<path d="M3 10v4M6.5 7.5v9M17.5 7.5v9M21 10v4M6.5 12h11"/>',
    office: '<path d="M4 8h16v11H4zM9 8V5.5h6V8M4 13h16"/>',
    auto: '<path d="M5 15l1.6-5h10.8L19 15M4 15h16v4H4zM7 19v1.5M17 19v1.5"/>',
    community: '<path d="M3 10l9-6 9 6M5.5 10v8M10 10v8M14 10v8M18.5 10v8M3 20h18"/>',
    other: '<circle cx="12" cy="12" r="3"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    pencil: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/>',
  };
  const ic = (name, size = 16) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
  const CATS = [["food", "Food & drink"], ["retail", "Shops"], ["personal", "Personal care"], ["health", "Health"], ["active", "Fitness & classes"], ["office", "Offices"], ["auto", "Auto"], ["community", "Faith & community"], ["other", "Other"]];
  const DEFAULT_CATS = CATS.map(c => c[0]).filter(c => c !== "community");
  const SIZES = [[0, "Any size"], [500, "500+ sq ft"], [1000, "1,000+"], [2000, "2,000+"], [4000, "4,000+"]];
  const PRESETS = [["Weekday lunch", 1, 24], ["Weekday evening", 1, 38], ["Late night", 4, 46], ["Weekend afternoon", 5, 28]];
  
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => Math.round(n).toLocaleString("en-US");
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const mq = matchMedia("(max-width: 899px)");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  
  function tm(s) {                       // half-hour slot → "7:30 PM"
    if (s >= 48) return "midnight";
    const h = Math.floor(s / 2), half = s % 2, ap = h < 12 ? "AM" : "PM", h12 = ((h + 11) % 12) + 1;
    return `${h12}${half ? ":30" : ""} ${ap}`;
  }
  const statusAt = (r, d, s) => !r.w ? "unknown" : r.w[d * 48 + s] === "1" ? "open" : r.w[d * 48 + s] === "0" ? "closed" : "unknown";
  function nextFlip(r, d, s, want) {
    const start = d * 48 + s;
    for (let k = 1; k <= 336; k++) { const i = (start + k) % 336; if (r.w[i] === want) return { d: Math.floor(i / 48), s: i % 48, k }; }
    return null;
  }
  function whenText(f, d) {
    if (!f) return null;
    const t = tm(f.s);
    if (f.d === d && f.k < 48) return t;
    if (f.d === (d + 1) % 7 && f.k < 96) return `tomorrow ${t}`;
    return `${DAYS[f.d]} ${t}`;
  }
  function idleHours(r) {
    if (r._idle !== undefined) return r._idle;
    let n = 0;
    if (r.w) for (let d = 0; d < 7; d++) for (let s = W0; s < W1; s++) if (r.w[d * 48 + s] === "0") n++;
    return (r._idle = r.w ? n / 2 : 0);
  }
  function statusInfo(r) {
    const st = statusAt(r, state.day, state.slot);
    if (st === "closed") { const f = nextFlip(r, state.day, state.slot, "1"); return { st, text: f ? `Closed until ${whenText(f, state.day)}` : "Closed all week" }; }
    if (st === "open") { const f = nextFlip(r, state.day, state.slot, "0"); return { st, text: f ? `Open until ${whenText(f, state.day)}` : "Open all week" }; }
    return { st, text: "Hours not listed" };
  }
  function dayRows(r) {                  // "9 AM – 5 PM" per day, from the half-hour grid
    return DAYS.map((d, di) => {
      const segs = []; let a = null;
      for (let s = 0; s <= 48; s++) {
        const open = s < 48 && r.w[di * 48 + s] === "1";
        if (open && a === null) a = s;
        if (!open && a !== null) { segs.push([a, s]); a = null; }
      }
      if (!segs.length) return "Closed";
      if (segs.length === 1 && segs[0][0] === 0 && segs[0][1] === 48) return "Open 24 hours";
      return segs.map(([x, y]) => `${x === 0 ? "12 AM" : tm(x)} – ${y === 48 ? "midnight" : tm(y)}`).join(", ");
    });
  }
  
  /* sequential ramp (cream → umber): first stop recedes into the paper */
  const RAMP = ["#f7efda", "#f2e0b4", "#ecca83", "#e3a63f", "#c98a1f", "#a46c12", "#7c500c", "#553608"];
  const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  function rampColor(t) {
    t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i, a = hex2rgb(RAMP[i]), b = hex2rgb(RAMP[i + 1]);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
  }
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  
  /* ================= state ================= */
  const state = {
    day: 0, slot: 38, tab: "closed", hood: "both", cats: new Set(DEFAULT_CATS), minSq: 0, sort: "size", view: "list",
    sel: null, listN: PAGE, weekOpen: false, filtersOpen: false,
  };
  const byId = new Map(DATA.map(r => [r.id, r]));
  
  function setNow() {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value;
    const wd = DAYS.indexOf(get("weekday")), h = +get("hour"), m = +get("minute");
    state.day = wd < 0 ? 0 : wd;
    state.slot = Math.max(W0, Math.min(W1 - 1, h * 2 + (m >= 30 ? 1 : 0)));
  }
  
  /* ================= filtering & sorting ================= */
  const passHood = r => state.hood === "both" || r.h === state.hood;
  const passSize = r => !state.minSq || r.est >= state.minSq;
  const passCat = r => state.cats.has(r.c);
  let base = [], parts = { closed: [], open: [], unknown: [] }, list = [], sqIdle = 0, catClosed = {};
  function reopenK(r) { if (!r.w) return 0; const f = nextFlip(r, state.day, state.slot, "1"); return f ? f.k : 999; }
  function sortRows(rows) {
    const a = rows.slice();
    let s = state.sort; if (s === "late" && state.tab !== "closed") s = "size";
    const bySize = (x, y) => (y.est || 0) - (x.est || 0) || x.n.localeCompare(y.n);
    if (s === "name") a.sort((x, y) => x.n.localeCompare(y.n));
    else if (s === "idle") a.sort((x, y) => idleHours(y) - idleHours(x) || bySize(x, y));
    else if (s === "late") a.sort((x, y) => reopenK(y) - reopenK(x) || bySize(x, y));
    else a.sort(bySize);
    return a;
  }
  function compute() {
    base = []; parts = { closed: [], open: [], unknown: [] }; catClosed = {}; sqIdle = 0;
    for (const r of DATA) {
      if (!passHood(r) || !passSize(r)) continue;
      const st = statusAt(r, state.day, state.slot);
      if (st === "closed") catClosed[r.c] = (catClosed[r.c] || 0) + 1;
      if (!passCat(r)) continue;
      base.push(r); parts[st].push(r);
      if (st === "closed") sqIdle += r.est || 0;
    }
    list = sortRows(parts[state.tab]);
  }
  const filterCount = () => (state.hood !== "both") + (state.minSq > 0) + (state.cats.size !== DEFAULT_CATS.length || DEFAULT_CATS.some(c => !state.cats.has(c)));
  
  /* ================= plan drawings ================= */
  function planSvg(r, W, H, full) {
    const pl = r.plan;
    if (!pl) return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect class="pl-bg" width="${W}" height="${H}"/></svg>`;
    const rings = [pl.l, pl.b].filter(Boolean), pts = rings.flat().concat([pl.p]);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = full ? 26 : 12, w = Math.max(x1 - x0, 20), h = Math.max(y1 - y0, 20);
    const k = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const X = x => (W / 2 + (x - cx) * k).toFixed(1), Y = y => (H / 2 - (y - cy) * k).toFixed(1);
    const path = ring => "M" + ring.map(([x, y]) => `${X(x)} ${Y(y)}`).join("L") + "Z";
    let o = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect class="pl-bg" width="${W}" height="${H}"/>`;
    if (full) for (let g = 0; g <= W; g += 20) o += `<path class="pl-grid" d="M${g} 0V${H}"/>`;
    if (full) for (let g = 0; g <= H; g += 20) o += `<path class="pl-grid" d="M0 ${g}H${W}"/>`;
    if (pl.l) o += `<path class="pl-lot" d="${path(pl.l)}"/>`;
    if (pl.b) o += `<path class="pl-bldg" d="${path(pl.b)}"/>`;
    o += `<circle class="pl-pin" cx="${X(pl.p[0])}" cy="${Y(pl.p[1])}" r="${full ? 5 : 3.5}"/>`;
    if (full) {
      if (pl.d) o += `<text class="pl-txt" x="14" y="${H - 12}">Building ≈ ${pl.d[0]} × ${pl.d[1]} ft</text>`;
      o += `<text class="pl-txt" x="${W - 14}" y="22" text-anchor="end">N ↑</text>`;
    }
    return o + "</svg>";
  }
  const thumbHtml = (r, W, H) => `<div class="thumb">${r.ph ? `<img src="${esc(r.ph)}" alt="" loading="lazy">` : planSvg(r, W, H, false)}</div>`;
  
  /* ================= map ================= */
  const [bx0, by0, bx1, by1] = BASE.bbox;
  const map = L.map("map", {
    zoomControl: false, attributionControl: false, minZoom: 12, maxZoom: 19, zoomSnap: 0.25, preferCanvas: true,
    maxBounds: [[by0 - 0.06, bx0 - 0.09], [by1 + 0.06, bx1 + 0.09]], maxBoundsViscosity: 0.6,
  });
  L.control.attribution({ prefix: false, position: mq.matches ? "topright" : "bottomleft" })
    .addAttribution(mq.matches
      ? '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a> · <a href="https://data.sfgov.org" target="_blank" rel="noopener">DataSF</a>'
      : 'Map & places © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · City data: <a href="https://data.sfgov.org" target="_blank" rel="noopener">DataSF</a>')
    .addTo(map);
  if (!mq.matches) L.control.zoom({ position: "bottomright" }).addTo(map);
  map.createPane("base"); map.getPane("base").style.zIndex = 250;
  map.createPane("labels"); map.getPane("labels").style.zIndex = 350; map.getPane("labels").style.pointerEvents = "none";
  const baseR = L.canvas({ pane: "base", padding: 0.4 });
  const poiR = L.canvas({ padding: 0.4, tolerance: mq.matches ? 12 : 6 });
  
  const HOME = [[37.7335, -122.5105], [37.7675, -122.4520]];
  const tbH = () => $("timebar").getBoundingClientRect().bottom;
  // The part of the map nobody is covering: below the time bar, above the sheet (phone)
  // or left of the drawer (desktop).
  function clearArea() {
    const detailOpen = !!state.sel;
    if (mq.matches) {
      const cover = detailOpen ? window.innerHeight - $("detail").getBoundingClientRect().top : $("panel").getBoundingClientRect().height;
      return { top: tbH(), bottom: Math.max(0, cover), right: 0 };
    }
    // The drawer covers the map's right edge on wide screens and the list on smaller ones.
    const m = $("map").getBoundingClientRect(), d = $("detail").getBoundingClientRect();
    return { top: tbH(), bottom: 0, right: detailOpen && d.left > m.left + 1 ? Math.max(0, m.right - d.left) : 0 };
  }
  let fitting = false, interacted = false;
  function fitHome() {
    fitting = true;
    const a = clearArea();
    map.fitBounds(HOME, { paddingTopLeft: [8, a.top + 8], paddingBottomRight: [a.right + 8, a.bottom + 8], animate: false });
    fitting = false;
  }
  map.on("zoomstart dragstart", () => { if (!fitting) interacted = true; });
  const mapEl = $("map");
  new ResizeObserver(() => {
    if (!mapEl.clientWidth || !mapEl.clientHeight) return;
    map.invalidateSize({ pan: false });
    if (!interacted) fitHome();
  }).observe(mapEl);
  
  const baseLayers = {};
  const geo = (g, key) => { if (g) baseLayers[key] = L.geoJSON(g, { renderer: baseR, pane: "base", interactive: false }).addTo(map); };
  geo(BASE.ocean, "ocean"); geo(BASE.sand, "sand"); geo(BASE.green, "green"); geo(BASE.water, "water");
  const roadLayers = { 1: [], 2: [], 3: [], 4: [] };
  BASE.roads.forEach(r => roadLayers[r.c].push({ type: "Feature", geometry: r.g, properties: {} }));
  [4, 3, 2, 1].forEach(c => { baseLayers["road" + c] = L.geoJSON({ type: "FeatureCollection", features: roadLayers[c] }, { renderer: baseR, pane: "base", interactive: false }).addTo(map); });
  baseLayers.hoods = L.geoJSON({ type: "FeatureCollection", features: BASE.hoods.map(h => ({ type: "Feature", geometry: h.g, properties: {} })) }, { renderer: baseR, pane: "base", interactive: false }).addTo(map);
  (function styleBase() {
    const ink = cssVar("--ink"), st = (k, s) => baseLayers[k] && baseLayers[k].setStyle(s);
    st("ocean", { color: ink, weight: 1, opacity: 0.35, fillColor: cssVar("--water"), fillOpacity: 1 });
    st("water", { color: ink, weight: 0.8, opacity: 0.3, fillColor: cssVar("--water"), fillOpacity: 1 });
    st("sand", { stroke: false, fillColor: cssVar("--sand"), fillOpacity: 1 });
    st("green", { stroke: false, fillColor: cssVar("--park"), fillOpacity: 1 });
    st("road4", { color: ink, weight: 0.8, opacity: 0.14, dashArray: "2 3" });
    st("road3", { color: ink, weight: 1, opacity: 0.16 });
    st("road2", { color: ink, weight: 1.6, opacity: 0.34 });
    st("road1", { color: ink, weight: 2.4, opacity: 0.5 });
    st("hoods", { color: ink, weight: 1.3, opacity: 0.45, dashArray: "7 6", fill: false });
  })();
  
  function snapTo(name, lat, lon) {
    let best = null, bd = Infinity;
    BASE.roads.forEach(r => {
      if (r.n !== name) return;
      (r.g.type === "LineString" ? [r.g.coordinates] : r.g.coordinates).forEach(line => line.forEach(([x, y]) => {
        const dd = (x - lon) ** 2 + (y - lat) ** 2; if (dd < bd) { bd = dd; best = [y, x]; }
      }));
    });
    return best || [lat, lon];
  }
  function label(ll, text, cls, vertical) {
    L.marker(ll, { pane: "labels", interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [0, 0],
      html: `<div class="lbl ${cls}" style="transform:translate(-50%,-50%)${vertical ? " rotate(-90deg)" : ""}">${esc(text)}</div>` }) }).addTo(map);
  }
  [["Irving St", 37.7637, -122.4920, 0], ["Judah St", 37.7617, -122.4985, 0], ["Noriega St", 37.7539, -122.4895, 0], ["Taraval St", 37.7428, -122.5070, 0],
   ["Lincoln Way", 37.7655, -122.5040, 0], ["Sloat Blvd", 37.7345, -122.4950, 0], ["19th Avenue", 37.7575, -122.4758, 1], ["Sunset Boulevard", 37.7480, -122.4945, 1],
   ["Great Highway", 37.7520, -122.5085, 1]].forEach(([n, lat, lon, v]) => label(snapTo(n, lat, lon), n.replace(/ (St|Way|Blvd)$/, ""), "", v));
  [["Golden Gate Park", 37.7695, -122.4835, "big", 0], ["Pacific Ocean", 37.7485, -122.5135, "sea", 1], ["Inner Sunset", 37.7605, -122.4655, "big", 0],
   ["Outer Sunset", 37.7580, -122.4990, "big", 0], ["Parkside", 37.7410, -122.4870, "big", 0]].forEach(([n, lat, lon, cls, v]) => label([lat, lon], n, cls, v));
  
  /* street names appear when zoomed in, set along the street */
  const streetLabels = L.layerGroup();
  (function buildStreetLabels() {
    const seen = new Map(), KX = 111320 * Math.cos(37.75 * Math.PI / 180), KY = 110540;
    BASE.roads.filter(r => r.n && r.c <= 3).forEach(r => {
      const line = r.g.type === "LineString" ? r.g.coordinates : r.g.coordinates.reduce((a, b) => (a.length > b.length ? a : b), []);
      if (line.length < 2) return;
      let len = 0; for (let i = 1; i < line.length; i++) len += Math.hypot((line[i][0] - line[i - 1][0]) * KX, (line[i][1] - line[i - 1][1]) * KY);
      if (len < 110) return;
      let acc = 0, i = 1; while (i < line.length - 1 && acc < len / 2) { acc += Math.hypot((line[i][0] - line[i - 1][0]) * KX, (line[i][1] - line[i - 1][1]) * KY); i++; }
      const a = line[i - 1], b = line[i], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const cell = `${r.n}|${Math.round(mx * KX / 260)}|${Math.round(my * KY / 260)}`;
      if (seen.has(cell)) return; seen.set(cell, 1);
      let ang = -Math.atan2((b[1] - a[1]) * KY, (b[0] - a[0]) * KX) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      L.marker([my, mx], { pane: "labels", interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [0, 0],
        html: `<div class="lbl" style="transform:translate(-50%,-50%) rotate(${ang.toFixed(0)}deg)">${esc(r.n.replace(/ (Street|Avenue|Boulevard|Way|Drive|Road|Court|Terrace|Place|Lane|St|Ave|Blvd)$/, ""))}</div>` }) }).addTo(streetLabels);
    });
  })();
  const syncStreetLabels = () => { const on = map.getZoom() >= 16; if (on && !map.hasLayer(streetLabels)) streetLabels.addTo(map); else if (!on && map.hasLayer(streetLabels)) map.removeLayer(streetLabels); };
  map.on("zoomend", syncStreetLabels);
  
  /* markers */
  const markers = new Map();
  const layerUnknown = L.layerGroup().addTo(map), layerOpen = L.layerGroup().addTo(map), layerClosed = L.layerGroup().addTo(map);
  const radiusOf = r => r.est ? Math.max(4.5, Math.min(17, 2.5 + Math.sqrt(r.est) / 7.5)) : 4.5;
  // On a mouse or trackpad, hovering a dot shows the place's name, size and whether it is
  // closed at the chosen time. Touch screens skip it: a tap opens the space.
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const tipHtml = r => {
    const s = statusInfo(r);
    return `<b>${esc(r.n)}</b><span>${r.est ? `~${fmt(r.est)} sq ft · ` : ""}${esc(s.text)}</span>`;
  };
  DATA.forEach(r => {
    const m = L.circleMarker([r.lat, r.lon], { renderer: poiR, radius: radiusOf(r), bubblingMouseEvents: false });
    m.on("click", () => select(r.id, { fromMap: true }));
    if (canHover) {
      m.bindTooltip(() => tipHtml(r), { direction: "top", className: "sptip", opacity: 1 });
      m.on("mouseover", () => { if (r.id !== state.sel) placeRing(hoverRing, r.id); });
      m.on("mouseout", () => placeRing(hoverRing, null));
    }
    markers.set(r.id, m);
  });
  const ring = L.circleMarker([0, 0], { renderer: poiR, radius: 12, color: "#1b1a17", weight: 2.5, fill: false, interactive: false });
  const hoverRing = L.circleMarker([0, 0], { renderer: poiR, radius: 12, color: "#1b1a17", weight: 1.5, dashArray: "3 3", fill: false, interactive: false });
  function placeRing(layer, id) {
    if (!id) { map.removeLayer(layer); return; }
    const r = byId.get(id); layer.setLatLng([r.lat, r.lon]).setRadius(radiusOf(r) + 6);
    if (!map.hasLayer(layer)) layer.addTo(map);
    layer.bringToFront();
  }
  function styleMarkers() {
    const ink = cssVar("--ink"), mustard = cssVar("--mustard"), open = cssVar("--open"), paper = cssVar("--paper"), muted = cssVar("--muted");
    layerClosed.clearLayers(); layerOpen.clearLayers(); layerUnknown.clearLayers();
    for (const r of base) {
      const m = markers.get(r.id), st = statusAt(r, state.day, state.slot);
      if (st === "closed") {
        m.setStyle({ stroke: true, color: ink, weight: 1.4, opacity: 1, fill: true, fillColor: mustard, fillOpacity: 0.95 }); m.setRadius(radiusOf(r)); layerClosed.addLayer(m);
      } else if (st === "open") {
        m.setStyle({ stroke: true, color: paper, weight: 1, opacity: 1, fill: true, fillColor: open, fillOpacity: 1 }); m.setRadius(3.8); layerOpen.addLayer(m);
      } else {
        m.setStyle({ stroke: true, color: muted, weight: 1.1, opacity: 0.55, fill: true, fillColor: paper, fillOpacity: 0.6 }); m.setRadius(Math.max(3.8, radiusOf(r) * 0.6)); layerUnknown.addLayer(m);
      }
    }
    if (state.sel) placeRing(ring, state.sel);
    // Keep each name just above its dot, whatever size the dot is now.
    if (canHover) for (const r of base) { const m = markers.get(r.id), t = m.getTooltip(); if (t) t.options.offset = [0, -(m.getRadius() + 3)]; }
  }
  function focusOn(id) {
    const r = byId.get(id), z = Math.max(map.getZoom(), 17), ll = L.latLng(r.lat, r.lon), a = clearArea();
    // Put the place in the middle of the clear part of the map.
    const c = map.unproject(map.project(ll, z).add([a.right / 2, (a.bottom - a.top) / 2]), z);
    interacted = true;
    map.setView(c, z, { animate: !reduceMotion });
  }
  $("recenter").onclick = () => { interacted = false; fitHome(); };

  /* ================= time bar height ================= */
  // Everything below the bar (map padding, the phone sheets, the recenter button)
  // reads --tb-h, so the Week view can open without anything else jumping.
  const root = document.documentElement;
  new ResizeObserver(() => { root.style.setProperty("--tb-h", Math.round(tbH()) + "px"); }).observe($("timebar"));
  root.style.setProperty("--tb-h", Math.round(tbH()) + "px");

  /* ================= bottom sheet (phone) ================= */
  const panel = $("panel"), app = $("app");
  const SH = { name: "half" };
  const sheetHeights = () => { const vh = window.innerHeight; return { peek: 132, half: Math.round(vh * 0.5), full: Math.max(260, vh - tbH() - 8) }; };
  function setSheet(name, instant) {
    if (!mq.matches) { panel.style.height = ""; return; }
    SH.name = name;
    panel.style.transition = instant ? "none" : "";
    panel.style.height = sheetHeights()[name] + "px";
    if (instant) requestAnimationFrame(() => { panel.style.transition = ""; });
  }
  let drag = null;
  const ptop = $("ptop");
  ptop.addEventListener("pointerdown", e => {
    if (!mq.matches || e.target.closest("button, select, input, a, label")) return;
    drag = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: false, grip: !!e.target.closest(".grab"), s: [{ y: e.clientY, t: e.timeStamp }] };
    ptop.setPointerCapture(e.pointerId);
  });
  ptop.addEventListener("pointermove", e => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true; panel.style.transition = "none";
    const hs = sheetHeights();
    panel.style.height = Math.max(hs.peek, Math.min(hs.full, drag.h - dy)) + "px";
    drag.s.push({ y: e.clientY, t: e.timeStamp }); if (drag.s.length > 4) drag.s.shift();
  });
  function endDrag() {
    if (!drag) return;
    const d = drag; drag = null; panel.style.transition = "";
    if (!d.moved) { if (d.grip) setSheet(SH.name === "peek" ? "half" : SH.name === "half" ? "full" : "half"); return; }
    const hs = sheetHeights(), names = ["peek", "half", "full"], cur = panel.getBoundingClientRect().height;
    const a = d.s[0], b = d.s[d.s.length - 1], v = (b.y - a.y) / Math.max(1, b.t - a.t);   // px/ms, + = moving down
    let target;
    if (Math.abs(v) > 0.35) {                        // a flick goes one snap in its direction
      const below = names.filter(n => hs[n] <= cur + 8), above = names.filter(n => hs[n] >= cur - 8);
      target = v < 0 ? (above.find(n => hs[n] > cur + 8) || "full") : ([...below].reverse().find(n => hs[n] < cur - 8) || "peek");
    } else target = names.reduce((best, n) => Math.abs(hs[n] - cur) < Math.abs(hs[best] - cur) ? n : best, "half");
    setSheet(target);
  }
  ptop.addEventListener("pointerup", endDrag);
  ptop.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", () => { setSheet(SH.name, true); });

  /* ================= rendering ================= */
  function renderHead() {
    $("whentxt").textContent = tm(state.slot);
    const n = parts.closed.length;
    $("suma").innerHTML = `<b>${n}</b> ${n === 1 ? "space" : "spaces"} closed <span class="at">${DAYS_LONG[state.day]} at ${tm(state.slot)}</span>`;
    $("sumb").textContent = `~${fmt(sqIdle)} sq ft of floor space · ${parts.open.length} open · ${parts.unknown.length} with no hours posted`;
  }
  function renderWhen() {
    [...$("days").children].forEach((b, i) => b.setAttribute("aria-pressed", String(i === state.day)));
    $("time").value = state.slot;
    $("time").setAttribute("aria-valuetext", `${DAYS_LONG[state.day]} ${tm(state.slot)}`);
    [...$("presets").children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.d === String(state.day) && b.dataset.s === String(state.slot))));
    $("weekbtn").setAttribute("aria-expanded", String(state.weekOpen));
    $("weekpanel").hidden = !state.weekOpen;
    if (state.weekOpen) renderHeat();
  }
  function renderTabs() {
    const T = [["closed", "Closed"], ["open", "Open"], ["unknown", "No hours"]];
    $("tabs").innerHTML = T.map(([k, l]) => `<button class="tab" role="tab" type="button" data-k="${k}" aria-selected="${state.tab === k}">${l}<b>${parts[k].length}</b></button>`).join("");
    const note = $("tabnote");
    if (state.tab === "unknown") { note.hidden = false; note.innerHTML = "We can't tell when these are closed because no hours are posted online. If you know them, open a space and tap <b>Add hours</b>."; }
    else if (state.tab === "open") { note.hidden = false; note.textContent = "Open at this time, so a good moment to drop by and ask. Try another time to see when they close."; }
    else note.hidden = true;
  }
  function renderFilters() {
    const n = filterCount();
    $("fbadge").hidden = !n; $("fbadge").textContent = n;
    $("filterbtn").setAttribute("aria-expanded", String(state.filtersOpen));
    $("filters").hidden = !state.filtersOpen;
    $("clear").hidden = !n;
    [...$("hood").children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === state.hood)));
    [...$("cats").children].forEach(b => { b.setAttribute("aria-pressed", String(state.cats.has(b.dataset.k))); b.querySelector(".n").textContent = catClosed[b.dataset.k] || 0; });
    [...$("sizes").children].forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === state.minSq)));
    $("sort").value = state.sort;
    $("vlist").setAttribute("aria-pressed", String(state.view === "list")); $("vgrid").setAttribute("aria-pressed", String(state.view === "grid"));
  }
  function cardHtml(r) {
    const s = statusInfo(r), grid = state.view === "grid";
    return `<button class="card" type="button" data-id="${esc(r.id)}" ${r.id === state.sel ? 'aria-current="true"' : ""}>
      ${thumbHtml(r, grid ? 160 : 120, 120)}
      <div><div class="cn">${esc(r.n)}</div><div class="cm">${esc(cap(r.t))}${r.a ? " · " + esc(r.a) : ""}</div>
      <div class="cs">${r.est ? `<span class="sz">~${fmt(r.est)}<small>sq ft</small></span>` : ""}<span class="st ${s.st}">${esc(s.text)}</span></div></div>
    </button>`;
  }
  function renderList() {
    const el = $("cards"); el.dataset.mode = state.view;
    const rows = list.slice(0, state.listN);
    if (!rows.length) {
      const msg = state.tab === "closed" ? "No closed spaces match" : "Nothing here";
      el.innerHTML = `<div class="empty"><b>${msg}</b><span>Try another time, or loosen the filters.</span>${filterCount() ? '<button class="pillbtn" data-act="clear" type="button">Reset filters</button>' : ""}</div>`;
      el.style.display = "block";
    } else { el.style.display = ""; el.innerHTML = rows.map(cardHtml).join(""); }
    const more = $("more"); more.hidden = list.length <= state.listN;
    more.textContent = `Show ${Math.min(PAGE, list.length - state.listN)} more`;
  }

  /* ---- one space ---- */
  function weekSvg(r) {
    const cw = 9, ch = 15, gap = 1.2, lw = 30, cols = W1 - W0, W = lw + cols * (cw + gap), H = 7 * (ch + gap) + 16;
    let o = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly hours, 9 AM to midnight. Mustard is closed.">`;
    for (let d = 0; d < 7; d++) {
      o += `<text x="0" y="${d * (ch + gap) + ch - 4}">${DAYS[d]}</text>`;
      for (let s = W0; s < W1; s++) {
        const c = r.w[d * 48 + s], f = c === "0" ? "var(--mustard)" : c === "1" ? "var(--open)" : "var(--well)";
        o += `<rect class="wcell" data-d="${d}" data-s="${s}" x="${lw + (s - W0) * (cw + gap)}" y="${d * (ch + gap)}" width="${cw}" height="${ch}" rx="2" fill="${f}"/>`;
      }
    }
    o += `<rect class="sel" x="${lw + (state.slot - W0) * (cw + gap) - 1.5}" y="${state.day * (ch + gap) - 1.5}" width="${cw + 3}" height="${ch + 3}" rx="3"/>`;
    [[18, "9 AM"], [24, "12 PM"], [30, "3 PM"], [36, "6 PM"], [42, "9 PM"]].forEach(([s, t]) => { o += `<text x="${lw + (s - W0) * (cw + gap)}" y="${H - 2}">${t}</text>`; });
    return o + "</svg>";
  }
  function whyText(r) {
    if (r.conf === "unknown") return "Large building with one known tenant, so this business's share of the floor is unknown.";
    if (!r.ground) return "";
    return `Ground floor is about ${fmt(r.ground)} sq ft${r.share > 1 ? `, split ${r.share} ways` : ""}, less 15% for walls and stairs.`;
  }
  // When a closed spell started: walk back from (d, s) while the place stays closed.
  function closedSince(r, d, s) {
    const at = d * 48 + s;
    for (let k = 1; k < 336; k++) { const i = (at - k + 336) % 336; if (r.w[i] !== "0") { const j = (i + 1) % 336; return { d: Math.floor(j / 48), s: j % 48 }; } }
    return null;
  }
  const dayTime = (p) => `${DAYS_LONG[p.d]} ${tm(p.s)}`;
  // The window to ask in, and the window the group could use, at the chosen time.
  function outreach(r) {
    if (!r.w) return { rows: [["Hours", "Not posted online"], ["Drop by", "Check the place's own listing first"]], day: null, from: null };
    const st = statusAt(r, state.day, state.slot);
    let closedFrom, reopen, openFrom, openUntil;
    if (st === "closed") {
      closedFrom = closedSince(r, state.day, state.slot);
      reopen = nextFlip(r, state.day, state.slot, "1");
      openFrom = reopen;
      openUntil = reopen && nextFlip(r, reopen.d, reopen.s, "0");
    } else {
      closedFrom = nextFlip(r, state.day, state.slot, "0");
      reopen = closedFrom && nextFlip(r, closedFrom.d, closedFrom.s, "1");
      openFrom = { d: state.day, s: state.slot, now: true };
      openUntil = closedFrom;
    }
    const rows = [];
    if (st === "closed") {
      rows.push(["Closed", !reopen ? "All week, by its posted hours" : closedFrom ? `${dayTime(closedFrom)} to ${dayTime(reopen)}` : `until ${dayTime(reopen)}`]);
      if (openFrom) rows.push(["Drop by", openUntil ? `${dayTime(openFrom)} to ${openUntil.d === openFrom.d ? tm(openUntil.s) : dayTime(openUntil)}` : dayTime(openFrom)]);
    } else {
      rows.push(["Closes", !closedFrom ? "Never, by its posted hours" : reopen ? `${dayTime(closedFrom)} to ${dayTime(reopen)}` : `${dayTime(closedFrom)}, for the rest of the week`]);
      rows.push(["Drop by", closedFrom ? `Now, until ${whenText(closedFrom, state.day)}` : "Any time it's open"]);
    }
    return { rows, day: closedFrom ? DAYS_LONG[closedFrom.d] : null, from: closedFrom ? tm(closedFrom.s) : null };
  }
  function noteText(r, o) {
    const when = o.day ? `on ${o.day}s from ${o.from}` : "in the hours you're closed";
    return `Hi! I'm a neighbor in the Sunset and I help organize small community gatherings. ${r.n} looks to be closed ${when}. Would you be open to a group using the space then, once a month to start? We'd keep it small, leave it as we found it, and work around your schedule.`;
  }
  const shareUrl = () => location.href.split("#")[0] + "#" + hashFor(true);
  function renderDetail() {
    const r = byId.get(state.sel); if (!r) return;
    const s = statusInfo(r), idle = idleHours(r), o = outreach(r);
    const slides = [];
    if (SV_KEY) slides.push(`<div class="slide sv"><img src="https://maps.googleapis.com/maps/api/streetview?size=640x400&location=${r.lat},${r.lon}&fov=80&source=outdoor&return_error_code=true&key=${encodeURIComponent(SV_KEY)}" alt="Street View near ${esc(r.n)}"><span class="slidecap">Google Street View</span></div>`);
    if (r.ph) slides.push(`<div class="slide"><img src="${esc(r.ph)}" alt="Storefront of ${esc(r.n)}" loading="lazy"></div>`);
    slides.push(`<div class="slide">${planSvg(r, 320, 200, true)}<span class="slidecap">Lot and building from city data</span></div>`);
    const link = (href, icon, text, cls = "") => `<a class="act ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${ic(icon, 17)}${text}</a>`;
    const q = encodeURIComponent(`${r.n} ${r.a || ""} San Francisco`.trim());
    const acts = [
      link(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${r.lat},${r.lon}`, "eye", "Street View"),
      link(`https://www.google.com/maps/search/?api=1&query=${q}`, "pin", "Google Maps"),
    ];
    if (r.web && /^https?:\/\//.test(r.web)) acts.push(link(r.web, "globe", "Website"));
    if (/^(node|way)\//.test(r.id)) { const [t, n] = r.id.split("/"); acts.push(link(`https://www.openstreetmap.org/edit?${t}=${n}`, "pencil", r.w ? "Fix hours" : "Add hours")); }
    else acts.push(link(`https://www.openstreetmap.org/edit#map=19/${r.lat}/${r.lon}`, "pencil", "Add hours"));
    const facts = [];
    if (r.est) facts.push(["Est. space", `~${fmt(r.est)} sq ft`]);
    if (r.plan?.d) facts.push(["Building shape", `${r.plan.d[0]} × ${r.plan.d[1]} ft`]);
    if (r.bldg) facts.push(["Building area", `${fmt(r.bldg)} sq ft`]);
    if (r.fp) facts.push(["Footprint", `${fmt(r.fp)} sq ft`]);
    if (r.stories) facts.push(["Stories", r.stories]);
    if (r.units) facts.push(["Homes in building", r.units]);
    if (r.share > 1) facts.push(["Shares floor with", `${r.share - 1} other${r.share - 1 > 1 ? "s" : ""}`]);
    if (r.zone) facts.push(["Zoning", r.zone]);
    if (r.use) facts.push(["City use code", r.use.replace(/,/g, ", ")]);
    if (r.built && r.built !== "0") facts.push(["Built", r.built]);
    if (r.reg) facts.push(["Registered", r.reg]);
    const rows = r.w ? dayRows(r) : null;
    const srcNote = r.hs === "site" ? `Hours read from <a href="${esc(r.hurl)}" target="_blank" rel="noopener">the business's website</a>. Check them before you call.`
      : r.w ? "Hours from OpenStreetMap contributors." : "No hours are posted online for this place yet.";
    $("dbody").innerHTML = `
      <div class="hero"><span class="st ${s.st}">${esc(s.text)}</span>
        <div class="slides" id="slides">${slides.join("")}</div>
        ${slides.length > 1 ? `<div class="dots" id="dots">${slides.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}
      </div>
      <div class="dhead">
        <h2 class="dname">${esc(r.n)}</h2>
        <p class="dsub">${esc(cap(r.t))}${r.a ? " · " + esc(r.a) : ""} · ${r.h === "i" ? "Inner" : "Outer"} Sunset</p>
        ${r.est ? `<div class="dsize"><span class="num">~${fmt(r.est)}</span><span class="unit">sq ft</span><span class="badge2 ${r.conf}">${r.conf === "good" ? "Good estimate" : "Rough estimate"}</span></div>` : ""}
        <p class="dwhy">${esc(whyText(r))}</p>
      </div>
      <section class="ask" aria-label="Ask to use this space">
        <h3>Ask to use it</h3>
        <dl class="when">${o.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
        <p class="msg" id="msg">${esc(noteText(r, o))}</p>
        <div class="row">
          <button class="act primary" type="button" data-copy="note">Copy this note</button>
          <button class="act" type="button" data-copy="link">Copy link to this space</button>
        </div>
      </section>
      <div class="acts">${acts.join("")}</div>
      ${r.w ? `<section class="sec wk"><p class="h4">When it's closed</p>${weekSvg(r)}
        <div class="key"><span><i style="background:var(--mustard)"></i>Closed</span><span><i style="background:var(--open)"></i>Open</span><span>Tap a square to check another time</span></div>
        <p style="margin-top:10px">Closed <b>${idle}</b> of 105 hours a week between 9 AM and midnight${r.est ? `, about <b>${fmt(idle * r.est)}</b> sq-ft-hours a group could use` : ""}.</p></section>
      <section class="sec"><p class="h4">Opening hours</p><div class="hrows">${rows.map((t, i) => `<div class="hrow ${i === state.day ? "today" : ""}"><span>${DAYS[i]}</span><span class="${t === "Closed" ? "cl" : ""}">${esc(t)}</span></div>`).join("")}</div></section>` : ""}
      <section class="sec"><p class="h4">About the space</p><dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></section>
      <section class="sec src">${srcNote}</section>`;
    const sl = $("slides"), dots = $("dots");
    const sv = sl.querySelector(".sv img");   // no Street View here: drop the slide and fall back to the plan
    if (sv) sv.addEventListener("error", () => { sv.closest(".slide").remove(); if (dots && sl.children.length < 2) dots.remove(); else if (dots) dots.lastElementChild.remove(); }, { once: true });
    if (dots) sl.addEventListener("scroll", () => { const i = Math.round(sl.scrollLeft / sl.clientWidth); [...dots.children].forEach((d, j) => d.classList.toggle("on", i === j)); }, { passive: true });
    const i = list.findIndex(x => x.id === r.id);
    $("dpos").textContent = i < 0 ? `${list.length} in list` : `${i + 1} of ${list.length}`;
    $("prev").disabled = $("next").disabled = !list.length;
  }

  /* ---- week heatmap (tap or drag to pick a time) ---- */
  const HC = { cw: 10, ch: 14, gap: 1.2, lw: 32, bottom: 14 };
  let heatMatrix = [], heatMax = 1;
  function renderHeat() {
    heatMatrix = Array.from({ length: 7 }, () => new Array(W1 - W0).fill(0));
    for (const r of base) if (r.w) for (let d = 0; d < 7; d++) for (let s = W0; s < W1; s++) if (r.w[d * 48 + s] === "0") heatMatrix[d][s - W0] += r.est || 0;
    heatMax = Math.max(1, ...heatMatrix.flat());
    const { cw, ch, gap, lw, bottom } = HC, cols = W1 - W0, W = lw + cols * (cw + gap) - gap, H = 7 * (ch + gap) - gap + bottom;
    let o = `<svg viewBox="0 0 ${W} ${H}" id="heatsvg" role="img" aria-label="Closed floor space by day and half hour">`;
    for (let d = 0; d < 7; d++) {
      const y = d * (ch + gap);
      o += `<text x="0" y="${y + ch - 3.5}">${DAYS[d]}</text>`;
      for (let s = 0; s < cols; s++) { const v = heatMatrix[d][s]; o += `<rect x="${lw + s * (cw + gap)}" y="${y}" width="${cw}" height="${ch}" rx="2" fill="${v > 0 ? rampColor(v / heatMax) : "var(--well)"}"/>`; }
    }
    [[18, "9 AM"], [24, "12 PM"], [30, "3 PM"], [36, "6 PM"], [42, "9 PM"]].forEach(([s, t]) => { o += `<text x="${lw + (s - W0) * (cw + gap)}" y="${H - 2}">${t}</text>`; });
    o += `<rect class="sel" x="${lw + (state.slot - W0) * (cw + gap) - 1.5}" y="${state.day * (ch + gap) - 1.5}" width="${cw + 3}" height="${ch + 3}" rx="3"/></svg>`;
    $("heat").innerHTML = o;
    $("scalebar").style.background = `linear-gradient(90deg, ${RAMP.join(",")})`;
    $("scalemax").textContent = fmt(heatMax) + " sq ft";
  }
  function heatPick(e) {
    const svg = $("heatsvg"); if (!svg) return;
    const rc = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const x = (e.clientX - rc.left) / rc.width * vb.width, y = (e.clientY - rc.top) / rc.height * vb.height;
    const { cw, ch, gap, lw } = HC;
    const s = Math.floor((x - lw) / (cw + gap)) + W0, d = Math.floor(y / (ch + gap));
    if (s < W0 || s >= W1 || d < 0 || d > 6 || (d === state.day && s === state.slot)) return;
    state.day = d; state.slot = s; update();
  }
  let heatDown = false;
  $("heat").addEventListener("pointerdown", e => { heatDown = true; $("heat").setPointerCapture(e.pointerId); heatPick(e); });
  $("heat").addEventListener("pointermove", e => { if (heatDown) heatPick(e); });
  ["pointerup", "pointercancel"].forEach(t => $("heat").addEventListener(t, () => { heatDown = false; }));

  /* ================= links: #d=4&t=38&s=node/123 ================= */
  function hashFor(withSel) {
    const p = new URLSearchParams({ d: state.day, t: state.slot });
    if (withSel && state.sel) p.set("s", state.sel);
    return p.toString();
  }
  function writeHash() { history.replaceState(null, "", "#" + hashFor(true)); }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const d = +p.get("d"), t = +p.get("t");
    let set = false;
    if (p.has("d") && d >= 0 && d < 7) { state.day = d; set = true; }
    if (p.has("t") && t >= W0 && t < W1) { state.slot = t; set = true; }
    return { set, sel: byId.has(p.get("s")) ? p.get("s") : null };
  }

  /* ================= actions ================= */
  const detail = $("detail");
  function select(id, o = {}) {
    const was = state.sel;
    state.sel = id;
    const i = list.findIndex(r => r.id === id); if (i >= state.listN) state.listN = Math.ceil((i + 1) / PAGE) * PAGE;
    detail.hidden = false; app.classList.add("has-detail");
    renderDetail(); $("dscroll").scrollTop = 0;
    renderList();
    placeRing(ring, id); placeRing(hoverRing, null);
    if (mq.matches) setWeek(false);
    else if (o.fromMap) document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    if (!was) map.invalidateSize({ pan: false });
    focusOnAfterLayout(id);
    writeHash();
  }
  function focusOnAfterLayout(id) { requestAnimationFrame(() => setTimeout(() => focusOn(id), 60)); }
  function deselect() {
    const id = state.sel;
    state.sel = null; placeRing(ring, null);
    detail.hidden = true; app.classList.remove("has-detail");
    renderList();
    document.querySelector(`.card[data-id="${CSS.escape(id || "")}"]`)?.focus({ preventScroll: true });
    writeHash();
  }
  function step(dir) {
    if (!list.length) return;
    let i = list.findIndex(r => r.id === state.sel);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    select(list[i].id, { fromMap: true });
  }
  // Phones: opening the Week view lowers the list to its peek, and closing it puts it back.
  let sheetBeforeWeek = null;
  function setWeek(open) {
    if (state.weekOpen === open) return;
    state.weekOpen = open;
    if (mq.matches && !state.sel) {
      if (open) { sheetBeforeWeek = SH.name; setSheet("peek"); }
      else if (sheetBeforeWeek) { setSheet(sheetBeforeWeek); sheetBeforeWeek = null; }
    }
    renderWhen();
    // Keep the district in view in whatever the bar and sheet leave uncovered.
    if (mq.matches && !interacted) setTimeout(fitHome, 340);
  }
  function clearFilters() { state.hood = "both"; state.cats = new Set(DEFAULT_CATS); state.minSq = 0; state.listN = PAGE; update(); }
  let toastTimer = null;
  function toast(text) {
    const t = $("toast"); t.textContent = text; t.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 1800);
  }
  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done); }
    catch { window.prompt("Copy this:", text); }
  }

  /* ================= wiring ================= */
  DAYS.forEach((d, i) => { const b = document.createElement("button"); b.type = "button"; b.className = "day"; b.textContent = d; b.setAttribute("aria-label", DAYS_LONG[i]); b.onclick = () => { state.day = i; update(); }; $("days").appendChild(b); });
  PRESETS.forEach(([t, d, s]) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = t; b.dataset.d = d; b.dataset.s = s; b.onclick = () => { state.day = d; state.slot = s; update(); }; $("presets").appendChild(b); });
  CATS.forEach(([k, l]) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.dataset.k = k; b.innerHTML = `${ic(k, 15)}${esc(l)} <span class="n">0</span>`;
    b.onclick = () => { state.cats.has(k) ? state.cats.delete(k) : state.cats.add(k); state.listN = PAGE; update(); }; $("cats").appendChild(b); });
  SIZES.forEach(([v, l]) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.dataset.v = v; b.textContent = l; b.onclick = () => { state.minSq = v; state.listN = PAGE; update(); }; $("sizes").appendChild(b); });
  $("time").addEventListener("input", e => { state.slot = +e.target.value; update(); });
  $("nowbtn").onclick = () => { setNow(); update(); };
  $("weekbtn").onclick = () => setWeek(!state.weekOpen);
  $("weekclose").onclick = () => setWeek(false);
  map.on("click", () => { if (state.weekOpen && mq.matches) setWeek(false); });
  $("filterbtn").onclick = () => { state.filtersOpen = !state.filtersOpen; renderFilters(); };
  $("clear").onclick = clearFilters;
  $("hood").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { state.hood = b.dataset.v; state.listN = PAGE; update(); } });
  $("tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if (b) { state.tab = b.dataset.k; state.listN = PAGE; update(); } });
  $("sort").onchange = e => { state.sort = e.target.value; state.listN = PAGE; update(); };
  $("vlist").onclick = () => { state.view = "list"; update(); };
  $("vgrid").onclick = () => { state.view = "grid"; update(); };
  $("more").onclick = () => { state.listN += PAGE; renderList(); };
  $("cards").addEventListener("click", e => {
    if (e.target.closest("[data-act=clear]")) return clearFilters();
    const c = e.target.closest(".card"); if (c) select(c.dataset.id);
  });
  // Hovering a card rings its dot and shows its name on the map.
  let tipOpen = null;
  const showCardTip = id => {
    if (tipOpen && tipOpen !== id) markers.get(tipOpen)?.closeTooltip();
    tipOpen = id;
    const m = id && markers.get(id);
    if (m && canHover && map.hasLayer(m)) m.openTooltip();
  };
  $("cards").addEventListener("pointerover", e => {
    if (mq.matches) return;
    const c = e.target.closest(".card"), id = c && c.dataset.id !== state.sel ? c.dataset.id : null;
    placeRing(hoverRing, id); showCardTip(id);
  });
  $("cards").addEventListener("pointerleave", () => { placeRing(hoverRing, null); showCardTip(null); });
  $("back").onclick = deselect;
  $("prev").onclick = () => step(-1);
  $("next").onclick = () => step(1);
  $("dbody").addEventListener("click", e => {
    const c = e.target.closest(".wcell"); if (c) { state.day = +c.dataset.d; state.slot = +c.dataset.s; update(); return; }
    const b = e.target.closest("[data-copy]"); if (!b) return;
    if (b.dataset.copy === "note") copy($("msg").textContent, "Note copied");
    else copy(shareUrl(), "Link copied");
  });
  document.addEventListener("keydown", e => {
    if (e.target.closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") { if (state.weekOpen) setWeek(false); else if (state.sel) deselect(); return; }
    if (state.sel) { if (e.key === "ArrowRight") { step(1); e.preventDefault(); } else if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); } }
  });

  /* ================= update loop ================= */
  function update() {
    compute();
    renderHead(); renderWhen(); renderTabs(); renderFilters();
    renderList();
    if (state.sel) renderDetail();
    styleMarkers();
    writeHash();
  }

  const fromLink = readHash();
  if (!fromLink.set) setNow();
  update();
  setSheet("half", true);
  fitHome();
  syncStreetLabels();
  if (fromLink.sel) select(fromLink.sel);

  // handle for tests and the console
  window.__space = { state, update, select, deselect, setSheet, setWeek, markers, map, DATA, idleHours, SH,
    get list() { return list; }, get parts() { return parts; }, get base() { return base; } };
}
