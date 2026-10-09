# Sunset District event aggregators: research notes

For sunset.dearcrisis.com. Researched and tested 2026-10-09 from a residential
San Francisco IP with plain `fetch`/`curl`, no keys, no browser, no login.
Code: `aggregators.mjs` (same folder). Samples: `samples/`.

District box used everywhere: lat 37.7300 to 37.7725, lng -122.5140 to -122.4520
(`SUNSET_BOX` in the module). "In-box, 60 days" counts below are from the run
pasted at the end (window 2026-10-09 16:00 PDT to 2026-12-08).

## Summary

| # | Source | Works | Method | Coordinates | In-box, 60 d |
|---|--------|-------|--------|-------------|-------------:|
| 1 | Luma | yes | `api.lu.ma/discover/get-paginated-events?latitude&longitude` (no place id) | yes (some jittered) | 17 |
| 2 | Eventbrite | yes | `POST /api/v3/destination/search/` with `bbox`, csrftoken cookie | yes | 180 |
| 3 | Meetup | yes | `POST /gql2` raw GraphQL `recommendedEvents(lat, lon, radius)` | yes | 77 |
| 4 | SF Public Library | yes | sfpl.org Drupal calendar view, JSON in page settings | branch coords (fixed) | 147 |
| 5 | SF Rec & Park | yes | CivicPlus iCal per category | no, text rules + gazetteer | 12 |
| 6 | Funcheap SF | yes | region archive HTML + per-event JSON-LD | no, text rules + gazetteer | 57 |
| 7a | AllEvents.in | not used | the site blocks crawlers | | |
| 7b | DoTheBay / Do415 | yes | DoStuff `.json` views (daily + per-venue) | partial | 24 |
| 7c | SF.gov events | yes | `api.sf.gov/api/related-events` | no, ZIP/gazetteer | 2 |
| 7d | Gardens of Golden Gate Park | yes | The Events Calendar REST | no, gazetteer | 35 |
| 7e | Sunset Dunes (park site) | yes | Squarespace `?format=json` | yes (with bad defaults) | 16 |
| - | Bandsintown, Patch, SF Station, goldengatepark.com, Stern Grove, famsf.org, BiblioCommons | no | see "Failed / skipped" | | 0 |

567 rows in total from the 10 default sources before cross-source dedupe
(overlap notes below). The whole run takes about 37 s with sources in
parallel; summed sequentially it is about 115 s, so it stays under 3 minutes
either way.

## Shared conventions in the module

- Every fetcher: `fetchX({ box, days = 60, now, budgetMs = 100000 })`. Requests
  inside one source are sequential with 200 to 400 ms gaps; `fetchAll()` runs
  sources in parallel. Each has a page cap and a time budget, catches
  everything, `console.warn`s, and returns `[]` (verified with fetch stubbed to
  throw and to return 403). DoTheBay and Rec & Park stop after 3 consecutive
  failures so a blocked host is not hammered.
