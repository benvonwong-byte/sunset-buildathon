// The Sunset Calendar: agenda, month calendar, map and group directory over
// two static files built each morning (data/events.json, data/orgs.json).
// No framework, no build step: open index.html through any static server.
//
// Everything in the data comes from outside websites, so every string that
// reaches innerHTML goes through esc(), and every link through safeUrl().

const TZ = "America/Los_Angeles";
const PAGE = 150;
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/";

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
const wdFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const shortDay = (k) => `${wdFmt.format(keyToUtcNoon(k))} ${Number(k.slice(8))}`;
const monthFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const stampFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

const todayKey = () => dayKeyFmt.format(new Date());
const keyToUtcNoon = (k) => new Date(k + "T12:00:00Z");
function keyPlus(k, n) {
  return new Date(keyToUtcNoon(k).getTime() + n * 86400000).toISOString().slice(0, 10);
}
const weekdayOf = (k) => keyToUtcNoon(k).getUTCDay();
const longDay = (k) => longDayFmt.format(keyToUtcNoon(k));
function timeLabel(iso) {
  return timeFmt.format(new Date(iso)).replace(":00", "").replace(" ", "\u202f");
}
function timeRange(e) {
  if (e.allDay) return "All day";
  const a = timeLabel(e.start);
  if (!e.end) return a;
  const sameDay = dayKeyFmt.format(new Date(e.end)) === e.day;
  return sameDay ? `${a} to ${timeLabel(e.end)}` : a;
}

// ---------- Data ----------
let DATA = { events: [], fetchedAt: null, sources: [] };
let ORGS = [];
let DOMAINS = [];
let HOODS = [];
let OUTLINE = null;
const KINDS = {
  nonprofit: "Nonprofit",
  civic: "Neighborhood group",
  government: "Public agency",
  business: "Local business",
  faith: "Faith community",
  school: "School",
  informal: "Volunteer group",
  venue: "Venue",
  market: "Market",
  media: "Local media",
};
const domainById = new Map();
const orgById = new Map();
const hoodLabel = (id) => HOODS.find((h) => h.id === id)?.label ?? "";
const colorOf = (d) => domainById.get(d)?.color ?? "#232320";

let EVENTS = []; // upcoming, sorted, enriched
const eventById = new Map();
const upcomingByOrg = new Map();

// ---------- State (mirrored in the URL hash) ----------
const state = { view: "agenda", q: "", day: "", cat: "", hood: "", org: "", event: "", month: "", calDay: "" };
let shown = PAGE;
let currentList = [];

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.view = ["agenda", "calendar", "map", "groups"].includes(p.get("view")) ? p.get("view") : "agenda";
  for (const k of ["q", "day", "cat", "hood", "org", "event", "month"]) state[k] = p.get(k) ?? "";
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.view !== "agenda") p.set("view", state.view);
  for (const k of ["q", "day", "cat", "hood", "org", "event", "month"]) if (state[k]) p.set(k, state[k]);
  const h = p.toString();
  history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
}

// ---------- Filtering ----------
const tokens = () =>
  state.q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

function dayMatches(k) {
  const t = todayKey();
  switch (state.day) {
    case "":
      return true;
    case "today":
      return k === t;
    case "tomorrow":
      return k === keyPlus(t, 1);
    case "weekend": {
      const wd = weekdayOf(t);
      const sat = wd === 0 ? keyPlus(t, -1) : keyPlus(t, (6 - wd + 7) % 7);
      return k === sat || k === keyPlus(sat, 1);
    }
    default:
      return k === state.day;
  }
}

function eventPasses(e, { ignoreDay = false } = {}) {
  if (state.cat && e.domain !== state.cat) return false;
  if (state.hood && e.hood !== state.hood) return false;
  if (state.org && e.orgId !== state.org) return false;
  const tk = tokens();
  if (tk.length && !tk.every((t) => e._text.includes(t))) return false;
  if (!ignoreDay && !dayMatches(e.day)) return false;
  return true;
}

function orgPasses(o) {
  if (state.cat && !o.domains.includes(state.cat)) return false;
  if (state.hood && o.hood !== state.hood) return false;
  const tk = tokens();
  if (tk.length && !tk.every((t) => o._text.includes(t))) return false;
  return true;
}

// ---------- Rendering helpers ----------
const looseName = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\bsf\b/g, "san francisco")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, "")
    .trim();

