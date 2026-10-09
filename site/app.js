// Sunset Events: one page with a threaded list of events on the left and a
// month calendar and map on the right that follow the day you are reading.
// A second view, Groups, puts the directory beside the same map.
//
// Data: data/events.json and data/orgs.json, rebuilt every morning.
// Everything in them comes from outside websites, so every string that
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
const monthFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const stampFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

const todayKey = () => dayKeyFmt.format(new Date());
const noon = (k) => new Date(k + "T12:00:00Z");
const keyPlus = (k, n) => new Date(noon(k).getTime() + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (k) => noon(k).getUTCDay();
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
const domainById = new Map();
const orgById = new Map();
const eventById = new Map();
const upcomingByOrg = new Map();
let EVENTS = [];
const colorOf = (d) => domainById.get(d)?.color ?? "#232320";
const hoodLabel = (id) => HOODS.find((h) => h.id === id)?.label ?? "";
const KINDS = {
  nonprofit: "Nonprofit", civic: "Neighborhood group", government: "Public agency", business: "Local business",
  faith: "Faith community", school: "School", informal: "Volunteer group", venue: "Venue", market: "Market", media: "Local media",
};

// ---------- State (mirrored in the URL hash) ----------
const state = { view: "events", q: "", day: "", cat: "", hood: "", org: "", event: "" };
const ui = { focus: null, month: null, mapRange: "day", kind: "", live: false, sort: "az", kIndex: -1 };
const HASH_KEYS = ["q", "day", "cat", "hood", "org", "event"];

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.view = p.get("view") === "groups" ? "groups" : "events";
  for (const k of HASH_KEYS) state[k] = p.get(k) ?? "";
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.view !== "events") p.set("view", state.view);
  for (const k of HASH_KEYS) if (state[k]) p.set(k, state[k]);
  const h = p.toString();
  history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
}

// ---------- Filters ----------
const tokens = () => state.q.toLowerCase().split(/\s+/).filter(Boolean);
function dayMatches(k) {
  const t = todayKey();
  if (!state.day) return true;
  if (state.day === "today") return k === t;
  if (state.day === "tomorrow") return k === keyPlus(t, 1);
  if (state.day === "weekend") {
    const wd = weekdayOf(t);
    const sat = wd === 0 ? keyPlus(t, -1) : keyPlus(t, (6 - wd + 7) % 7);
    return k === sat || k === keyPlus(sat, 1);
  }
  if (state.day === "week") return k <= keyPlus(t, 6);
  return k === state.day;
}
function eventPasses(e, { ignoreDay = false } = {}) {
  if (state.cat && e.domain !== state.cat) return false;
  if (state.hood && e.hood !== state.hood) return false;
  if (state.org && e.orgId !== state.org) return false;
  const tk = tokens();
  if (tk.length && !tk.every((t) => e._text.includes(t))) return false;
  return ignoreDay || dayMatches(e.day);
}
function orgPasses(o) {
  if (state.cat && !o.domains.includes(state.cat)) return false;
  if (state.hood && o.hood !== state.hood) return false;
  if (ui.kind && o.kind !== ui.kind) return false;
  if (ui.live && !(o.feeds ?? []).length) return false;
  const tk = tokens();
  return !tk.length || tk.every((t) => o._text.includes(t));
}