- UA: desktop Chrome 129 on macOS. No other identifying header.
- Times: all `start`/`end` are wall time in America/Los_Angeles with the
  correct DST offset (`2026-11-01T14:00:00-08:00`), computed with
  `Intl.DateTimeFormat(..., { timeZoneName: "longOffset" })`. Needs Node 20
  with full ICU (the default build; GitHub's setup-node has it).
- Window filter: keeps events that have not ended, start before now + days,
  and started no more than 1 day ago (drops months-long "ongoing" exhibitions
  and series parents).
- `locateByText()` handles sources with no coordinates. Order: reject a
  non-941xx ZIP; then a gazetteer of ~40 in-district places with coordinates
  (Golden Gate Park venues south of Fulton, Stern Grove, Zoo, rec centers,
  library branches, Sunset Dunes, UICC); then "Ocean Beach" unless a Richmond
  street or 94121 is named; then ZIP 94122/94116 yes, any other ZIP no; then
  Sunset street names written as a street ("Irving St", "Irving & 22nd",
  "Lincoln Way", "Great Highway"). Plain "Golden Gate Park" with no named
  venue does not pass, per the brief.
- `refineToDistrict(events)` (optional, exported, not applied by the
  fetchers): the box is a rectangle and also catches West Portal and St.
  Francis Wood (94127), the Ocean Ave strip (94132), the west end of Haight
  St east of Stanyan (94117, mostly O'Reilly's Pub) and UCSF Parnassus. This
  pass drops events whose own address has a ZIP other than 94122/94116 or
  names one of those neighbourhoods, unless the venue is a known in-district
  place (any Golden Gate Park venue or internal park road, Ocean Beach / Great
  Highway, Stern Grove, Zoo). On the final run it drops 77 of 567 rows (47
  Eventbrite, 19 Meetup, 9 DoTheBay, 2 Luma); 30 of those are one bar,
  O'Reilly's Pub at Haight & Stanyan. Decide whether to use it or to tighten
  the box (east edge -122.4535 removes O'Reilly's Pub).

---

## 1. Luma

**Works. Use lat/lng mode, not the SF place.**

- Bootstrap: `GET https://api.lu.ma/discover/bootstrap-page` lists 87 discover
  places. San Francisco is `discplace-BDj7GNbGlsF7Cka` (slug `sf`, centre
  37.7749, -122.4194). Response also echoes `debug_info.ip_coordinate`.
- `GET https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=discplace-BDj7GNbGlsF7Cka&pagination_limit=50`
  returns only the curated SF list: 66 events total, 1 in the box. Not useful.
- **What works:** drop the place id and pass coordinates:
  `GET https://api.lu.ma/discover/get-paginated-events?latitude=37.7512&longitude=-122.4830&pagination_limit=50[&pagination_cursor=<next_cursor>]`
  returns every discoverable event within about 70 km, sorted by `start_at`:
  1,252 events (26 pages) on 2026-10-09, 17 in the box within 60 days. The
  coordinates really are honoured (the same call with NYC coordinates returns
  Brooklyn/Montclair events), so a GitHub runner IP outside SF does not matter.
- `radius`, `distance_km`, `lat`/`lng` aliases: ignored (identical results).
  `pagination_limit` is capped at 50. Stop paging once the last `start_at` on a
  page is past the window (about 24 pages for 60 days, ~250 ms each).
- `luma.com/sf` HTML `__NEXT_DATA__` → `props.pageProps.initialData.data.events`
  has only 20 events. Not useful.
- Headers: none needed. No rate limiting seen at ~3 req/s.
- Fields (`entries[]`): `event.name`, `event.start_at` / `event.end_at` (UTC
  ISO), `event.timezone`, `event.url` (slug → `https://luma.com/<slug>`),
  `event.location_type` (`offline`), `event.coordinate.{latitude,longitude}`,
  `event.geo_address_info` (`mode: "shown"` → `address`, `full_address`,
  `sublocality`, `place_coordinate`; `mode: "obfuscated"` → only
  `sublocality`/`city_state`, and `coordinate` is **jittered**; 436 of 1,252
  were obfuscated), `event.cover_url`, `calendar.name` / `calendar.is_personal`,
  `hosts[].name`, `ticket_info.{is_free, price, max_price, is_sold_out}`,
  `guest_count`.
- Description is not in the list. `GET https://api.lu.ma/event/get?event_api_id=evt-…`
  returns `description_mirror` (ProseMirror JSON); the fetcher pulls it for each
  in-box event (17 extra requests, capped at 50).
- Caveat: obfuscated rows place West Portal events inside the box; their
  `sublocality` ("West Portal") is the reliable signal and `refineToDistrict`
  uses it.

## 2. Eventbrite

**Works. `destination/search` with a `bbox` is the best method: 180 in-box
events with coordinates, 4 requests.**

- Location pages (`/d/ca--san-francisco/events/`, `--this-week/`,
  `/d/ca--san-francisco--outer-sunset/events/`, `--inner-sunset/`) all return
  200 with `window.__SERVER_DATA__` (not plain JSON to `</script>`; needs a
  brace-matching extract). Inside: `jsonld[0].itemListElement` (24 to 40 events
  with `location.geo`), `buckets[].events` (4 to 8 each), and the
  Who's-on-First place ids: San Francisco `85922583`, Outer Sunset
  `85865975`, Inner Sunset `85865973`. Pages are 590 to 840 KB and show at most
  ~40 events. Fine as a fallback, not as the main feed.
- `GET https://www.eventbrite.com/api/v3/destination/events/?event_ids=<ids,comma>&expand=primary_venue,ticket_availability,image,primary_organizer&page_size=50`
  **works without auth** and returns venue lat/lng for any id list. Note that
  a series parent id returns the series span (`start_date` 2026-01-11 to
  `end_date` 2026-12-13), so use occurrence ids.
- `POST https://www.eventbrite.com/api/v3/destination/search/` without a
  cookie: `401 {"error_description":"CSRF Failed: CSRF cookie not set."}`.
  With the cookie it works:
  1. `GET https://www.eventbrite.com/signin/` (37 KB; any HTML page works) and
     read `csrftoken` from `Set-Cookie` (`res.headers.getSetCookie()`).
  2. `POST` with headers `content-type: application/json`,
     `x-csrftoken: <token>`, `cookie: csrftoken=<token>`,
     `referer: https://www.eventbrite.com/d/ca--san-francisco/events/`.
     No other cookie is needed.
  3. Body:
     ```json
     {"event_search":{"dates":"current_future","dedup":false,
       "bbox":"-122.514,37.73,-122.452,37.7725",
       "page":1,"page_size":50,"online_events_only":false},
      "expand.destination_event":["primary_venue","image","ticket_availability","primary_organizer"],
      "browse_surface":"search"}
     ```
  - Pagination: `page` 1..N; `events.pagination.{object_count, page_count, continuation}`;
    stop when `continuation` is null. 194 future events in the box over 4 pages.
  - `bbox` is `west,south,east,north`. `point_radius: {latitude, longitude,
    radius: "3km"}` also works (201 results, 46 of the first 50 in box).
    `places: ["85865975"]` is effectively ignored in search (10,000 results,
    citywide), so do not rely on it.
  - `dedup: true` collapses repeat occurrences (182 vs 194).
- Fields (`events.results[]`): `name`, `start_date` + `start_time`, `end_date`
  + `end_time` (local wall time), `timezone`, `url`, `is_online_event`,
  `is_cancelled`, `primary_venue.name`,
  `primary_venue.address.{localized_address_display, latitude, longitude, postal_code}`
  (strings), `primary_organizer.name`, `image.url` (also
  `image.original.url`), `summary` (short description),
  `ticket_availability.{is_free, minimum_ticket_price, maximum_ticket_price}`,
  `series_id`, `tags[]`.
- No rate limiting seen. Eventbrite does run bot detection on some routes;
  this flow uses only the public search the site itself calls.

## 3. Meetup

**Works without auth. `gql2` accepts raw (non-persisted) queries and has
introspection enabled.**

- `GET https://www.meetup.com/find/?location=us--ca--San%20Francisco&source=EVENTS`
  has `__NEXT_DATA__.props.pageProps.__APOLLO_STATE__` with 16 `Event:` records
  from `recommendedEvents` (venue has name/address but **no lat/lon** in the
  SSR selection). Not enough on its own.
- **Working call** (`POST https://www.meetup.com/gql2`, `content-type:
  application/json`, no cookie, no token):
  ```graphql
  query($filter: RecommendedEventsFilter!, $first: Int, $after: String, $sort: RecommendedEventsSort) {
    recommendedEvents(filter: $filter, first: $first, after: $after, sort: $sort) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id title description dateTime endTime eventUrl eventType status
        feeSettings { amount currency }
        featuredEventPhoto { highResUrl }
        venue { name address city state postalCode lat lon }
        group { name urlname }
      } }
    }
  }
  ```
  ```json
  {"filter":{"lat":37.755,"lon":-122.485,"radius":2,"eventType":"PHYSICAL",
             "startDateRange":"2026-10-09T00:00:00-07:00[US/Pacific]",
             "endDateRange":"2026-12-08T23:59:59-08:00[US/Pacific]"},
   "first":50,"after":null,"sort":{"sortField":"DATETIME"}}
  ```
  `radius` is in miles. Date ranges use Java `ZonedDateTime` strings
  (`…-07:00[US/Pacific]`). Paginate with `after: pageInfo.endCursor`.
- `recommendedEvents` ranks and truncates each query (`totalCount` is
  unreliable: 44 reported, 68 returned). One circle at r=2 gives 59 in box,
  r=5 gives 69, r=25 only 40. Tiling the box with 6 circles of r=1.5 mi and
  unioning by `id` gives 76 to 80. The fetcher does that (about 12 requests,
  ~8 s).
- `eventSearch(filter: EventSearchFilter!)` also exists but requires `query`
  (keyword); not needed.
- Fields: `title`, `dateTime` / `endTime` (ISO with offset), `eventUrl`,
  `venue.{name,address,city,state,postalCode,lat,lon}`, `group.name`,
  `featuredEventPhoto.highResUrl`, `description` (plain text/markdown),
  `feeSettings` (null = no fee), `status` (`ACTIVE`), `eventType`
  (`PHYSICAL`/`ONLINE`; online events come with a fake venue at -8.52, 179.19).
- No rate limiting seen at ~3 req/s.

## 4. San Francisco Public Library

**BiblioCommons does not work; sfpl.org does.**

- `GET https://gateway.bibliocommons.com/v2/libraries/sfpl/events?…` →
  `403 {"error":{"message":"The Events feature is not available at San Francisco Public Library"}}`.
  SFPL runs events on its own Drupal 10 site.
- Location term ids (from the `field_event_location_target_id` select on
  `https://sfpl.org/events`): **Sunset 48, Ortega 46, Parkside 55**; nearby
  West Portal 50, Merced 36, Anza 41, Ingleside 40.
- **Working call:** the calendar view embeds every event for the filtered
  branches as JSON:
  `GET https://sfpl.org/events/calendar?field_event_location_target_id[]=48&field_event_location_target_id[]=46&field_event_location_target_id[]=55`
  → `<script type="application/json" data-drupal-selector="drupal-settings-json">`
  → `sfplEvents.events[]` = `{ title, start, end, url, formatted_title }`.
  `start`/`end` are ISO with offset; `url` is relative; `formatted_title` is an
  HTML snippet holding the branch short name and audience. One request returns
  everything the branches have scheduled (368 rows from 2026-08-01 to
  2026-12-02, 147 of them in the window: Sunset 64, Ortega 49, Parkside 34).
  The month path argument (`/events/calendar/202612`) does not change the set.
  Without a location filter the view returns a capped set (mostly Virtual
  Library), so always filter.
- List view alternative: `https://sfpl.org/events?field_event_location_target_id=48&items_per_page=50&page=N`
  (`items_per_page` must be 10, 25 or 50; other values return "No events
  found"). Its dates read "Tuesday, 11/17/2026, 4:00 - 5:30" with no am/pm, so
  avoid it.
- Per-event ICS with the description: `https://sfpl.org/sfpl-events/add-to-calendar/<node id>`
  (node id is in the list view's `/quickview/<nid>` link). Not used (one
  request per event).
- No coordinates; the module pins each event to its branch:
  Sunset 1305 18th Ave (37.763385, -122.476292), Ortega 3223 Ortega St
  (37.751258, -122.498025), Parkside 1200 Taraval St (37.743191, -122.479389),
  taken from the `data-lat`/`data-lng` on `sfpl.org/locations/<branch>`.
- No images in the feed; all SFPL programs are free.

## 5. SF Recreation & Parks

**Works via CivicPlus iCal. Coverage is thin (12) because most Sunset events
are filed under the Main Calendar, and the "Sunset Dunes" and "Golden Gate
Park" categories are empty.**

- Site is CivicPlus (`/Calendar.aspx`). RSS
  `https://sfrecpark.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml` works but
  returns only the next 30 items citywide.
- iCal per category: `https://sfrecpark.org/common/modules/iCalendar/iCalendar.aspx?catID=<N>&feed=calendar`.
  There is no all-categories iCal (`catID=All` and comma lists 404; no catID
  returns an empty body). Categories from `https://sfrecpark.org/iCalendar.aspx`:
  14 Main Calendar, 22 Golden Gate Park (empty), 28 Commission, 29 Volunteer,
  30 Mobile Rec, 32 PROSAC, 33 Urban Agriculture, 34 Capital and Planning,
  35 Golden Gate Bandshell Concerts, 37 JFK Promenade, 39 EcoCenter,
  40 UN Plaza / Civic Center, 41 Polo Field Cycling Track, 42 Sunset Dunes
  (empty), 43 (TEST) Recreation Center.
  The fetcher reads all except 41 (123 "Cycle Track Open After 6:45 PM" slots,
  which are not events and have a bogus 94612 ZIP).
- VEVENT fields: `SUMMARY`, `DTSTART;TZID=America/Los_Angeles`, `DTEND`,
  `LOCATION` ("<facility> - <street> San Francisco CA <zip>", sometimes with
  `<p>` tags), `DESCRIPTION` (text plus `https://sfrecpark.org/calendar.aspx?EID=<id>`),
  `UID` (= EID). No `RRULE`; each occurrence is its own VEVENT. No coordinates,
  image, organizer or price.
- Filtering is by `LOCATION` text through `locateByText` (Sunset Dunes, Stern
  Grove, McLaren Lodge, Sunset Rec Center, etc.).
- No rate limiting seen.

## 6. Funcheap SF

**Works via region archive pages + JSON-LD. The WordPress REST API is not
usable for this.**

- `GET https://sf.funcheap.com/wp-json/` is open, and posts have a `region`
  taxonomy (`/wp-json/wp/v2/region?search=sunset` → Sunset District **13198**;
  Golden Gate Park **13152**; Ocean Beach **13263**; West Portal 13220; Lake
  Merced 13332). But `wp/v2/posts?region=13198` ignores the filter (returns all
  144,807 posts), post `content` is an empty share-button stub, and `date` is
  the publish date, not the event date. No event meta is exposed.
- `/feed/` redirects to `feeds.feedburner.com/funcheapsf_recent_added_events`
  (publish dates). Not useful.
- **Working:** `https://sf.funcheap.com/region/<slug>/` and `/region/<slug>/page/<n>/`
  (slugs `sunset-district`, `golden-gate-park`, `ocean-beach`). Each upcoming
  occurrence is a `<div id="post-<id>" class="tanbox left …">` block with
  `<span class="title entry-title"><a href>`, and
  `<div class="meta archive-meta date-time…" data-event-date="2026-10-10 14:00" data-event-date-end="2026-10-10 15:00">`
  holding the cost ("Cost: FREE", sometimes inside a tooltip) and the venue
  name in the last `<span>`. Recurring posts repeat once per date.
  Sunset District had 5 upcoming, Golden Gate Park ~50 over 2 pages, Ocean
  Beach 4.
- Event page: `<script type="application/ld+json">` with `@type: Event`:
  `name`, `startDate`/`endDate` (ISO with offset), `location.name`,
  `location.address` (string, usually no ZIP, **no geo**), `offers.price`,
  `image` (80x80 crop; dropping the `-80x80` suffix gives the original, checked
  200), `description` (full text). No `og:image`. The listing's
  `data-event-date-end` and the JSON-LD `endDate` sometimes disagree; the
  module trusts the listing (it is per occurrence).
- Filtering: `locateByText` on venue + address; "Sunset District"-tagged rows
  are kept unless their address names another ZIP. The fetcher dedupes by
  title + start because Funcheap double-posts the same listing under two URLs.
  Detail pages are capped at 60 per run (~36 s at 300 ms spacing).
- No rate limiting seen.

## 7a. AllEvents.in

Not used. The site blocks crawlers, and most of its Sunset listings are copies of Eventbrite events, which the Eventbrite fetcher already reads. Do not add it without the site's permission.

## 7b. DoTheBay (Do415 redirects here)

**Works via DoStuff's `.json` views. Small but includes Cal Academy NightLife,
de Young, County Fair Building and Botanical Garden events.**

- Any listing URL takes `.json`: `https://dothebay.com/events/2026/10/10.json?page=N`
  (25 per page, ~150 events a day, `paging.total_pages`),
  `https://dothebay.com/venues/<slug>.json` (all upcoming at that venue in
  `event_groups[].events[]`), `https://dothebay.com/venues.json?page=N` (505
  "popular" venues only; it misses small Sunset venues, so not used).
- No location filter. The fetcher scans 14 days of daily pages to discover
  in-box venues (~57 requests), then reads every in-box venue's page plus a
  seed list (County Fair Building, Cal Academy, de Young, Botanical Garden,
  Robin Williams Meadow, Golden Gate Park, Irving Street, The Riptide) for the
  rest of the window. A full 60-day daily scan would be ~245 requests (~140 s).
- Fields: `title`, `tz_adjusted_begin_date` (ISO with offset),
  `tz_adjusted_end_date` (filled with a fake next-day 02:00 when there is no
  end; trust it only if `end_time` or `end_date` is set), `permalink` →
  `https://dothebay.com<permalink>`, `venue.{title, full_address, zip,
  latitude, longitude}` (lat/lng often null), `presented_by`, `excerpt`,
  `is_free`, `imagery.aws.cover_image_h_630_w_1200`.
- Recurring/ongoing listings keep their first date (e.g. a weekly trivia night
  "began" 2025-10-08 and "ends" 2026-10-28); the window filter drops them.

## 7c. SF.gov events

- `GET https://api.sf.gov/api/related-events/?list=upcoming&locale=en&page=1&page_size=100`
  (Wagtail API behind `www.sf.gov/events`; `page_size` works, `limit`/`per_page`
  do not). 189 upcoming citywide; 2 in the district (District 4 Family Summit
  at Sunset Rec Center, a citizenship workshop at the County Fair Building).
- Fields: `title`, `description`, `start_datetime`/`end_datetime` (ISO with
  offset), `date_time[0].value.is_all_day`,
  `location[].value.{location_name, line1, city, zip}` (type `address` or
  `online`), `primary_agency.title`, `meta.slug` → `https://www.sf.gov/<slug>`.
  No coordinates.

## 7d. Gardens of Golden Gate Park (SF Botanical Garden, Japanese Tea Garden, Conservatory of Flowers)

- `GET https://gggp.org/wp-json/tribe/events/v1/events?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&per_page=50&page=N`
  (The Events Calendar REST; `total`, `total_pages`). 43 events in 60 days.
  `?ical=1` also works but stops at 30.
- Fields: `title`, `utc_start_date`/`utc_end_date` ("YYYY-MM-DD HH:MM:SS",
  UTC), `start_date` (local), `timezone`, `all_day`, `url`, `venue.venue`
  (no address or geo in the object), `organizer[]`, `image.url`, `excerpt`,
  `description` (HTML), `cost`, `cost_details.values`. Coordinates come from
  the gazetteer; 4 events with no venue are kept with null coordinates since
  everything this org runs is inside the park.

## 7e. Sunset Dunes park site

- `GET https://sunsetdunes.org/events?format=json` (Squarespace) →
  `upcoming[]` (19, through mid-December) with `title`, `startDate`/`endDate`
  (epoch ms), `fullUrl`, `assetUrl`, `excerpt` (HTML),
  `location.{addressTitle, addressLine1, markerLat, markerLng}`. Several rows
  have Squarespace's default marker (40.7207559, -74.0007613, Manhattan), so
  the fetcher falls back to the address or to the park itself.
- Overlaps Rec & Park's Main Calendar (same Zumba / Serenades / cleanup series).

## Failed / skipped

| Source | Result |
|--------|--------|
| BiblioCommons gateway (SFPL) | 403 "Events feature is not available at San Francisco Public Library" |
| Bandsintown `/c/san-francisco-ca` | 403 Cloudflare challenge. The REST API needs an `app_id`. |
| goldengatepark.com | 526 (origin TLS broken) |
| patch.com SF calendar | 45 KB shell, client-rendered, no JSON-LD or `__NEXT_DATA__` |
| sfstation.com/calendar | Microdata only (`itemprop=startDate` date with no time, street address with no ZIP), 20 per page. Possible but low precision; skipped. |
| Stern Grove (sterngrove.org) | No events page (`/events` 404); the festival is summer-only. Its October Halloween event is in Rec & Park. |
| famsf.org/calendar (de Young) | 403. de Young events arrive through DoTheBay, Funcheap and Eventbrite. |
| calacademy.org, sfzoo.org | HTML only, no feed found; NightLife arrives through DoTheBay/Funcheap. |
| Funcheap `wp-json` | Region filter ignored, no event fields (see section 6) |
| AllEvents.in | Not used: the site blocks crawlers |
| Luma `radius` / place id | Radius ignored; the place id gives only 66 curated events |
| Eventbrite `places` in search | Ignored (citywide results) |

## Cross-source overlap and dedupe advice

On the final run (default sources), 18 title+date groups appear in more than
one source: DoTheBay + Eventbrite 8, Rec & Park + Sunset Dunes 5, Eventbrite +
Meetup 4, Eventbrite + Funcheap 1. With AllEvents enabled it was 74, nearly all
AllEvents + Eventbrite. Suggested dedupe key: normalized
title + local date + venue coordinates rounded to 3 decimals, preferring
Eventbrite > Luma > Meetup > venue feeds > AllEvents/DoTheBay/Funcheap. For
AllEvents use the embedded Eventbrite id first.

## Risks to check before relying on this in CI

- Everything was tested from a residential IP. GitHub Actions egress is
  datacenter IP space; Eventbrite, Meetup and AllEvents are the most likely to
  challenge it. The fetchers fail soft, but run the workflow once and look at
  the per-source counts before trusting it.
- AllEvents blocks crawling (see 7a). Do not turn it on in CI without
  permission.
- Event descriptions are third-party text (they contain em dashes and
  promotional copy). If the DearCrisis voice gate is ever pointed at the
  generated events file, register descriptions as quoted data or keep the
  file out of `check-voice`, otherwise the build fails on someone else's
  prose.

## Real run output

Command: `node aggregators.mjs --out=raw/all_events.json` (default sources,
Node 25.9 on macOS; a subset also ran clean on Node 24.13). Output pasted
verbatim:

```

Sunset box {"minLat":37.73,"maxLat":37.7725,"minLng":-122.514,"maxLng":-122.452}, next 60 days, run 36.6s

luma           17 events  (17 with lat/lng, 18.9s)
    2026-10-09 18:00  Vibe Night Demos (#29)  @ West Portal, San Francisco, CA
    2026-10-10 09:00  Landmark Trees along the Crosstown  @ 599 Martin Luther King Jr Dr
    2026-10-10 14:00  Stroll At Golden Gate Park  @ 601 Stanyan St
eventbrite    180 events  (180 with lat/lng, 11.0s)
    2026-10-09 15:00  Intergenerational and Accessible Bike Ride in Golden Gate Park  @ Golden Gate Park Bandshell
    2026-10-09 15:15  Friday Wine Tasting 10/9  @ The San Francisco Wine Trading Company
    2026-10-09 16:00  Forever Grateful, Golden Gate Park  @ San Francisco County Fair Building
meetup         77 events  (77 with lat/lng, 6.3s)
    2026-10-09 18:45  Weekly Christian AA/NA recovery meetings  @ SF TFH Recovery Center
    2026-10-09 18:45  Weekly Christian AA/NA meetings  @ SF TFH RECOVERY CENTER
    2026-10-10 08:45  Saturday Morning Co-Ed Soccer in the Park  @ Golden Gate Park Polo Field
sfpl          147 events  (147 with lat/lng, 0.1s)
    2026-10-10 10:30  Social: Plant Swap  @ Sunset Branch Library
    2026-10-10 10:30  Storytime: For Families  @ Sunset Branch Library
    2026-10-10 14:00  Activity: Origami Hour  @ Sunset Branch Library
recpark        12 events  (12 with lat/lng, 5.5s)
    2026-10-10 10:30  Zumba and Shake The Fog  @ Sunset Dunes
    2026-10-11 12:00  2nd Sunday Serenades  @ Sunset Dunes
    2026-10-11 13:00  Sunset Dunes Community Cleanup  @ Sunset Dunes and Upper Great Highway
funcheap       57 events  (55 with lat/lng, 36.6s)
    2026-10-10 09:30  Free de Young Museum Day for Bay Area Residents (Every Saturday)  @ de Young Museum
    2026-10-10 10:30  Golden Gate Park “Singing in the Park” Community Party (SF)  @ Mothers Meadow (Golden Gate Park)
    2026-10-10 12:00  Golden Gate Park “The Whale’s Tail” Beer/Wine Garden + Live Music (Sum  @ The Whale’s Tale Garden Bar
dothebay       24 events  (20 with lat/lng, 32.5s)
    2026-10-08 19:00  Odyssea  @ San Francisco County Fair Building
    2026-10-09 19:00  Wooden/Apple/Heart | Like Planes | With You | Ash Puddle  @ O'Reilly's Pub
    2026-10-10 10:00  Sketching with Sami: Landscapitos  @ San Francisco Botanical Garden
sfgov           2 events  (2 with lat/lng, 3.1s)
    2026-11-14 10:00  Free citizenship workshop  @ San Francisco County Fair Building
    2026-11-14 11:00  District 4 Family Summit  @ Sunset Recreation Center
gggp           35 events  (31 with lat/lng, 0.5s)
    2026-10-10 10:00  Knitting in Nature  @ SF Botanical Garden
    2026-10-10 10:00  October Plant Sale: California Natives  @ SF Botanical Garden
    2026-10-10 11:00  UC Master Gardener Talk: Habitat Gardening for Winter & Migratory Bird  @ SF Botanical Garden
sunsetdunes    16 events  (16 with lat/lng, 0.3s)
    2026-10-10 10:30  Zumba and Shake the Fog!  @ Sunset Dunes @ Irving
    2026-10-11 12:00  2nd Sunday Serenades  @ Sunset Dunes @ Judah
    2026-10-11 13:00  Community Cleanup  @ Upper Great Highway at Judah
TOTAL         567 events (before cross-source dedupe)
refineToDistrict() keeps 490; drops 77 edge-of-box events {"luma":2,"meetup":19,"dothebay":9,"eventbrite":47}
wrote raw/all_events.json
```