function cardHTML(e, focused = false) {
  const v = looseName(e.venue);
  const o = looseName(e.org);
  const same = v && o && (o.includes(v) || v.includes(o));
  const meta = (same ? [e.org] : [e.venue, e.org]).filter(Boolean).map(esc).join(" · ");
  return `<button class="card${focused ? " focused" : ""}" data-id="${esc(e.id)}" style="--c:${colorOf(e.domain)}">
    <span class="card-time">${esc(timeRange(e))}</span>
    <span>
      <span class="card-title">${esc(e.title)}</span>
      ${meta ? `<span class="card-meta">${meta}</span>` : ""}
      <span class="tags">
        <span class="tag cat" style="--c:${colorOf(e.domain)}">${esc(domainById.get(e.domain)?.label ?? "")}</span>
        ${e.hood && e.hood !== "sunset-wide" ? `<span class="tag">${esc(hoodLabel(e.hood))}</span>` : ""}
        ${e.online ? `<span class="tag">Online</span>` : ""}
        ${e.free ? `<span class="tag">Free</span>` : ""}
      </span>
    </span>
  </button>`;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------- Filters UI ----------
function renderChips() {
  const t = todayKey();
  const days = [
    ["", "All days"],
    ["today", "Today"],
    ["tomorrow", "Tomorrow"],
    ["weekend", "Weekend"],
  ];
  for (let n = 2; n <= 7; n++) {
    const k = keyPlus(t, n);
    days.push([k, shortDay(k)]);
  }
  const dayWrap = $("#day-chips");
  dayWrap.hidden = state.view === "groups" || state.view === "calendar";
  dayWrap.innerHTML = days
    .map(([id, label]) => `<button class="chip" data-day="${id}" aria-pressed="${state.day === id}">${esc(label)}</button>`)
    .join("");

  $("#cat-chips").innerHTML =
    `<button class="chip" data-cat="" aria-pressed="${!state.cat}">All kinds</button>` +
    DOMAINS.map(
      (d) =>
        `<button class="chip cat" data-cat="${d.id}" style="--c:${d.color}" aria-pressed="${state.cat === d.id}" title="${esc(d.blurb)}"><span class="swatch"></span>${esc(d.label)}</button>`
    ).join("");

  const hood = $("#hood");
  hood.innerHTML =
    `<option value="">All of the Sunset</option>` +
    HOODS.map((h) => `<option value="${h.id}"${state.hood === h.id ? " selected" : ""}>${esc(h.label)}</option>`).join("");
  $("#search").value = state.q;

  const notes = [];
  if (state.org && orgById.has(state.org)) notes.push(`Only events from <b>${esc(orgById.get(state.org).name)}</b> <button data-clear="org">show everyone</button>`);
  const d = state.cat && domainById.get(state.cat);
  if (d) notes.push(esc(d.blurb));
  const note = $("#filter-note");
  note.hidden = !notes.length;
  note.innerHTML = notes.join(" ");
}

// ---------- Agenda ----------
function renderAgenda() {
  const root = $("#view-agenda");
  const list = EVENTS.filter((e) => eventPasses(e));
  currentList = list;
  if (!list.length) {
    root.innerHTML = `<p class="empty">${
      EVENTS.length
        ? "Nothing matches those filters. Try all days and all kinds, or a shorter search."
        : "No listings yet. The calendar rebuilds every morning."
    }</p>`;
    return;
  }
  const t = todayKey();
  const slice = list.slice(0, shown);
  let html = "";
  let open = null;
  for (const e of slice) {
    if (e.day !== open) {
      if (open) html += `</div>`;
      open = e.day;
      const count = list.filter((x) => x.day === e.day).length;
      const label = e.day === t ? `<span class="today">Today</span> · ${esc(longDay(e.day))}` : e.day === keyPlus(t, 1) ? `Tomorrow · ${esc(longDay(e.day))}` : esc(longDay(e.day));
      html += `<div class="day"><h2 class="day-head"><span>${label}</span><span>${count}</span></h2>`;
    }
    html += cardHTML(e);
  }
  html += `</div>`;
  if (list.length > shown) html += `<button class="btn ghost more" id="show-more">Show ${Math.min(PAGE, list.length - shown)} more of ${list.length - shown}</button>`;
  root.innerHTML = html;
  $("#show-more")?.addEventListener("click", () => {
    shown += PAGE;
    renderAgenda();
  });
}

// ---------- Calendar ----------
function renderCalendar() {
  const root = $("#view-calendar");
  const t = todayKey();
  const first = t.slice(0, 7);
  const last = EVENTS.length ? EVENTS[EVENTS.length - 1].day.slice(0, 7) : first;
  let month = state.month && state.month >= first && state.month <= last ? state.month : first;
  const [y, m] = month.split("-").map(Number);
  const startKey = `${month}-01`;
  const lead = weekdayOf(startKey);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((lead + dim) / 7) * 7;

  const list = EVENTS.filter((e) => eventPasses(e, { ignoreDay: true }));
  const byDay = new Map();
  for (const e of list) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const prevMonth = keyPlus(startKey, -1).slice(0, 7);
  const nextMonth = keyPlus(`${month}-${String(dim).padStart(2, "0")}`, 1).slice(0, 7);

  let html = `<div class="cal-head">
    <button class="icon-btn" id="cal-prev" aria-label="Previous month" ${month <= first ? "disabled" : ""}>&larr;</button>
    <h2 class="cal-title">${esc(monthFmt.format(keyToUtcNoon(startKey)))}</h2>
    <button class="icon-btn" id="cal-next" aria-label="Next month" ${month >= last ? "disabled" : ""}>&rarr;</button>
  </div><div class="cal-grid">`;
  html += ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-wd">${d}</div>`).join("");
  for (let i = 0; i < cells; i++) {
    const k = keyPlus(startKey, i - lead);
    const inMonth = k.slice(0, 7) === month;
    const evs = byDay.get(k) ?? [];
    const cls = ["cal-cell", inMonth ? "" : "out", k < t ? "past" : "", k === t ? "is-today" : "", k === state.calDay ? "sel" : ""].join(" ");
    html += `<button class="${cls}" data-day="${k}" aria-label="${esc(longDay(k))}, ${evs.length} events">
      <span class="cal-n"><span>${Number(k.slice(8))}</span>${evs.length ? `<span>${evs.length}</span>` : ""}</span>
      ${evs
        .slice(0, 3)
        .map((e) => `<span class="cal-ev" style="--c:${colorOf(e.domain)}"><b>${e.allDay ? "" : esc(timeLabel(e.start))}</b> ${esc(e.title)}</span>`)
        .join("")}
      ${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3} more</span>` : ""}
      <span class="cal-dots">${evs.slice(0, 8).map((e) => `<i style="--c:${colorOf(e.domain)}"></i>`).join("")}</span>
    </button>`;
  }
  html += `</div>`;
  const sel = state.calDay && byDay.get(state.calDay);
  if (state.calDay) {
    html += `<div class="cal-day-list day"><h2 class="day-head"><span>${esc(longDay(state.calDay))}</span><span>${sel ? sel.length : 0}</span></h2>
      ${sel ? sel.map((e) => cardHTML(e)).join("") : `<p class="empty">Nothing listed that day under these filters.</p>`}</div>`;
  }
  root.innerHTML = html;
  currentList = sel ?? list;
  $("#cal-prev")?.addEventListener("click", () => {
    state.month = prevMonth;
    state.calDay = "";
    writeHash();
    renderCalendar();
  });
  $("#cal-next")?.addEventListener("click", () => {
    state.month = nextMonth;
    state.calDay = "";
    writeHash();
    renderCalendar();
  });
}

// ---------- Map ----------
let L = null;
let map = null;
let layers = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = LEAFLET + "leaflet.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = LEAFLET + "leaflet.js";
    s.onload = () => resolve(window.L);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Pins that share a spot fan out on a small spiral so each stays clickable.
function spread(points) {
  const groups = new Map();
  for (const p of points) {
    const k = p.lat.toFixed(4) + "," + p.lng.toFixed(4);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.forEach((p, i) => {
      const r = 0.00018 * Math.sqrt(i + 1);
      const a = i * 2.39996;
      p.lat += r * Math.sin(a);
      p.lng += r * Math.cos(a) * 1.27;
    });
  }
  return points;
}

async function renderMap() {
  try {
    L = await loadLeaflet();
  } catch {
    $("#map-note").textContent = "The map library did not load. Check your connection and try again.";
    return;
  }
  if (!map) {
    map = L.map("map", { scrollWheelZoom: false }).setView([37.7525, -122.4865], 14);
    // OpenStreetMap's own tiles: no key, attribution required, light use only.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    if (OUTLINE) {
      L.polygon(OUTLINE, { color: "#232320", weight: 1.5, dashArray: "4 4", fill: false, interactive: false }).addTo(map);
    }
    layers = { events: L.layerGroup().addTo(map), orgs: L.layerGroup().addTo(map) };
    map.on("popupopen", (ev) => {
      ev.popup.getElement()?.querySelector("button[data-ev]")?.addEventListener("click", (b) => openEvent(b.currentTarget.dataset.ev, currentList));
      ev.popup.getElement()?.querySelector("button[data-org]")?.addEventListener("click", (b) => showOrg(b.currentTarget.dataset.org));
    });
    $("#legend").innerHTML =
      DOMAINS.map((d) => `<span><span class="swatch" style="--c:${d.color}"></span>${esc(d.label)}</span>`).join("") +
      `<span>● event</span><span>■ group</span>`;
  }
  setTimeout(() => map.invalidateSize(), 0);
  layers.events.clearLayers();
  layers.orgs.clearLayers();

  const range = $("#map-range").value;
  const t = todayKey();
  const lastKey = range === "all" ? "9999" : keyPlus(t, Number(range) - 1);
  const evs = EVENTS.filter((e) => eventPasses(e, { ignoreDay: true }) && e.day <= lastKey);
  currentList = evs;
  const mappable = evs.filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
  if ($("#map-events").checked) {
    for (const p of spread(mappable.map((e) => ({ e, lat: e.lat, lng: e.lng })))) {
      const e = p.e;
      L.circleMarker([p.lat, p.lng], { radius: 7, color: "#232320", weight: 1.5, fillColor: colorOf(e.domain), fillOpacity: 0.95 })
        .bindPopup(
          `<span class="pt">${esc(e.title)}</span>${esc(longDay(e.day))}, ${esc(timeRange(e))}<br>${esc(e.venue ?? "")}<br><button class="link" data-ev="${esc(e.id)}">Details</button>`
        )
        .addTo(layers.events);
    }
  }
  const orgs = ORGS.filter((o) => orgPasses(o) && Number.isFinite(o.lat) && Number.isFinite(o.lng) && (!state.org || o.id === state.org));
  if ($("#map-orgs").checked) {
    for (const p of spread(orgs.map((o) => ({ o, lat: o.lat, lng: o.lng })))) {
      const o = p.o;
      const icon = L.divIcon({ className: "", html: `<div class="pin-org" style="--c:${colorOf(o.domains[0])}"></div>`, iconSize: [14, 14] });
      const n = upcomingByOrg.get(o.id)?.length ?? 0;
      L.marker([p.lat, p.lng], { icon })
        .bindPopup(`<span class="pt">${esc(o.name)}</span>${esc(o.what)}<br>${n ? `${n} upcoming events` : ""}<br><button class="link" data-org="${esc(o.id)}">See the group</button>`)
        .addTo(layers.orgs);
    }
  }
  const off = evs.length - mappable.length;
  $("#map-note").textContent =
    `${mappable.length} events and ${orgs.length} groups on the map.` +
    (off ? ` ${off} events have no street address we could place (often online or "location on signup").` : "") +
    " The dashed line is a rough outline of the district.";
}

// ---------- Groups ----------
const groupsUi = { kind: "", live: false, sort: "az" };

function renderGroups() {
  const root = $("#view-groups");
  let list = ORGS.filter(orgPasses);
  if (groupsUi.kind) list = list.filter((o) => o.kind === groupsUi.kind);
  if (groupsUi.live) list = list.filter((o) => (o.feeds ?? []).length);
  if (groupsUi.sort === "events") list = [...list].sort((a, b) => (upcomingByOrg.get(b.id)?.length ?? 0) - (upcomingByOrg.get(a.id)?.length ?? 0) || a.name.localeCompare(b.name));

  const withFeeds = ORGS.filter((o) => (o.feeds ?? []).length).length;
  const month = EVENTS.filter((e) => e.day <= keyPlus(todayKey(), 29)).length;
  const kinds = [...new Set(ORGS.map((o) => o.kind))].filter((k) => KINDS[k]).sort();

  let html = `<div class="agate">
    <div><b>${ORGS.length}</b><span>Groups and places</span></div>
    <div><b>${withFeeds}</b><span>Read every morning</span></div>
    <div><b>${month}</b><span>Events next 30 days</span></div>
    <div><b>${ORGS.length - withFeeds}</b><span>Still need a feed</span></div>
  </div>
  <div class="groups-tools">
    <select class="select" id="g-kind" aria-label="Kind of group"><option value="">Every kind</option>${kinds
      .map((k) => `<option value="${k}"${groupsUi.kind === k ? " selected" : ""}>${esc(KINDS[k])}</option>`)
      .join("")}</select>
    <select class="select" id="g-sort" aria-label="Sort"><option value="az">A to Z</option><option value="events"${groupsUi.sort === "events" ? " selected" : ""}>Most upcoming events</option></select>
    <label><input type="checkbox" id="g-live"${groupsUi.live ? " checked" : ""}> Only groups we can read</label>
    <span class="kbd-hint" style="display:inline">${list.length} shown</span>
  </div>`;
  if (!list.length) html += `<p class="empty">No groups match. Clear the search or pick another neighborhood.</p>`;
  html += `<div class="group-grid">`;
  for (const o of list) {
    const n = upcomingByOrg.get(o.id)?.length ?? 0;
    const site = safeUrl(o.url);
    const evPage = safeUrl(o.eventsPage);
    const ig = safeUrl(o.instagram);
    const live = (o.feeds ?? []).length;
    html += `<article class="group" id="org-${esc(o.id)}" style="--c:${colorOf(o.domains[0])}">
      <h3>${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(o.name)}</a>` : esc(o.name)}</h3>
      <span class="where">${esc(KINDS[o.kind] ?? "")}${o.hood ? " · " + esc(hoodLabel(o.hood)) : ""}${o.address ? " · " + esc(o.address) : ""}</span>
      <p class="what">${esc(o.what)}</p>
      ${o.plugIn ? `<p class="plug">${esc(o.plugIn)}</p>` : ""}
      <div class="tags">${o.domains.map((d) => `<span class="tag cat" style="--c:${colorOf(d)}">${esc(domainById.get(d)?.label ?? d)}</span>`).join("")}</div>
      <span class="feed-status ${live ? "live" : "none"}">${live ? (n ? `Calendar read daily · ${n} upcoming` : "Calendar read daily · nothing upcoming") : n ? `${n} upcoming via other listings` : "No calendar feed yet"}</span>
      <div class="links">
        ${n ? `<button class="manicule" data-org-events="${esc(o.id)}">☞ Their events</button>` : ""}
        ${evPage ? `<a class="manicule" href="${esc(evPage)}" target="_blank" rel="noopener">Events page</a>` : ""}
        ${ig ? `<a class="manicule" href="${esc(ig)}" target="_blank" rel="noopener">Instagram</a>` : ""}
      </div>
    </article>`;
  }
  html += `</div>
  <div class="classified">
    <h2>Help wire in the rest</h2>
    <p class="orn" aria-hidden="true">✳ ✳ ✳</p>
    <p>${ORGS.length - withFeeds} of these groups post events only on a web page, Instagram or a flyer, so they cannot show up here yet. Setting each one up with a free public calendar is the easiest job at the buildathon.</p>
    <a class="manicule" href="https://github.com/benvonwong-byte/sunset-buildathon/blob/main/docs/needs-a-feed.md" target="_blank" rel="noopener">☞ See the list</a>
  </div>`;
  root.innerHTML = html;

  $("#g-kind").addEventListener("change", (e) => {
    groupsUi.kind = e.target.value;
    renderGroups();
  });
  $("#g-sort").addEventListener("change", (e) => {
    groupsUi.sort = e.target.value;
    renderGroups();
  });
  $("#g-live").addEventListener("change", (e) => {
    groupsUi.live = e.target.checked;
    renderGroups();
  });
  root.querySelectorAll("[data-org-events]").forEach((b) =>
    b.addEventListener("click", () => {
      state.org = b.dataset.orgEvents;
      state.q = "";
      state.cat = "";
      state.hood = "";
      state.day = "";
      setView("agenda");
    })
  );
}

