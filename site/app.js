// Sunset: three simple views over two data files rebuilt every morning.
//   Groups  the directory, sorted by kind of organization, nonprofits first
//   Map     one map with a three-way switch: today, next 7 days, groups
//   Events  one threaded list with a strip of dates on top
// Each view has one search box and one row of chips at most. A tap opens a
// line in place; links between views open the same thing in the other view.
//
// Everything in the data comes from outside websites, so every string that
// reaches innerHTML goes through esc(), and every link through safeUrl().

const TZ = "America/Los_Angeles";
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function safeUrl(u) {
  try {
    const url = new URL(u, location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

// ---------- Dates (always Pacific) ----------
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const longDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
const shortDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const wdFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const stampFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
const shortStamp = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });

const todayKey = () => dayKeyFmt.format(new Date());
const noon = (k) => new Date(k + "T12:00:00Z");
const keyPlus = (k, n) => new Date(noon(k).getTime() + n * 86400000).toISOString().slice(0, 10);
const longDay = (k) => longDayFmt.format(noon(k));
const shortDay = (k) => shortDayFmt.format(noon(k));
const timeLabel = (iso) => timeFmt.format(new Date(iso)).replace(":00", "");
function timeRange(e) {
  if (e.allDay) return "All day";
  if (!e.end || dayKeyFmt.format(new Date(e.end)) !== e.day) return timeLabel(e.start);
  return `${timeLabel(e.start)} to ${timeLabel(e.end)}`;
}

// ---------- Data ----------
let DATA = { events: [], sources: [], fetchedAt: null };
let ORGS = [];
let DOMAINS = [];
let HOODS = [];
let OUTLINE = null;
let EVENTS = [];
const domainById = new Map();
const orgById = new Map();
const eventById = new Map();
const upcomingByOrg = new Map();
const colorOf = (d) => domainById.get(d)?.color ?? "#232320";
const hoodLabel = (id) => (id === "sunset-wide" ? "" : HOODS.find((h) => h.id === id)?.label ?? "");

// Directory sections, in the order a neighbor looks for them.
const SECTIONS = [
  { id: "nonprofits", label: "Nonprofits", kinds: ["nonprofit"] },
  { id: "volunteer", label: "Volunteer groups", kinds: ["informal"] },
  { id: "neighborhood", label: "Neighborhood groups", kinds: ["civic"] },
  { id: "faith", label: "Faith communities", kinds: ["faith"] },
  { id: "city", label: "City programs", kinds: ["government"] },
  { id: "schools", label: "Schools", kinds: ["school"] },
  { id: "places", label: "Places and businesses", kinds: ["venue", "business", "market"] },
  { id: "news", label: "Local news", kinds: ["media"] },
];
const sectionOf = (o) => SECTIONS.find((s) => s.kinds.includes(o.kind)) ?? SECTIONS[0];

// ---------- State (mirrored in the URL hash) ----------
const VIEWS = ["groups", "map", "events"];
const state = { view: "groups", gq: "", kind: "", eq: "", cat: "", org: "", event: "", group: "", map: "week" };
const KEYS = ["gq", "kind", "eq", "cat", "org", "event", "group", "map"];
const DEFAULTS = { map: "week" };

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.view = VIEWS.includes(p.get("view")) ? p.get("view") : "groups";
  for (const k of KEYS) state[k] = p.get(k) ?? DEFAULTS[k] ?? "";
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.view !== "groups") p.set("view", state.view);
  for (const k of KEYS) if (state[k] && state[k] !== DEFAULTS[k]) p.set(k, state[k]);
  const h = p.toString();
  history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
}
const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);