// ---------- Controls ----------
const DAY_CHIPS = [["", "All days"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["weekend", "This weekend"], ["week", "Next 7 days"]];
function renderControls() {
  $("#cat").innerHTML =
    `<option value="">All kinds</option>` +
    DOMAINS.map((d) => `<option value="${d.id}"${state.cat === d.id ? " selected" : ""}>${esc(d.label)}</option>`).join("");
  $("#hood").innerHTML =
    `<option value="">All of the Sunset</option>` +
    HOODS.filter((h) => h.id !== "sunset-wide")
      .map((h) => `<option value="${h.id}"${state.hood === h.id ? " selected" : ""}>${esc(h.label)}</option>`)
      .join("");
  $("#search").value = state.q;
  $("#search").placeholder = state.view === "events" ? "Search events" : "Search groups";

  const custom = state.day && !DAY_CHIPS.some(([id]) => id === state.day);
  const wrap = $("#day-chips");
  wrap.hidden = state.view !== "events";
  wrap.innerHTML = `<div class="day-chips-in">${DAY_CHIPS.map(
    ([id, label]) => `<button class="day-chip" data-day="${id}" aria-pressed="${state.day === id}">${label}</button>`
  ).join("")}${custom ? `<button class="day-chip" data-day="${esc(state.day)}" aria-pressed="true">${esc(shortDay(state.day))}</button>` : ""}</div>`;

  const notes = [];
  const org = state.org && orgById.get(state.org);
  if (org && state.view === "events") notes.push(`Only events from ${esc(org.name)}. <button class="inline-link" data-clear="org">Show everyone's</button>`);
  const d = state.cat && domainById.get(state.cat);
  if (d) notes.push(esc(d.blurb));
  $("#filter-note").hidden = !notes.length;
  $("#filter-note").innerHTML = notes.join(" ");

  $("#headline").textContent = state.view === "events" ? "Sunset Events" : "Sunset Groups";
  $("#deck").innerHTML =
    state.view === "events"
      ? `Public events between Lincoln Way and Sloat, Stanyan and the ocean, gathered every morning from <button class="inline-link" data-goto="groups">the groups on our map</button>, the library, Luma, Eventbrite and Meetup.`
      : `${ORGS.length} neighborhood groups, venues and institutions in the Sunset: what each one does, where it is, and how to show up. Their events are on <button class="inline-link" data-goto="events">the calendar</button>.`;
}

// ---------- Thread ----------
let currentList = [];
function rowHTML(e) {
  const v = (e.venue ?? "").toLowerCase().replace(/\bsf\b/g, "san francisco");
  const o = (e.org ?? "").toLowerCase().replace(/\bsf\b/g, "san francisco");
  const sameish = v && o && (o.includes(v) || v.includes(o));
  const where = [sameish ? null : e.venue, e.hood && e.hood !== "sunset-wide" ? hoodLabel(e.hood) : null]
    .filter(Boolean)
    .map(esc)
    .join(" · ");
  return `<article class="ev" id="e-${esc(e.id)}" data-id="${esc(e.id)}" data-day="${e.day}">
    <button class="ev-row" aria-expanded="false">
      <span class="dot" style="--c:${colorOf(e.domain)}" title="${esc(domainById.get(e.domain)?.label ?? "")}"></span>
      <span class="t">${esc(e.allDay ? "All day" : timeLabel(e.start))}</span>
      <span><span class="ev-title">${esc(e.title)}</span>${e.org ? `<span class="ev-org"> · ${esc(e.org)}</span>` : ""}${where ? `<span class="ev-where">${where}</span>` : ""}</span>
    </button>
    <div class="ev-more" hidden></div>
  </article>`;
}

function renderThread() {
  const list = EVENTS.filter((e) => eventPasses(e));
  currentList = list;
  $("#count").textContent = `${list.length} ${list.length === 1 ? "event" : "events"}`;
  const root = $("#thread");
  if (!list.length) {
    root.innerHTML = `<p class="empty">${EVENTS.length ? "Nothing under those filters. Try all days and all kinds, or a shorter search." : "No listings yet. The calendar rebuilds every morning."}</p>`;
    renderStrip([]);
    setFocus(null, true);
    return;
  }
  const t = todayKey();
  const byDay = new Map();
  for (const e of list) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  let html = "";
  for (const [k, evs] of byDay) {
    const label = k === t ? `<span class="today">Today</span> · ${esc(longDay(k))}` : k === keyPlus(t, 1) ? `Tomorrow · ${esc(longDay(k))}` : esc(longDay(k));
    html += `<section class="day" data-day="${k}" id="d-${k}"><h2 class="day-head"><span>${label}</span><span class="n">${evs.length}</span></h2>${evs.map(rowHTML).join("")}</section>`;
  }
  root.innerHTML = html;
  renderStrip([...byDay.keys()].map((k) => [k, byDay.get(k).length]));
  ui.kIndex = -1;
  setFocus(list[0].day, true);
}

function renderStrip(days) {
  const t = todayKey();
  $("#date-strip").innerHTML = days
    .map(([k, n]) => `<button class="ds-day${k === t ? " today" : ""}" data-day="${k}"><span class="w">${esc(wdFmt.format(noon(k)))}</span><span class="d">${Number(k.slice(8))}</span><span class="c">${n}</span></button>`)
    .join("");
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<>"']+/g, (u) => {
    const safe = safeUrl(u.replace(/&amp;/g, "&"));
    return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener">${u.length > 60 ? u.slice(0, 57) + "…" : u}</a>` : u;
  });
}
function gcalDate(iso, allDay, plus = 0) {
  if (allDay) return keyPlus(dayKeyFmt.format(new Date(iso)), plus).replace(/-/g, "");
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
const endOf = (e) => e.end ?? new Date(Date.parse(e.start) + 3600000).toISOString();
function whereText(e) {
  if (e.online) return "Online";
  const same = e.venue && e.address && e.address.toLowerCase().startsWith(e.venue.toLowerCase());
  return same ? e.address : [e.venue, e.address].filter(Boolean).join(", ");
}
function googleLink(e) {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: e.allDay ? `${gcalDate(e.start, true)}/${gcalDate(e.start, true, 1)}` : `${gcalDate(e.start)}/${gcalDate(endOf(e))}`,
    details: `${e.url ?? ""}\n\nFrom Sunset Events: ${location.origin}${location.pathname}#event=${e.id}`,
    location: whereText(e),
    ctz: TZ,
  });
  return "https://calendar.google.com/calendar/render?" + p;
}
function icsFor(e) {
  const f = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dear Crisis//Sunset Events//EN", "BEGIN:VEVENT",
    `UID:${e.id}@sunset.dearcrisis.com`, `DTSTAMP:${gcalDate(new Date().toISOString())}`,
    e.allDay ? `DTSTART;VALUE=DATE:${gcalDate(e.start, true)}` : `DTSTART:${gcalDate(e.start)}`,
    e.allDay ? `DTEND;VALUE=DATE:${gcalDate(e.start, true, 1)}` : `DTEND:${gcalDate(endOf(e))}`,
    `SUMMARY:${f(e.title)}`, `LOCATION:${f(whereText(e))}`, e.url ? `URL:${e.url}` : "",
    `DESCRIPTION:${f((e.url ?? "") + "\n\n" + (e.description ?? ""))}`, "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

function detailHTML(e) {
  const url = safeUrl(e.url);
  const img = safeUrl(e.image);
  const where = whereText(e);
  const maps = where && !e.online ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(where + (/san francisco/i.test(where) ? "" : ", San Francisco")) : null;
  const org = e.orgId && orgById.get(e.orgId);
  const also = (e.alsoAt ?? []).map(safeUrl).filter(Boolean);
  const d = domainById.get(e.domain);
  return `
    ${img ? `<img class="ev-img" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <div class="ev-facts">
      <span><b>When</b> ${esc(longDay(e.day))}, ${esc(timeRange(e))}</span>
      ${where ? `<span><b>Where</b> ${maps ? `<a href="${esc(maps)}" target="_blank" rel="noopener">${esc(where)}</a>` : esc(where)}${e.approxLocation ? " (the group's home base; check the listing)" : ""}</span>` : ""}
      ${e.org ? `<span><b>Who</b> ${org ? `<button class="inline-link" data-show-org="${esc(org.id)}">${esc(e.org)}</button>` : esc(e.org)}</span>` : ""}
      ${d ? `<span><span class="tag" style="--c:${d.color}">${esc(d.label)}</span></span>` : ""}
    </div>
    ${e.description ? `<p class="desc">${linkify(e.description)}</p>` : ""}
    <div class="actions">
      ${url ? `<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">Event page ↗</a>` : ""}
      <a class="btn small ghost" href="${esc(googleLink(e))}" target="_blank" rel="noopener">Google Calendar</a>
      <button class="btn small ghost" data-ics="${esc(e.id)}">.ics</button>
      <button class="btn small ghost" data-share="${esc(e.id)}">Copy link</button>
    </div>
    <p class="source-line">Listed by ${esc(e.sourceLabel ?? e.source)}${also.length ? `. Also at ${also.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname.replace(/^www\./, ""))}</a>`).join(", ")}` : ""}.</p>`;
}