function showOrg(id) {
  state.q = "";
  state.cat = "";
  state.hood = "";
  groupsUi.kind = "";
  groupsUi.live = false;
  map?.closePopup();
  setView("groups");
  requestAnimationFrame(() => {
    const el = document.getElementById("org-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  });
}

// ---------- Event dialog ----------
let dialogList = [];
let dialogIndex = -1;

function gcalDate(iso, allDay, plusDay = 0) {
  if (allDay) return keyPlus(dayKeyFmt.format(new Date(iso)), plusDay).replace(/-/g, "");
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function googleLink(e) {
  const end = e.end ?? new Date(new Date(e.start).getTime() + 3600000).toISOString();
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: e.allDay ? `${gcalDate(e.start, true)}/${gcalDate(e.start, true, 1)}` : `${gcalDate(e.start)}/${gcalDate(end)}`,
    details: `${e.url ?? ""}\n\nFrom the Sunset Calendar: ${location.origin}${location.pathname}#event=${e.id}`,
    location: [e.venue, e.address].filter(Boolean).join(", "),
    ctz: TZ,
  });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
function icsFor(e) {
  const fold = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const end = e.end ?? new Date(new Date(e.start).getTime() + 3600000).toISOString();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dear Crisis//Sunset Calendar//EN",
    "BEGIN:VEVENT",
    `UID:${e.id}@sunset.dearcrisis.com`,
    `DTSTAMP:${gcalDate(new Date().toISOString())}`,
    e.allDay ? `DTSTART;VALUE=DATE:${gcalDate(e.start, true)}` : `DTSTART:${gcalDate(e.start)}`,
    e.allDay ? `DTEND;VALUE=DATE:${gcalDate(e.start, true, 1)}` : `DTEND:${gcalDate(end)}`,
    `SUMMARY:${fold(e.title)}`,
    `LOCATION:${fold([e.venue, e.address].filter(Boolean).join(", "))}`,
    e.url ? `URL:${e.url}` : "",
    `DESCRIPTION:${fold((e.url ?? "") + "\n\n" + (e.description ?? ""))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<>"']+/g, (u) => {
    const safe = safeUrl(u.replace(/&amp;/g, "&"));
    return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener">${u.length > 60 ? u.slice(0, 57) + "…" : u}</a>` : u;
  });
}

function renderEvent(e) {
  const d = domainById.get(e.domain);
  $("#ev-kicker").textContent = d?.label ?? "Event";
  $("#ev-kicker").style.color = d?.color ?? "";
  const url = safeUrl(e.url);
  const img = safeUrl(e.image);
  const sameStart = e.venue && e.address && e.address.toLowerCase().startsWith(e.venue.toLowerCase());
  const where = sameStart ? e.address : [e.venue, e.address].filter(Boolean).join(", ");
  const mapsUrl = where && !e.online ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(where + (/san francisco/i.test(where) ? "" : ", San Francisco")) : null;
  const org = e.orgId && orgById.get(e.orgId);
  const also = (e.alsoAt ?? []).map(safeUrl).filter(Boolean);
  $("#ev-body").innerHTML = `
    ${img ? `<img class="dlg-img" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <h2 id="ev-title">${esc(e.title)}</h2>
    <div class="facts">
      <span><b>When:</b> ${esc(longDay(e.day))}, ${esc(timeRange(e))}</span>
      ${where ? `<span><b>Where:</b> ${mapsUrl ? `<a href="${esc(mapsUrl)}" target="_blank" rel="noopener">${esc(where)}</a>` : esc(where)}${e.approxLocation ? " (the group's home base; check the listing)" : ""}${e.hood && e.hood !== "sunset-wide" ? ` · ${esc(hoodLabel(e.hood))}` : ""}</span>` : ""}
      ${e.org ? `<span><b>Who:</b> ${org ? `<button class="manicule" id="ev-org">${esc(e.org)}</button>` : esc(e.org)}</span>` : ""}
    </div>
    ${e.description ? `<p class="desc">${linkify(e.description)}</p>` : ""}
    <div class="actions">
      ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Event page ↗</a>` : ""}
      <a class="btn ghost" href="${esc(googleLink(e))}" target="_blank" rel="noopener">Google Calendar</a>
      <button class="btn ghost" id="ev-ics">.ics file</button>
      <button class="btn ghost" id="ev-share">Copy link</button>
    </div>
    <p class="source-line">Listed by ${esc(e.sourceLabel ?? e.source)}${also.length ? `. Also at ${also.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname.replace(/^www\./, ""))}</a>`).join(", ")}` : ""}.</p>`;
  $("#ev-org")?.addEventListener("click", () => {
    $("#event-dialog").close();
    showOrg(e.orgId);
  });
  $("#ev-ics").addEventListener("click", () => {
    const blob = new Blob([icsFor(e)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = e.title.replace(/[^\w]+/g, "-").slice(0, 50) + ".ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#ev-share").addEventListener("click", async () => {
    const link = `${location.origin}${location.pathname}#event=${e.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied");
    } catch {
      prompt("Copy this link", link);
    }
  });
  $("#ev-prev").disabled = dialogIndex <= 0;
  $("#ev-next").disabled = dialogIndex >= dialogList.length - 1;
}