// ---------- Masthead ----------
function renderMasthead() {
  const v = state.view;
  $("#headline").textContent = v === "groups" ? "Sunset Groups" : v === "map" ? "Sunset Map" : "Sunset Events";
  $("#deck").textContent =
    v === "groups"
      ? `${ORGS.length} nonprofits, neighborhood groups, congregations and public places in the Inner and Outer Sunset, and how to take part.`
      : v === "map"
        ? "Where things happen this week, and where the groups are."
        : "Public events between Lincoln Way and Sloat, Stanyan and the ocean, gathered every morning.";
}

// ---------- Groups ----------
function groupPasses(o, { ignoreKind = false } = {}) {
  if (!ignoreKind && state.kind && sectionOf(o).id !== state.kind) return false;
  const w = words(state.gq);
  return !w.length || w.every((t) => o._text.includes(t));
}

function renderGroups() {
  const searched = ORGS.filter((o) => groupPasses(o, { ignoreKind: true }));
  const counts = new Map();
  for (const o of searched) counts.set(sectionOf(o).id, (counts.get(sectionOf(o).id) ?? 0) + 1);
  $("#kind-chips").innerHTML =
    `<button class="chip" data-kind="" aria-pressed="${!state.kind}">All <span class="n">${searched.length}</span></button>` +
    SECTIONS.filter((s) => counts.get(s.id))
      .map((s) => `<button class="chip" data-kind="${s.id}" aria-pressed="${state.kind === s.id}">${esc(s.label)} <span class="n">${counts.get(s.id)}</span></button>`)
      .join("");

  const list = searched.filter((o) => groupPasses(o));
  if (!list.length) {
    $("#group-list").innerHTML = `<p class="empty">No groups match. Try a shorter search.</p>`;
    return;
  }
  let html = "";
  for (const s of SECTIONS) {
    const rows = list.filter((o) => sectionOf(o).id === s.id);
    if (!rows.length) continue;
    html += `<section class="g-section"><h2 class="sec-head"><span>${esc(s.label)}</span><span class="n">${rows.length}</span></h2>`;
    for (const o of rows) {
      const n = upcomingByOrg.get(o.id)?.length ?? 0;
      const meta = hoodLabel(o.hood);
      html += `<article class="item${state.group === o.id ? " open" : ""}" id="g-${esc(o.id)}" data-id="${esc(o.id)}">
        <button class="item-row" aria-expanded="${state.group === o.id}">
          <span class="dot" style="--c:${colorOf(o.domains[0])}"></span>
          <span><span class="item-name">${esc(o.name)}</span><span class="item-sub">${esc(o.what)}</span>${meta ? `<span class="item-meta">${esc(meta)}</span>` : ""}</span>
          <span class="badge">${n ? `${n} event${n === 1 ? "" : "s"}` : ""}</span>
        </button>
        <div class="item-more"${state.group === o.id ? "" : " hidden"}>${state.group === o.id ? groupDetail(o) : ""}</div>
      </article>`;
    }
    html += `</section>`;
  }
  const noFeed = ORGS.filter((o) => !(o.feeds ?? []).length).length;
  if (!state.gq && !state.kind) {
    html += `<div class="classified"><h2>Help wire in the rest</h2><p>${noFeed} of these groups post events only on a web page, Instagram or a flyer, so their events cannot appear here yet. Helping one set up a free public calendar is a buildathon job that needs no code.</p><a class="manicule" href="https://github.com/benvonwong-byte/sunset-buildathon/blob/main/docs/needs-a-feed.md" target="_blank" rel="noopener">See the list</a></div>`;
  }
  $("#group-list").innerHTML = html;
}