function openEvent(id, { scroll = false, fromMap = false } = {}) {
  const art = document.getElementById("e-" + id);
  const e = eventById.get(id);
  if (!art || !e) return;
  for (const other of $$(".ev.open")) if (other !== art) closeEvent(other);
  art.classList.add("open");
  $(".ev-row", art).setAttribute("aria-expanded", "true");
  const more = $(".ev-more", art);
  more.innerHTML = detailHTML(e);
  more.hidden = false;
  state.event = id;
  writeHash();
  if (scroll) art.scrollIntoView({ behavior: fromMap ? "smooth" : "auto", block: "center" });
  setFocus(e.day);
  pinFor(id, { pan: !fromMap, popup: true });
}
function closeEvent(art) {
  art.classList.remove("open");
  $(".ev-row", art).setAttribute("aria-expanded", "false");
  const more = $(".ev-more", art);
  more.hidden = true;
  more.innerHTML = "";
  if (state.event === art.dataset.id) {
    state.event = "";
    writeHash();
  }
  map?.closePopup();
}

// ---------- Focus day: calendar, strip and map follow it ----------
function setFocus(k, force = false) {
  if (!force && k === ui.focus) return;
  ui.focus = k;
  if (k) ui.month = k.slice(0, 7);
  renderMinical();
  for (const b of $$(".ds-day")) {
    const on = b.dataset.day === k;
    b.classList.toggle("focus", on);
    if (on && b.parentElement.offsetParent) {
      const strip = b.parentElement;
      strip.scrollTo({ left: b.offsetLeft - strip.clientWidth / 2 + b.clientWidth / 2, behavior: "smooth" });
    }
  }
  renderEventPins();
}