function openEvent(id, list) {
  const e = eventById.get(id);
  if (!e) return;
  dialogList = list && list.some((x) => x.id === id) ? list : [e];
  dialogIndex = dialogList.findIndex((x) => x.id === id);
  renderEvent(e);
  state.event = id;
  writeHash();
  const dlg = $("#event-dialog");
  if (!dlg.open) dlg.showModal();
  $(".dlg-body", dlg).scrollTop = 0;
}
function stepEvent(n) {
  const i = dialogIndex + n;
  if (i < 0 || i >= dialogList.length) return;
  dialogIndex = i;
  state.event = dialogList[i].id;
  writeHash();
  renderEvent(dialogList[i]);
}

// ---------- Subscribe ----------
function setupSubscribe() {
  const sel = $("#sub-cat");
  sel.innerHTML = `<option value="">Everything</option>` + DOMAINS.map((d) => `<option value="${d.id}">${esc(d.label)} only</option>`).join("");
  const update = () => {
    const file = sel.value ? `sunset-${sel.value}.ics` : "sunset.ics";
    const https = new URL(file, location.href).href;
    const webcal = https.replace(/^https?:/, "webcal:");
    $("#sub-url").value = https;
    $("#sub-webcal").href = webcal;
    $("#sub-google").href = "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal);
  };
  sel.addEventListener("change", update);
  $("#sub-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#sub-url").value);
      toast("Feed address copied");
    } catch {
      $("#sub-url").select();
    }
  });
  $("#open-subscribe").addEventListener("click", () => {
    sel.value = state.cat || "";
    update();
    $("#subscribe-dialog").showModal();
  });
}