function groupDetail(o) {
  const n = upcomingByOrg.get(o.id)?.length ?? 0;
  const site = safeUrl(o.url);
  const evPage = safeUrl(o.eventsPage);
  const ig = safeUrl(o.instagram);
  const maps = o.address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.address + (/san francisco/i.test(o.address) ? "" : ", San Francisco")) : null;
  return `
    ${o.plugIn ? `<p class="plug">${esc(o.plugIn)}</p>` : ""}
    ${o.address ? `<p class="item-meta">${maps ? `<a href="${esc(maps)}" target="_blank" rel="noopener">${esc(o.address)}</a>` : esc(o.address)}</p>` : ""}
    <div class="links">
      ${site ? `<a class="manicule" href="${esc(site)}" target="_blank" rel="noopener">Website ↗</a>` : ""}
      ${n ? `<button class="manicule" data-org-events="${esc(o.id)}">${n} upcoming event${n === 1 ? "" : "s"}</button>` : ""}
      ${Number.isFinite(o.lat) ? `<button class="manicule" data-map-group="${esc(o.id)}">On the map</button>` : ""}
      ${evPage && evPage !== site ? `<a class="manicule" href="${esc(evPage)}" target="_blank" rel="noopener">Events page ↗</a>` : ""}
      ${ig ? `<a class="manicule" href="${esc(ig)}" target="_blank" rel="noopener">Instagram ↗</a>` : ""}
    </div>`;
}

function toggleGroup(id, { scroll = false } = {}) {
  const was = state.group;
  state.group = was === id && !scroll ? "" : id;
  writeHash();
  for (const art of $$("#group-list .item")) {
    const on = art.dataset.id === state.group;
    art.classList.toggle("open", on);
    $(".item-row", art).setAttribute("aria-expanded", String(on));
    const more = $(".item-more", art);
    more.hidden = !on;
    more.innerHTML = on ? groupDetail(orgById.get(art.dataset.id)) : "";
  }
  if (scroll && state.group) {
    const el = document.getElementById("g-" + id);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }
}

// ---------- Events ----------
let eventList = [];
function eventPasses(e, { ignoreCat = false } = {}) {
  if (!ignoreCat && state.cat && e.domain !== state.cat) return false;
  if (state.org && e.orgId !== state.org) return false;
  const w = words(state.eq);
  return !w.length || w.every((t) => e._text.includes(t));
}

function renderEvents() {
  const searched = EVENTS.filter((e) => eventPasses(e, { ignoreCat: true }));
  const counts = new Map();
  for (const e of searched) counts.set(e.domain, (counts.get(e.domain) ?? 0) + 1);
  $("#cat-chips").innerHTML =
    `<button class="chip" data-cat="" aria-pressed="${!state.cat}">All <span class="n">${searched.length}</span></button>` +
    DOMAINS.filter((d) => counts.get(d.id))
      .map((d) => `<button class="chip" data-cat="${d.id}" aria-pressed="${state.cat === d.id}" style="--c:${d.color}"><span class="sw"></span>${esc(d.label)} <span class="n">${counts.get(d.id)}</span></button>`)
      .join("");

  const org = state.org && orgById.get(state.org);
  $("#filter-note").hidden = !org;
  $("#filter-note").innerHTML = org ? `Only events from ${esc(org.name)}. <button class="inline-link" data-clear-org>Show everyone's</button>` : "";

  const list = searched.filter((e) => eventPasses(e));
  eventList = list;
  const byDay = new Map();
  for (const e of list) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const t = todayKey();
  $("#date-strip").innerHTML = [...byDay]
    .map(([k, evs]) => `<button class="ds-day${k === t ? " today" : ""}" data-day="${k}"><span class="w">${esc(wdFmt.format(noon(k)))}</span><span class="d">${Number(k.slice(8))}</span><span class="c">${evs.length}</span></button>`)
    .join("");
  if (!list.length) {
    $("#thread").innerHTML = `<p class="empty">${EVENTS.length ? "Nothing matches. Try another kind of event or a shorter search." : "No listings yet. The calendar rebuilds every morning."}</p>`;
    return;
  }
  let html = "";
  for (const [k, evs] of byDay) {
    const label = k === t ? `<span class="today">Today</span> · ${esc(longDay(k))}` : k === keyPlus(t, 1) ? `Tomorrow · ${esc(longDay(k))}` : esc(longDay(k));
    html += `<section class="day" id="d-${k}" data-day="${k}"><h2 class="sec-head"><span>${label}</span><span class="n">${evs.length}</span></h2>${evs.map(eventRow).join("")}</section>`;
  }
  $("#thread").innerHTML = html;
  trackScroll(true);
}