function trackScroll() {
  if (state.view !== "events") return;
  const line = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 100) + 4;
  let current = null;
  for (const sec of $$("#thread .day")) {
    const r = sec.getBoundingClientRect();
    if (r.bottom > line) {
      current = sec.dataset.day;
      break;
    }
  }
  if (current) setFocus(current);
}

function jumpTo(k) {
  let sec = document.getElementById("d-" + k);
  if (!sec && state.day) {
    state.day = "";
    writeHash();
    renderControls();
    renderThread();
    sec = document.getElementById("d-" + k);
  }
  if (!sec) return;
  sec.scrollIntoView({ block: "start" });
  setFocus(k);
}

// ---------- Mini calendar ----------
function renderMinical() {
  const root = $("#minical");
  if (state.view !== "events") {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  const t = todayKey();
  const first = t.slice(0, 7);
  const last = EVENTS.length ? EVENTS[EVENTS.length - 1].day.slice(0, 7) : first;
  const month = ui.month && ui.month >= first && ui.month <= last ? ui.month : first;
  const start = `${month}-01`;
  const lead = weekdayOf(start);
  const [y, m] = month.split("-").map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = new Map();
  for (const e of EVENTS) {
    if (e.day.slice(0, 7) !== month || !eventPasses(e, { ignoreDay: true })) continue;
    if (!byDay.has(e.day)) byDay.set(e.day, new Map());
    const c = byDay.get(e.day);
    c.set(e.domain, (c.get(e.domain) ?? 0) + 1);
  }
  let cells = "";
  for (let i = 0; i < lead; i++) cells += `<span class="mc-day out"></span>`;
  for (let d = 1; d <= dim; d++) {
    const k = `${month}-${String(d).padStart(2, "0")}`;
    const c = byDay.get(k);
    const n = c ? [...c.values()].reduce((a, b) => a + b, 0) : 0;
    const dots = c ? [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([dom]) => `<i style="--c:${colorOf(dom)}"></i>`).join("") : "";
    const cls = ["mc-day", n ? "" : "none", k === t ? "today" : "", k === ui.focus ? "focus" : ""].filter(Boolean).join(" ");
    cells += `<button class="${cls}" data-day="${k}" ${n ? "" : "disabled"} aria-label="${esc(longDay(k))}: ${n} events"><span class="mc-n">${d}</span><span class="mc-dots">${dots}</span></button>`;
  }
  root.innerHTML = `
    <div class="mc-head">
      <button class="mc-nav" data-month="${keyPlus(start, -1).slice(0, 7)}" ${month <= first ? "disabled" : ""} aria-label="Previous month">←</button>
      <h2 class="mc-title">${esc(monthFmt.format(noon(start)))}</h2>
      <button class="mc-nav" data-month="${keyPlus(`${month}-${String(dim).padStart(2, "0")}`, 1).slice(0, 7)}" ${month >= last ? "disabled" : ""} aria-label="Next month">→</button>
    </div>
    <div class="mc-grid">${["S", "M", "T", "W", "T", "F", "S"].map((w) => `<span class="mc-wd">${w}</span>`).join("")}${cells}</div>
    <div class="mc-legend">${DOMAINS.map((d) => `<button data-cat="${d.id}" style="--c:${d.color}" aria-pressed="${state.cat === d.id}"><span class="sw"></span>${esc(d.label)}</button>`).join("")}</div>`;
}

// ---------- Map ----------
let map = null;
let layer = null;
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
    map.fitBounds(poly.getBounds(), { padding: [6, 6] });
  } else map.setView([37.7525, -122.4865], 13.5);
  layer = L.layerGroup().addTo(map);
  map.on("popupopen", (ev) => {
    const el = ev.popup.getElement();
    el?.querySelector("[data-open-ev]")?.addEventListener("click", (b) => {
      closeMapSheet();
      openEvent(b.currentTarget.dataset.openEv, { scroll: true, fromMap: true });
    });
    el?.querySelector("[data-open-org]")?.addEventListener("click", (b) => {
      closeMapSheet();
      showOrg(b.currentTarget.dataset.openOrg);
    });
  });
}