// ---------- Views ----------
function setView(v) {
  state.view = v;
  shown = PAGE;
  for (const tab of $$(".tab")) tab.setAttribute("aria-selected", String(tab.dataset.view === v));
  for (const sec of $$(".view")) sec.hidden = sec.id !== "view-" + v;
  writeHash();
  render();
}

function render() {
  renderChips();
  if (state.view === "agenda") renderAgenda();
  else if (state.view === "calendar") renderCalendar();
  else if (state.view === "map") renderMap();
  else renderGroups();
}

function renderDateline() {
  const upcoming = EVENTS.length;
  const stamp = DATA.fetchedAt ? stampFmt.format(new Date(DATA.fetchedAt)) : "not yet";
  $("#dateline").innerHTML = `<span>Updated <b>${esc(stamp)}</b></span><span><b>${upcoming}</b> upcoming events</span><span><b>${ORGS.length}</b> groups and places</span><span>Next ${DATA.horizonDays ?? 60} days</span>`;

  const agg = DATA.sources.filter((s) => s.kind === "aggregator");
  const orgFeeds = DATA.sources.filter((s) => s.kind === "org");
  const okFeeds = orgFeeds.filter((s) => s.ok);
  const orgEvents = okFeeds.reduce((n, s) => n + s.count, 0);
  const items = [
    `<li>Group calendars: ${okFeeds.length} of ${orgFeeds.length} read, ${orgEvents} events</li>`,
    ...agg.map((s) => `<li class="${s.ok ? "" : "bad"}">${esc(s.label)}: ${s.ok ? `${s.count} events` : "did not load this morning"}</li>`),
  ];
  const failing = orgFeeds.filter((s) => !s.ok);
  if (failing.length) items.push(`<li class="bad">${failing.length} group calendars did not load: ${failing.map((s) => esc(s.label.replace(/ \(.*\)$/, ""))).join(", ")}</li>`);
  $("#sources").innerHTML = items.join("");
}