function eventRow(e) {
  const venue = (e.venue ?? "").toLowerCase();
  const host = (e.org ?? "").toLowerCase();
  const same = venue && host && (host.includes(venue) || venue.includes(host));
  const meta = [same ? null : e.venue, hoodLabel(e.hood)].filter(Boolean).join(" · ");
  const open = state.event === e.id;
  return `<article class="item ev${open ? " open" : ""}" id="e-${esc(e.id)}" data-id="${esc(e.id)}">
    <button class="item-row" aria-expanded="${open}">
      <span class="t"><span class="sw" style="--c:${colorOf(e.domain)}"></span>${esc(e.allDay ? "All day" : timeLabel(e.start))}</span>
      <span><span class="item-name">${esc(e.title)}${e.org ? `<span class="host"> · ${esc(e.org)}</span>` : ""}</span>${meta ? `<span class="item-meta">${esc(meta)}</span>` : ""}</span>
    </button>
    <div class="item-more"${open ? "" : " hidden"}>${open ? eventDetail(e) : ""}</div>
  </article>`;
}

function whereText(e) {
  if (e.online) return "Online";
  const same = e.venue && e.address && e.address.toLowerCase().startsWith(e.venue.toLowerCase());
  return same ? e.address : [e.venue, e.address].filter(Boolean).join(", ");
}
function gcalDate(iso, allDay, plus = 0) {
  if (allDay) return keyPlus(dayKeyFmt.format(new Date(iso)), plus).replace(/-/g, "");
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
const endOf = (e) => e.end ?? new Date(Date.parse(e.start) + 3600000).toISOString();
function googleLink(e) {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: e.allDay ? `${gcalDate(e.start, true)}/${gcalDate(e.start, true, 1)}` : `${gcalDate(e.start)}/${gcalDate(endOf(e))}`,
    details: `${e.url ?? ""}\n\nFrom ${location.origin}${location.pathname}#view=events&event=${e.id}`,
    location: whereText(e),
    ctz: TZ,
  });
  return "https://calendar.google.com/calendar/render?" + p;
}
function icsFor(e) {
  const f = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dear Crisis//Sunset//EN", "BEGIN:VEVENT",
    `UID:${e.id}@sunset.dearcrisis.com`, `DTSTAMP:${gcalDate(new Date().toISOString())}`,
    e.allDay ? `DTSTART;VALUE=DATE:${gcalDate(e.start, true)}` : `DTSTART:${gcalDate(e.start)}`,
    e.allDay ? `DTEND;VALUE=DATE:${gcalDate(e.start, true, 1)}` : `DTEND:${gcalDate(endOf(e))}`,
    `SUMMARY:${f(e.title)}`, `LOCATION:${f(whereText(e))}`, e.url ? `URL:${e.url}` : "",
    `DESCRIPTION:${f((e.url ?? "") + "\n\n" + (e.description ?? ""))}`, "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}
function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<>"']+/g, (u) => {
    const safe = safeUrl(u.replace(/&amp;/g, "&"));
    return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener">${u.length > 60 ? u.slice(0, 57) + "…" : u}</a>` : u;
  });
}