// Pins that share a spot fan out on a small spiral so each stays clickable.
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

function renderEventPins() {
  if (!map || state.view !== "events") return;
  layer.clearLayers();
  markers.clear();
  const k = ui.focus;
  const from = k ?? todayKey();
  const inRange = (e) => (ui.mapRange === "day" ? e.day === k : ui.mapRange === "week" ? e.day >= from && e.day <= keyPlus(from, 6) : true);
  const list = currentList.filter(inRange);
  const pins = spread(list.filter((e) => Number.isFinite(e.lat)).map((e) => ({ e, lat: e.lat, lng: e.lng })));
  for (const { e, lat, lng } of pins) {
    const m = L.circleMarker([lat, lng], { radius: 7, color: "#232320", weight: 1.5, fillColor: colorOf(e.domain), fillOpacity: 0.95 })
      .bindPopup(
        `<span class="pt">${esc(e.title)}</span><span class="pm">${esc(ui.mapRange === "day" ? "" : shortDay(e.day) + ", ")}${esc(e.allDay ? "All day" : timeLabel(e.start))}${e.venue ? " · " + esc(e.venue) : ""}</span><br><button class="manicule" data-open-ev="${esc(e.id)}">Details</button>`
      )
      .addTo(layer);
    m.on("mouseover", () => hot(e.id, true));
    m.on("mouseout", () => hot(e.id, false));
    markers.set(e.id, m);
  }
  const scope = ui.mapRange === "day" ? (k ? shortDay(k) : "") : ui.mapRange === "week" ? `7 days from ${shortDay(from)}` : "Everything listed";
  const off = list.length - pins.length;
  $("#map-caption").innerHTML = `<span><b>${esc(scope)}</b>: ${pins.length} on the map${off ? `, ${off} without an address` : ""}</span>
    <select class="select map-range" id="map-range" aria-label="What the map shows">
      <option value="day"${ui.mapRange === "day" ? " selected" : ""}>The day you are reading</option>
      <option value="week"${ui.mapRange === "week" ? " selected" : ""}>That day and the next six</option>
      <option value="all"${ui.mapRange === "all" ? " selected" : ""}>Everything listed</option>
    </select>`;
  if (state.event && markers.has(state.event)) pinFor(state.event, { pan: false, popup: false });
}

function hot(id, on) {
  document.getElementById("e-" + id)?.classList.toggle("hot", on);
  const m = markers.get(id);
  if (!m || !m.setStyle) return;
  if (on || state.event !== id) m.setStyle(on ? { radius: 11, weight: 3 } : { radius: 7, weight: 1.5 });
  if (on) m.bringToFront();
}
function pinFor(id, { pan, popup }) {
  const m = markers.get(id);
  if (!m) return;
  m.setStyle({ radius: 11, weight: 3 });
  m.bringToFront();
  if (pan && !map.getBounds().pad(-0.1).contains(m.getLatLng())) map.panTo(m.getLatLng());
  if (popup) m.openPopup();
}

function renderOrgPins(list) {
  if (!map) return;
  layer.clearLayers();
  markers.clear();
  const pins = spread(list.filter((o) => Number.isFinite(o.lat)).map((o) => ({ o, lat: o.lat, lng: o.lng })));
  for (const { o, lat, lng } of pins) {
    const icon = L.divIcon({ className: "", html: `<div class="pin-org" style="--c:${colorOf(o.domains[0])}"></div>`, iconSize: [13, 13] });
    const n = upcomingByOrg.get(o.id)?.length ?? 0;
    const m = L.marker([lat, lng], { icon })
      .bindPopup(`<span class="pt">${esc(o.name)}</span><span class="pm">${esc(KINDS[o.kind] ?? "")}${n ? ` · ${n} upcoming` : ""}</span><br><button class="manicule" data-open-org="${esc(o.id)}">See the group</button>`)
      .addTo(layer);
    m.on("mouseover", () => document.getElementById("g-" + o.id)?.classList.add("hot"));
    m.on("mouseout", () => document.getElementById("g-" + o.id)?.classList.remove("hot"));
    markers.set(o.id, m);
  }
  const off = list.length - pins.length;
  $("#map-caption").innerHTML = `<span><b>${list.length} groups</b>: ${pins.length} on the map${off ? `, ${off} without a fixed address` : ""}</span>`;
}