// ---------- Keyboard ----------
function setupKeys() {
  document.addEventListener("keydown", (ev) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
    const dlg = $("#event-dialog");
    if (dlg.open) {
      if (ev.key === "ArrowLeft") stepEvent(-1);
      if (ev.key === "ArrowRight") stepEvent(1);
      return;
    }
    if (document.querySelector("dialog[open]")) return;
    if (typing) {
      if (ev.key === "Escape") document.activeElement.blur();
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "/") {
      ev.preventDefault();
      $("#search").focus();
    } else if (["1", "2", "3", "4"].includes(ev.key)) {
      setView(["agenda", "calendar", "map", "groups"][Number(ev.key) - 1]);
    } else if ((ev.key === "j" || ev.key === "k") && state.view === "agenda") {
      const cards = $$("#view-agenda .card");
      if (!cards.length) return;
      let i = cards.findIndex((c) => c.classList.contains("focused"));
      cards[i]?.classList.remove("focused");
      i = ev.key === "j" ? Math.min(cards.length - 1, i + 1) : Math.max(0, i - 1);
      cards[i].classList.add("focused");
      cards[i].focus({ preventScroll: true });
      cards[i].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
}

// ---------- Boot ----------
async function boot() {
  const [ev, orgs, domains, geo] = await Promise.all(
    ["data/events.json", "data/orgs.json", "data/domains.json", "data/geo.json"].map((u) =>
      fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    )
  );
  DATA = ev ?? DATA;
  DATA.sources ??= [];
  ORGS = (orgs ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  DOMAINS = domains ?? [];
  HOODS = geo?.hoods ?? [];
  OUTLINE = geo?.outline ?? null;
  for (const d of DOMAINS) domainById.set(d.id, d);
  for (const o of ORGS) {
    orgById.set(o.id, o);
    o._text = [o.name, o.what, o.plugIn, o.address, hoodLabel(o.hood), KINDS[o.kind], ...o.domains.map((d) => domainById.get(d)?.label)]
      .join(" ")
      .toLowerCase();
  }
  const now = Date.now();
  EVENTS = (DATA.events ?? [])
    .filter((e) => {
      const end = e.end ? Date.parse(e.end) : Date.parse(e.start) + (e.allDay ? 24 : 2) * 3600000;
      return end > now;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const e of EVENTS) {
    e._text = [e.title, e.venue, e.address, e.org, e.description, hoodLabel(e.hood), domainById.get(e.domain)?.label].join(" ").toLowerCase();
    eventById.set(e.id, e);
    if (e.orgId) {
      if (!upcomingByOrg.has(e.orgId)) upcomingByOrg.set(e.orgId, []);
      upcomingByOrg.get(e.orgId).push(e);
    }
  }

  readHash();
  renderDateline();
  setupSubscribe();
  setupKeys();

  // Filter controls
  $("#day-chips").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-day]");
    if (!b) return;
    state.day = b.dataset.day;
    shown = PAGE;
    writeHash();
    render();
  });
  $("#cat-chips").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-cat]");
    if (!b) return;
    state.cat = state.cat === b.dataset.cat ? "" : b.dataset.cat;
    shown = PAGE;
    writeHash();
    render();
  });
  $("#filter-note").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-clear]");
    if (!b) return;
    state[b.dataset.clear] = "";
    writeHash();
    render();
  });
  $("#hood").addEventListener("change", (ev) => {
    state.hood = ev.target.value;
    shown = PAGE;
    writeHash();
    render();
  });
  let typingTimer;
  $("#search").addEventListener("input", (ev) => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      state.q = ev.target.value.trim();
      shown = PAGE;
      writeHash();
      if (state.view === "agenda") renderAgenda();
      else if (state.view === "calendar") renderCalendar();
      else if (state.view === "map") renderMap();
      else renderGroups();
    }, 160);
  });
  for (const tab of $$(".tab")) tab.addEventListener("click", () => setView(tab.dataset.view));
  $("#map-range").addEventListener("change", renderMap);
  $("#map-events").addEventListener("change", renderMap);
  $("#map-orgs").addEventListener("change", renderMap);

  $("#view-agenda").onclick = (ev) => {
    const card = ev.target.closest(".card[data-id]");
    if (card) openEvent(card.dataset.id, currentList);
  };
  $("#view-calendar").onclick = (ev) => {
    const card = ev.target.closest(".card[data-id]");
    if (card) return openEvent(card.dataset.id, currentList);
    const cell = ev.target.closest(".cal-cell[data-day]");
    if (cell) {
      state.calDay = state.calDay === cell.dataset.day ? "" : cell.dataset.day;
      renderCalendar();
      if (state.calDay) $(".cal-day-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Dialogs
  $("#ev-prev").addEventListener("click", () => stepEvent(-1));
  $("#ev-next").addEventListener("click", () => stepEvent(1));
  $("#ev-close").addEventListener("click", () => $("#event-dialog").close());
  $("#event-dialog").addEventListener("close", () => {
    state.event = "";
    writeHash();
  });
  for (const dlg of $$("dialog")) {
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) dlg.close();
    });
    $$("[data-close]", dlg).forEach((b) => b.addEventListener("click", () => dlg.close()));
  }
  const openAdd = () => $("#add-dialog").showModal();
  $("#open-add").addEventListener("click", openAdd);
  $("#foot-add").addEventListener("click", openAdd);

  // Keep sticky day headers just under the sticky bar.
  const bar = $("#bar");
  const setBarH = () =>
    document.documentElement.style.setProperty("--bar-h", (getComputedStyle(bar).position === "sticky" ? bar.offsetHeight : 0) + "px");
  new ResizeObserver(setBarH).observe(bar);
  window.addEventListener("resize", setBarH);
  setBarH();

  window.addEventListener("hashchange", () => {
    const before = state.event;
    readHash();
    if (state.event && state.event !== before) openEvent(state.event, currentList);
    else render();
  });

  setView(state.view);
  if (state.event) openEvent(state.event, currentList);
}

boot();