function eventDetail(e) {
  const url = safeUrl(e.url);
  const img = safeUrl(e.image);
  const where = whereText(e);
  const org = e.orgId && orgById.get(e.orgId);
  const desc = e.description && e.description.length > 320 ? e.description.slice(0, 317).trimEnd() + "…" : e.description;
  return `
    ${img ? `<img class="ev-img" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <div class="facts">
      <span><b>When</b> ${esc(longDay(e.day))}, ${esc(timeRange(e))}</span>
      ${where ? `<span><b>Where</b> ${esc(where)}${e.approxLocation ? " (the group's home base; check the listing)" : ""}</span>` : ""}
      ${e.org ? `<span><b>Who</b> ${org ? `<button class="inline-link" data-show-group="${esc(org.id)}">${esc(e.org)}</button>` : esc(e.org)}</span>` : ""}
    </div>
    ${desc ? `<p class="desc">${linkify(desc)}</p>` : ""}
    <div class="links">
      ${url ? `<a class="manicule" href="${esc(url)}" target="_blank" rel="noopener">Event page ↗</a>` : ""}
      <a class="manicule" href="${esc(googleLink(e))}" target="_blank" rel="noopener">Add to Google Calendar</a>
      <button class="manicule" data-ics="${esc(e.id)}">.ics</button>
      ${Number.isFinite(e.lat) ? `<button class="manicule" data-map-event="${esc(e.id)}">On the map</button>` : ""}
      <button class="manicule" data-share="${esc(e.id)}">Copy link</button>
    </div>
    <p class="item-meta">Listed by ${esc(e.sourceLabel ?? e.source)}</p>`;
}

function toggleEvent(id, { scroll = false } = {}) {
  state.event = state.event === id && !scroll ? "" : id;
  writeHash();
  for (const art of $$("#thread .ev.open, #e-" + CSS.escape(id))) {
    const on = art.dataset.id === state.event;
    art.classList.toggle("open", on);
    $(".item-row", art).setAttribute("aria-expanded", String(on));
    const more = $(".item-more", art);
    more.hidden = !on;
    more.innerHTML = on ? eventDetail(eventById.get(art.dataset.id)) : "";
  }
  if (scroll && state.event) document.getElementById("e-" + id)?.scrollIntoView({ block: "center" });
}

// The date strip marks the day at the top of the list.
let focusDay = null;
function trackScroll(force = false) {
  if (state.view !== "events") return;
  const line = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 100) + 4;
  let current = null;
  for (const sec of $$("#thread .day")) {
    if (sec.getBoundingClientRect().bottom > line) {
      current = sec.dataset.day;
      break;
    }
  }
  if (!current || (current === focusDay && !force)) return;
  focusDay = current;
  for (const b of $$(".ds-day")) {
    const on = b.dataset.day === current;
    b.classList.toggle("focus", on);
    if (on) {
      const strip = b.parentElement;
      strip.scrollTo({ left: b.offsetLeft - strip.clientWidth / 2 + b.clientWidth / 2, behavior: force ? "auto" : "smooth" });
    }
  }
}

// ---------- Map ----------
let map = null;
let layer = null;
let districtBounds = null;
const markers = new Map();

function initMap() {
  if (map || !window.L) return;
  map = L.map("map", { zoomSnap: 0.5, scrollWheelZoom: false });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
  if (OUTLINE) {
    const poly = L.polygon(OUTLINE, { color: "#232320", weight: 1.5, dashArray: "4 4", fill: false, interactive: false }).addTo(map);
    districtBounds = poly.getBounds();
  }
  layer = L.layerGroup().addTo(map);
  map.on("popupopen", (ev) => {
    const el = ev.popup.getElement();
    el?.querySelector("[data-open-event]")?.addEventListener("click", (b) => openFromMap("events", b.currentTarget.dataset.openEvent));
    el?.querySelector("[data-open-group]")?.addEventListener("click", (b) => openFromMap("groups", b.currentTarget.dataset.openGroup));
  });
  $("#legend").innerHTML =
    DOMAINS.map((d) => `<span><span class="sw" style="--c:${d.color}"></span>${esc(d.label)}</span>`).join("") +
    `<span>● event</span><span>■ group</span>`;
}

function spread(items) {
  const groups = new Map();
  for (const it of items) {
    const k = it.lat.toFixed(4) + "," + it.lng.toFixed(4);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  for (const g of groups.values())
    if (g.length > 1)
      g.forEach((it, i) => {
        const r = 0.00016 * Math.sqrt(i + 1);
        it.lat += r * Math.sin(i * 2.4);
        it.lng += r * Math.cos(i * 2.4) * 1.27;
      });
  return items;
}

let mapFocus = null; // { kind: "event" | "group", id }
function renderMap() {
  initMap();
  if (!map) return;
  for (const b of $$("#map-mode button")) b.setAttribute("aria-pressed", String(b.dataset.mode === state.map));
  layer.clearLayers();
  markers.clear();
  const t = todayKey();
  if (state.map === "groups") {
    const list = ORGS;
    const pins = spread(list.filter((o) => Number.isFinite(o.lat)).map((o) => ({ o, lat: o.lat, lng: o.lng })));
    for (const { o, lat, lng } of pins) {
      const icon = L.divIcon({ className: "", html: `<div class="pin-org" style="--c:${colorOf(o.domains[0])}"></div>`, iconSize: [13, 13] });
      const n = upcomingByOrg.get(o.id)?.length ?? 0;
      const m = L.marker([lat, lng], { icon })
        .bindPopup(`<span class="pt">${esc(o.name)}</span><span class="pm">${esc(sectionOf(o).label)}${n ? ` · ${n} upcoming` : ""}</span><button class="manicule" data-open-group="${esc(o.id)}">See the group</button>`)
        .addTo(layer);
      markers.set(o.id, m);
    }
    $("#map-count").textContent = `${pins.length} of ${list.length} groups have a fixed address`;
  } else {
    const last = state.map === "today" ? t : keyPlus(t, 6);
    const list = EVENTS.filter((e) => e.day <= last || (mapFocus?.kind === "event" && mapFocus.id === e.id));
    const pins = spread(list.filter((e) => Number.isFinite(e.lat)).map((e) => ({ e, lat: e.lat, lng: e.lng })));
    for (const { e, lat, lng } of pins) {
      const m = L.circleMarker([lat, lng], { radius: 7, color: "#232320", weight: 1.5, fillColor: colorOf(e.domain), fillOpacity: 0.95 })
        .bindPopup(`<span class="pt">${esc(e.title)}</span><span class="pm">${esc(state.map === "today" ? "" : shortDay(e.day) + ", ")}${esc(e.allDay ? "All day" : timeLabel(e.start))}${e.venue ? " · " + esc(e.venue) : ""}</span><button class="manicule" data-open-event="${esc(e.id)}">Details</button>`)
        .addTo(layer);
      markers.set(e.id, m);
    }
    $("#map-count").textContent = `${list.length} events, ${pins.length} with an address`;
  }
  setTimeout(() => {
    map.invalidateSize();
    const m = mapFocus && markers.get(mapFocus.id);
    if (m) {
      map.setView(m.getLatLng(), 16);
      m.openPopup();
      if (m.setStyle) m.setStyle({ radius: 11, weight: 3 });
    } else if (districtBounds) map.fitBounds(districtBounds, { padding: [6, 6] });
    mapFocus = null;
  }, 0);
}

function openFromMap(view, id) {
  if (view === "events") {
    Object.assign(state, { eq: "", cat: "", org: "", event: id });
    setView("events");
    toggleEvent(id, { scroll: true });
  } else {
    Object.assign(state, { gq: "", kind: "", group: id });
    setView("groups");
    toggleGroup(id, { scroll: true });
  }
}
function showOnMap(kind, id) {
  mapFocus = { kind, id };
  state.map = kind === "group" ? "groups" : state.map === "groups" ? "week" : state.map;
  setView("map");
  window.scrollTo({ top: 0 });
}

// ---------- Views ----------
function setView(v) {
  state.view = v;
  for (const t of $$(".view-tab")) t.setAttribute("aria-selected", String(t.dataset.view === v));
  for (const name of VIEWS) $("#view-" + name).hidden = name !== v;
  writeHash();
  renderMasthead();
  if (v === "groups") renderGroups();
  else if (v === "events") renderEvents();
  else renderMap();
}

// ---------- Footer ----------
function renderSources() {
  const shown = DATA.sources.filter((s) => s.kind === "aggregator" || s.kind === "feed");
  const groups = DATA.sources.filter((s) => s.kind === "org");
  const items = [
    `<li>Group calendars: ${groups.filter((s) => s.ok).length} of ${groups.length} read</li>`,
    ...shown.map((s) => {
      const name = esc(s.label.replace(/ \((\w|-)+\)$/, ""));
      if (s.ok) return `<li>${name}: ${s.count} events</li>`;
      if (s.count && s.lastGood) return `<li class="bad">${name}: ${s.count} events from the ${esc(shortStamp.format(new Date(s.lastGood)))} read</li>`;
      return `<li class="bad">${name}: did not load this morning</li>`;
    }),
  ];
  if (DATA.fetchedAt) items.push(`<li>Updated ${esc(stampFmt.format(new Date(DATA.fetchedAt)))}</li>`);
  $("#sources").innerHTML = items.join("");
}

// ---------- Subscribe, add, copy ----------
function setupDialogs() {
  const sel = $("#sub-cat");
  sel.innerHTML = `<option value="">Everything</option>` + DOMAINS.map((d) => `<option value="${d.id}">${esc(d.label)} only</option>`).join("");
  const update = () => {
    const https = new URL(sel.value ? `sunset-${sel.value}.ics` : "sunset.ics", location.href).href;
    const webcal = https.replace(/^https?:/, "webcal:");
    $("#sub-url").value = https;
    $("#sub-webcal").href = webcal;
    $("#sub-google").href = "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal);
  };
  sel.addEventListener("change", update);
  $("#sub-copy").addEventListener("click", () => copy($("#sub-url").value, "Feed address copied"));
  $("#open-subscribe").addEventListener("click", () => {
    sel.value = state.cat || "";
    update();
    $("#subscribe-dialog").showModal();
  });
  for (const dlg of $$("dialog")) {
    dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
    $$("[data-close]", dlg).forEach((b) => b.addEventListener("click", () => dlg.close()));
  }
  const openAdd = () => $("#add-dialog").showModal();
  $("#open-add").addEventListener("click", openAdd);
  $("#foot-add").addEventListener("click", openAdd);
}
async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    prompt("Copy this", text);
  }
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------- Wiring ----------
function debounce(fn, ms = 160) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function wire() {
  for (const t of $$(".view-tab")) t.addEventListener("click", () => {
    setView(t.dataset.view);
    window.scrollTo({ top: 0 });
  });

  // Groups
  $("#g-search").addEventListener("input", debounce((e) => {
    state.gq = e.target.value.trim();
    writeHash();
    renderGroups();
  }));
  $("#kind-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b) return;
    state.kind = b.dataset.kind;
    writeHash();
    renderGroups();
  });
  $("#group-list").addEventListener("click", (e) => {
    const row = e.target.closest(".item-row");
    if (row) return toggleGroup(row.closest(".item").dataset.id);
    const ev = e.target.closest("[data-org-events]");
    if (ev) {
      Object.assign(state, { org: ev.dataset.orgEvents, eq: "", cat: "", event: "" });
      setView("events");
      return window.scrollTo({ top: 0 });
    }
    const m = e.target.closest("[data-map-group]");
    if (m) showOnMap("group", m.dataset.mapGroup);
  });

  // Map
  $("#map-mode").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    state.map = b.dataset.mode;
    writeHash();
    renderMap();
  });

  // Events
  $("#e-search").addEventListener("input", debounce((e) => {
    state.eq = e.target.value.trim();
    writeHash();
    renderEvents();
  }));
  $("#cat-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    state.cat = b.dataset.cat;
    writeHash();
    renderEvents();
  });
  $("#filter-note").addEventListener("click", (e) => {
    if (!e.target.closest("[data-clear-org]")) return;
    state.org = "";
    writeHash();
    renderEvents();
  });
  $("#date-strip").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (b) document.getElementById("d-" + b.dataset.day)?.scrollIntoView({ block: "start" });
  });
  $("#thread").addEventListener("click", (e) => {
    const row = e.target.closest(".item-row");
    if (row) return toggleEvent(row.closest(".item").dataset.id);
    const ics = e.target.closest("[data-ics]");
    if (ics) {
      const ev = eventById.get(ics.dataset.ics);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([icsFor(ev)], { type: "text/calendar" }));
      a.download = ev.title.replace(/[^\w]+/g, "-").slice(0, 50) + ".ics";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    const share = e.target.closest("[data-share]");
    if (share) return copy(`${location.origin}${location.pathname}#view=events&event=${share.dataset.share}`, "Link copied");
    const m = e.target.closest("[data-map-event]");
    if (m) return showOnMap("event", m.dataset.mapEvent);
    const g = e.target.closest("[data-show-group]");
    if (g) openFromMap("groups", g.dataset.showGroup);
  });

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      trackScroll();
    });
  }, { passive: true });

  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]") || e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
    if (typing) {
      if (e.key === "Escape") document.activeElement.blur();
      return;
    }
    if (e.key === "/") {
      const box = state.view === "groups" ? $("#g-search") : state.view === "events" ? $("#e-search") : null;
      if (box) {
        e.preventDefault();
        box.focus();
      }
    }
  });

  window.addEventListener("hashchange", () => {
    const before = JSON.stringify(state);
    readHash();
    if (JSON.stringify(state) !== before) boot2();
  });
}