// ---------- Groups ----------
function renderGroups() {
  const root = $("#view-groups");
  let list = ORGS.filter(orgPasses);
  if (ui.sort === "events") list = [...list].sort((a, b) => (upcomingByOrg.get(b.id)?.length ?? 0) - (upcomingByOrg.get(a.id)?.length ?? 0) || a.name.localeCompare(b.name));
  $("#count").textContent = `${list.length} ${list.length === 1 ? "group" : "groups"}`;
  const withFeeds = ORGS.filter((o) => (o.feeds ?? []).length).length;
  const month = EVENTS.filter((e) => e.day <= keyPlus(todayKey(), 29)).length;
  const kinds = [...new Set(ORGS.map((o) => o.kind))].filter((k) => KINDS[k]).sort();
  let html = `<div class="agate">
      <div><b>${ORGS.length}</b><span>Groups and places</span></div>
      <div><b>${withFeeds}</b><span>Calendars we read</span></div>
      <div><b>${month}</b><span>Events next 30 days</span></div>
      <div><b>${ORGS.length - withFeeds}</b><span>Still need a feed</span></div>
    </div>
    <div class="g-tools">
      <select class="select" id="g-kind" aria-label="Kind of group"><option value="">Every kind</option>${kinds.map((k) => `<option value="${k}"${ui.kind === k ? " selected" : ""}>${esc(KINDS[k])}</option>`).join("")}</select>
      <select class="select" id="g-sort" aria-label="Sort"><option value="az">A to Z</option><option value="events"${ui.sort === "events" ? " selected" : ""}>Most upcoming events</option></select>
      <label><input type="checkbox" id="g-live"${ui.live ? " checked" : ""}> Only calendars we read</label>
    </div>`;
  if (!list.length) html += `<p class="empty">No groups match. Clear the search or pick another neighborhood.</p>`;
  for (const o of list) {
    const n = upcomingByOrg.get(o.id)?.length ?? 0;
    const site = safeUrl(o.url);
    const evPage = safeUrl(o.eventsPage);
    const ig = safeUrl(o.instagram);
    const live = (o.feeds ?? []).length;
    html += `<article class="group" id="g-${esc(o.id)}" data-id="${esc(o.id)}">
      <span class="dot" style="--c:${colorOf(o.domains[0])}"></span>
      <div>
        <h3>${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(o.name)}</a>` : esc(o.name)}</h3>
        <p class="meta">${[KINDS[o.kind], hoodLabel(o.hood), o.address].filter(Boolean).map(esc).join(" · ")}${live ? ` · <span class="feed-live">calendar read daily</span>` : ""}</p>
        <p class="what">${esc(o.what)}</p>
        ${o.plugIn ? `<p class="plug">${esc(o.plugIn)}</p>` : ""}
        <div class="links">
          ${n ? `<button class="manicule" data-org-events="${esc(o.id)}">☞ ${n} upcoming</button>` : ""}
          ${evPage ? `<a class="manicule" href="${esc(evPage)}" target="_blank" rel="noopener">Events page</a>` : ""}
          ${ig ? `<a class="manicule" href="${esc(ig)}" target="_blank" rel="noopener">Instagram</a>` : ""}
        </div>
      </div>
    </article>`;
  }
  html += `<div class="classified">
      <h2>Help wire in the rest</h2>
      <p class="orn" aria-hidden="true">✳ ✳ ✳</p>
      <p>${ORGS.length - withFeeds} of these groups post events only on a web page, Instagram or a flyer, so their events cannot show up here yet. Helping each one set up a free public calendar is a buildathon job that needs no code.</p>
      <a class="manicule" href="https://github.com/benvonwong-byte/sunset-buildathon/blob/main/docs/needs-a-feed.md" target="_blank" rel="noopener">☞ See the list</a>
    </div>`;
  root.innerHTML = html;
  renderOrgPins(list);
}

function showOrg(id) {
  Object.assign(state, { q: "", cat: "", hood: "" });
  ui.kind = "";
  ui.live = false;
  setView("groups");
  requestAnimationFrame(() => {
    const el = document.getElementById("g-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    const m = markers.get(id);
    if (m) {
      m.openPopup();
      map.panTo(m.getLatLng());
    }
  });
}

// ---------- Views ----------
function setView(v) {
  state.view = v;
  for (const t of $$(".view-tab")) t.setAttribute("aria-selected", String(t.dataset.view === v));
  $("#view-events").hidden = v !== "events";
  $("#view-groups").hidden = v !== "groups";
  writeHash();
  render();
}
function render() {
  renderControls();
  if (state.view === "events") {
    renderThread();
    if (state.event) openEvent(state.event, { scroll: true });
  } else {
    renderMinical();
    renderGroups();
  }
  if (map) setTimeout(() => map.invalidateSize(), 0);
}
function refilter() {
  writeHash();
  renderControls();
  if (state.view === "events") renderThread();
  else renderGroups();
}

// ---------- Phone map sheet ----------
function openMapSheet() {
  document.body.classList.add("map-open");
  $("#map-fab").textContent = "List";
  setTimeout(() => map?.invalidateSize(), 0);
}
function closeMapSheet() {
  if (!document.body.classList.contains("map-open")) return;
  document.body.classList.remove("map-open");
  $("#map-fab").textContent = "Map";
}

// ---------- Footer ----------
function renderSources() {
  const agg = DATA.sources.filter((s) => s.kind === "aggregator" || s.kind === "feed");
  const groups = DATA.sources.filter((s) => s.kind === "org");
  const ok = groups.filter((s) => s.ok);
  const items = [
    `<li>Group calendars: ${ok.length} of ${groups.length} read</li>`,
    ...agg.map((s) => `<li class="${s.ok ? "" : "bad"}">${esc(s.label.replace(/ \((\w|-)+\)$/, ""))}: ${s.ok ? `${s.count} events` : "did not load this morning"}</li>`),
  ];
  const failing = groups.filter((s) => !s.ok);
  if (failing.length) items.push(`<li class="bad">Did not load: ${failing.map((s) => esc(s.label.replace(/ \(.*\)$/, ""))).join(", ")}</li>`);
  if (DATA.fetchedAt) items.push(`<li>Updated ${esc(stampFmt.format(new Date(DATA.fetchedAt)))}</li>`);
  $("#sources").innerHTML = items.join("");
}

// ---------- Subscribe ----------
function setupSubscribe() {
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
function wire() {
  $("#cat").addEventListener("change", (e) => {
    state.cat = e.target.value;
    refilter();
  });
  $("#hood").addEventListener("change", (e) => {
    state.hood = e.target.value;
    refilter();
  });
  let timer;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = e.target.value.trim();
      refilter();
    }, 160);
  });
  $("#day-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (!b) return;
    state.day = b.dataset.day;
    refilter();
    if (window.scrollY > $(".layout").offsetTop) window.scrollTo({ top: $(".layout").offsetTop - 60 });
  });
  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) return setView(go.dataset.goto);
    const clear = e.target.closest("[data-clear]");
    if (clear) {
      state[clear.dataset.clear] = "";
      refilter();
    }
  });
  for (const t of $$(".view-tab")) t.addEventListener("click", () => setView(t.dataset.view));
  $("#side").addEventListener("change", (e) => {
    if (e.target.id !== "map-range") return;
    ui.mapRange = e.target.value;
    renderEventPins();
  });

  // Thread: open rows, hover pins, detail buttons
  const thread = $("#thread");
  thread.addEventListener("click", (e) => {
    const row = e.target.closest(".ev-row");
    if (row) {
      const art = row.closest(".ev");
      return art.classList.contains("open") ? closeEvent(art) : openEvent(art.dataset.id);
    }
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
    if (share) return copy(`${location.origin}${location.pathname}#event=${share.dataset.share}`, "Link copied");
    const org = e.target.closest("[data-show-org]");
    if (org) showOrg(org.dataset.showOrg);
  });
  let hovered = null;
  thread.addEventListener("mouseover", (e) => {
    const art = e.target.closest(".ev");
    if (art === hovered) return;
    if (hovered) hot(hovered.dataset.id, false);
    hovered = art;
    if (art) hot(art.dataset.id, true);
  });
  thread.addEventListener("mouseleave", () => {
    if (hovered) hot(hovered.dataset.id, false);
    hovered = null;
  });

  // Calendar and date strip
  $("#minical").addEventListener("click", (e) => {
    const nav = e.target.closest("[data-month]");
    if (nav) {
      ui.month = nav.dataset.month;
      return renderMinical();
    }
    const day = e.target.closest(".mc-day[data-day]");
    if (day && !day.disabled) return jumpTo(day.dataset.day);
    const cat = e.target.closest("[data-cat]");
    if (cat) {
      state.cat = state.cat === cat.dataset.cat ? "" : cat.dataset.cat;
      refilter();
    }
  });
  $("#date-strip").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (b) jumpTo(b.dataset.day);
  });

  // Groups
  const groups = $("#view-groups");
  groups.addEventListener("change", (e) => {
    if (e.target.id === "g-kind") ui.kind = e.target.value;
    if (e.target.id === "g-sort") ui.sort = e.target.value;
    if (e.target.id === "g-live") ui.live = e.target.checked;
    renderGroups();
  });
  groups.addEventListener("click", (e) => {
    const b = e.target.closest("[data-org-events]");
    if (!b) return;
    Object.assign(state, { org: b.dataset.orgEvents, q: "", cat: "", hood: "", day: "", event: "" });
    setView("events");
    window.scrollTo({ top: $(".layout").offsetTop - 60 });
  });
  let hotGroup = null;
  groups.addEventListener("mouseover", (e) => {
    const g = e.target.closest(".group");
    if (g === hotGroup) return;
    markers.get(hotGroup?.dataset.id)?.getElement()?.firstElementChild?.classList.remove("hot");
    hotGroup = g;
    const m = g && markers.get(g.dataset.id);
    m?.getElement()?.firstElementChild?.classList.add("hot");
    m?.setZIndexOffset(1000);
  });

  $("#map-fab").addEventListener("click", () => (document.body.classList.contains("map-open") ? closeMapSheet() : openMapSheet()));

  // Dialogs
  for (const dlg of $$("dialog")) {
    dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
    $$("[data-close]", dlg).forEach((b) => b.addEventListener("click", () => dlg.close()));
  }
  const openAdd = () => $("#add-dialog").showModal();
  $("#open-add").addEventListener("click", openAdd);
  $("#foot-add").addEventListener("click", openAdd);

  // The calendar and map follow the day you are reading
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        trackScroll();
      });
    },
    { passive: true }
  );

  // Keys
  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
    if (typing) {
      if (e.key === "Escape") document.activeElement.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      return $("#search").focus();
    }
    if (e.key === "Escape") {
      closeMapSheet();
      return $$(".ev.open").forEach(closeEvent);
    }
    if (e.key === "g") return setView(state.view === "events" ? "groups" : "events");
    if (state.view !== "events") return;
    const rows = $$("#thread .ev");
    if (e.key === "j" || e.key === "k") {
      rows[ui.kIndex]?.classList.remove("kfocus");
      ui.kIndex = Math.max(0, Math.min(rows.length - 1, ui.kIndex + (e.key === "j" ? 1 : -1)));
      const r = rows[ui.kIndex];
      if (!r) return;
      r.classList.add("kfocus");
      r.scrollIntoView({ block: "center" });
      hot(r.dataset.id, true);
      setTimeout(() => hot(r.dataset.id, false), 900);
    }
    if (e.key === "Enter" && rows[ui.kIndex]) {
      const r = rows[ui.kIndex];
      if (r.classList.contains("open")) closeEvent(r);
      else openEvent(r.dataset.id);
    }
  });

  window.addEventListener("hashchange", () => {
    const before = { ...state };
    readHash();
    if (state.event && state.event !== before.event && state.view === "events" && state.view === before.view) {
      return openEvent(state.event, { scroll: true });
    }
    if (HASH_KEYS.some((k) => k !== "event" && state[k] !== before[k]) || state.view !== before.view) setView(state.view);
  });
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
  for (const o of ORGS) {
    orgById.set(o.id, o);
    o._text = [o.name, o.what, o.plugIn, o.address, hoodLabel(o.hood), KINDS[o.kind], ...o.domains.map((d) => domainById.get(d)?.label)].join(" ").toLowerCase();
  }
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
  readHash();
  initMap();
  wire();
  setupSubscribe();
  renderSources();
  setView(state.view);
}

boot();