function boot2() {
  $("#g-search").value = state.gq;
  $("#e-search").value = state.eq;
  setView(state.view);
  if (state.view === "events" && state.event) toggleEvent(state.event, { scroll: true });
  if (state.view === "groups" && state.group) toggleGroup(state.group, { scroll: true });
}

// ---------- Boot ----------
async function boot() {
  const [ev, orgs, domains, geo] = await Promise.all(
    ["data/events.json", "data/orgs.json", "data/domains.json", "data/geo.json"].map((u) =>
      fetch(u, { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );
  DATA = ev ?? DATA;
  DATA.sources ??= [];
  ORGS = (orgs ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  DOMAINS = domains ?? [];
  HOODS = geo?.hoods ?? [];
  OUTLINE = geo?.outline ?? null;
  for (const d of DOMAINS) domainById.set(d.id, d);
  const now = Date.now();
  EVENTS = (DATA.events ?? [])
    .filter((e) => (e.end ? Date.parse(e.end) : Date.parse(e.start) + (e.allDay ? 24 : 2) * 3600000) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const e of EVENTS) {
    e._text = [e.title, e.venue, e.address, e.org, e.description, hoodLabel(e.hood), domainById.get(e.domain)?.label].join(" ").toLowerCase();
    eventById.set(e.id, e);
    if (e.orgId) {
      if (!upcomingByOrg.has(e.orgId)) upcomingByOrg.set(e.orgId, []);
      upcomingByOrg.get(e.orgId).push(e);
    }
  }
  for (const o of ORGS) {
    orgById.set(o.id, o);
    o._text = [o.name, o.what, o.plugIn, o.address, hoodLabel(o.hood), sectionOf(o).label, ...o.domains.map((d) => domainById.get(d)?.label)]
      .join(" ")
      .toLowerCase();
  }
  readHash();
  // Links shared before the redesign used #event=... with no view.
  if (state.event && !new URLSearchParams(location.hash.slice(1)).get("view")) state.view = "events";
  wire();
  setupDialogs();
  renderSources();
  boot2();
}

boot();
