# Sunset Groups, Map and Events

Every public event we can find in San Francisco's Inner and Outer Sunset, plus a directory of the groups and places that hold them. Live at **[sunset.dearcrisis.com](https://sunset.dearcrisis.com)**, a [Dear Crisis](https://dearcrisis.com) project by Benjamin Von Wong, built for the Sunset Neighborhood Build-a-thon on 9 October 2026.

This repo holds the whole project, so it can be handed over in one piece. **[HANDOFF.md](HANDOFF.md)** says what keeps the listings updating every morning without anyone's computer, and the checklist for a new steward.

| Part | Address | Source |
|---|---|---|
| **Sunset Events**: groups, map and every public event | `/`, and `/events/` for the event list | `site/`, `scripts/`, `data/` |
| **Sunset Idle Space**: storefronts closed at a chosen hour, with floor space | `/space/` | `site/space/`, `tools/space/` |
| **The Build-a-thon recap**: every pitch, the photos, what got built | `/recap/` and [dearcrisis.com/buildathon](https://dearcrisis.com/buildathon) | `recap/` (with its own [handoff guide](recap/README.md)), `site/recap/` |

Every page ships a drawn share card for WhatsApp, Signal and iMessage, a canonical link, geo tags and JSON-LD; the site also publishes `sitemap.xml`, `robots.txt` and `llms.txt`. `scripts/check-preview.mjs` fails the build if a page loses any of it.

The page has three views, each one column with one search box and one row of chips at most.

**Groups** is the directory: nonprofits first, then volunteer groups, neighborhood groups, faith communities, city programs, schools, places and local news, A to Z within each. Every line says what the group does; tap it for how to take part, its links, its upcoming events and its pin on the map.

**Map** shows today's events, the next seven days, or every group, with one switch. Tap a pin for a card that links to the full listing.

**Events** is one threaded list grouped by day, the way dearcrisis.com/events reads, with a strip of dates on top that follows your reading. Tap an event for details, an Add to Google Calendar link, an `.ics` file, its pin and a share link.

Every state is a shareable link (`#view=events&event=...`, `#group=...`, `#view=map&map=groups`).

Anyone can subscribe to the whole calendar, or one category of it, in Google Calendar, Apple Calendar or Outlook from the Subscribe button.

## How it works

```
data/orgs.json ──► scripts/fetch-events.mjs ──► data/events.json ──► scripts/build.mjs ──► dist/ ──► GitHub Pages
   (groups,          (reads every feed,             (next 60 days)        (site, .ics feeds,
    feeds)            keeps what is in the                                  JSON-LD)
                      Sunset, merges duplicates)
```

A GitHub Action runs this every morning at about 6 AM Pacific and on every push to `main`.

There are two kinds of source:

1. **Group feeds.** Each group in `data/orgs.json` can list feeds: a public Google Calendar, Luma, Meetup, a Squarespace or WordPress events page, Tockify, Mobilize, or any `.ics` file. Recurring events (weekly markets, monthly meetings) are expanded properly, including skipped dates and moved instances.
2. **Aggregators** in `scripts/lib/aggregators.mjs`: Luma, Eventbrite, Meetup, the San Francisco Public Library, SF Rec & Park, Funcheap, DoTheBay and SF.gov, filtered to the district. Endpoints, headers and field names are in `docs/aggregators.md`.

An event stays if its location falls inside the Sunset: the Inner and Outer Sunset only, an outline in `scripts/lib/geo.mjs` along Lincoln Way, the edge of UCSF Parnassus and Mount Sutro, Lawton St east of 19th Ave, 19th Ave, Taraval St and the beach. Golden Gate Park, Golden Gate Heights and Parkside are outside, and so is any listing whose address names a neighboring neighborhood. Street addresses go to the US Census geocoder, intersections like "Irving & 9th" or "37th Ave between Ortega and Quintara" are placed by a model of the street grid in `scripts/lib/geo.mjs`, and every lookup is cached in `data/geocache.json`. When the same event appears in several places, the group's own calendar wins and the others become "also listed at" links.

It runs on Node 20 or newer with no dependencies and no API keys.

## Run it

```bash
npm run fetch      # read every feed into data/events.json (a minute or two)
npm run dev        # build dist/ and serve it at http://localhost:4321
```

`npm run gate` runs the language gate and the data check. `npm run build` runs both before building and checks every share card after, so copy that breaks the house rules cannot deploy.

## Address, search and share previews

`scripts/build.mjs` writes every canonical link, share image, sitemap entry and calendar link against `SITE_URL`, which defaults to `https://sunset.dearcrisis.com/`. Until that domain is set in the repo's **Settings, Pages, Custom domain** (with a CNAME record for `sunset` pointing at `benvonwong-byte.github.io`), the deploy sets `SITE_URL` to the github.io address so link previews load. Once the domain works, delete the `SITE_URL` line in `.github/workflows/deploy.yml`. `INDEX=1` in the same file lets search engines index the site.

The share cards are drawn by `recap/tools/card.mjs` from `recap/cards/cards.json`: one for Sunset Events (`site/assets/og-events.jpg`), one for Sunset Idle Space (`og-space.jpg`) and one for the recap. `/events/` is the same app as the home page, opened on the event list, so the list has a plain address to share.

## Refreshing from a home connection

Eventbrite and now and then a group site refuse GitHub's servers (HANDOFF.md has the choices once no home computer runs this). When a source fails, the fetcher reuses its still-upcoming events from the last good read for up to 14 days, and the footer says so. To keep those sources current, one Mac reads every feed each morning at 5:40 AM and pushes the result before GitHub's own build:

```bash
scripts/install-home-refresh.sh
```

It installs a launch agent (`com.dearcrisis.sunset-refresh`) that runs `scripts/home-refresh.sh` from its own clone in `~/.sunset-refresh`, commits only the data files, and logs to `/tmp/dc-sunset-refresh.*.log`. The install script prints how to run it at once and how to remove it.

## Add a group

Add an entry to `data/orgs.json`:

```json
{
  "id": "friends-of-sunset-dunes",
  "name": "Friends of Sunset Dunes",
  "url": "https://www.sunsetdunes.org",
  "what": "One plain sentence: what they do.",
  "plugIn": "One plain sentence: how a neighbor shows up.",
  "kind": "nonprofit",
  "domains": ["ocean-parks"],
  "hood": "ocean-beach",
  "address": "Upper Great Highway at Judah",
  "lat": null,
  "lng": null,
  "eventsPage": "https://...",
  "instagram": "https://www.instagram.com/...",
  "feeds": [{ "format": "squarespace", "url": "https://.../events?format=json" }]
}
```

Leave `lat` and `lng` null; `npm run geocode` fills them. `kind`, `domains` and `hood` take the values listed in `scripts/check-data.mjs` and `data/domains.json`.

A feed can also take:

| Option | Use |
|---|---|
| `"scope": "filter"` | For a calendar that covers more than the Sunset: keep only events with a Sunset address |
| `"skip": "regex"` | Drop titles that match |
| `"only": "regex"` | Keep only titles that match (school calendars full of drills and minimum days) |
| `"maxPerDay": 2` | For calendars that list every daily session |
| `"follow": "regex"` | Crawl the links on the page that match and read each one (Cal Academy's NightLife pages) |

Citywide calendars that are not groups in the directory (a nature-events roundup, for example) go in `data/feeds.json` and always run with `"scope": "filter"`. Their events are credited to a directory group when the organizer or venue matches one.

Electoral campaign events (canvassing, phone banks, lit drops, "Yes on" and "No on" anything) are dropped from every source, whichever side they are on. Candidate forums and voter registration stay.

### Finding a group's feed

| Platform | Feed |
|---|---|
| Google Calendar | Find `calendar.google.com/calendar/embed?src=ID` on their events page. The feed is `https://calendar.google.com/calendar/ical/ID/public/basic.ics` |
| Luma | Find `cal-XXXX` in the calendar page source. The feed is `https://api.lu.ma/ics/get?entity=calendar&id=cal-XXXX` |
| Meetup | `https://www.meetup.com/GROUP/events/ical/` |
| Squarespace | The events page plus `?format=json` |
| WordPress (The Events Calendar) | `/events/?ical=1` or `/wp-json/tribe/events/v1/events` |
| Tockify | `https://tockify.com/api/feeds/ics/NAME` |
| Anything with event markup | The page URL with format `jsonld` |
| Mahina (Shopify events app) | `https://mahina.app/app/STORE.myshopify.com` with format `mahina` and `page` set to the store's events page |
| FullCalendar-style JSON | The JSON URL with format `fullcalendar` (add `"naiveLocal": true` if times are local but stamped +00:00) |
| Mobilize | `https://api.mobilize.us/v1/organizations/ID/events` |

## Spaces

`/space/` is the anti-opening hours: a map of storefronts that are closed at the hour a group wants to meet, with an estimate of each one's floor space, so the group can ask the owner to host it while the doors are shut. The time bar (day, time, and a Week view of when the most floor space is closed) stays on screen apart from the list of spaces, and each space opens in its own drawer (a sheet on phones) with when it is closed, when to drop by and ask, a note to copy and send, its weekly hours, a plan of its lot and building, and how the estimate was made. Every time and space has its own link (`#d=4&t=38&s=node/123`).

Storefronts and posted hours come from OpenStreetMap, with hours read from a business's own website where OpenStreetMap has none. Floor space comes from the SF Assessor's roll and DataSF parcels: the building's area divided by its stories, checked against the mapped footprint, less 15% for walls and stairs, and split among the businesses on the lot. Chains, banks and gas stations are left out. The data is built by hand with `tools/space` (its README has the steps) and committed as `site/space/spaces.json`.

Street View photos appear when the repository has a `GOOGLE_MAPS_BROWSER_KEY` secret (see `.env.example`). Without one the page shows the lot plans. Google's first 10,000 Street View images each month are free.

## Buildathon ideas

- **Wire in the rest.** [docs/needs-a-feed.md](docs/needs-a-feed.md) lists every group with no readable calendar. Most post on Instagram or a flyer. Helping each one set up a free public Google Calendar is the highest-value job here.
- **Food pantry days.** The SF-Marin Food Bank's pantry locator answers a POST with each Sunset pantry's next distribution date. A fetcher for it would put pantry days on the calendar.
- **A weekly digest.** Turn the next seven days into an email or a printable one-page flyer for cafes and the library.
- **Merchant corridors.** A view per street: Irving, Judah, Noriega, Taraval.
- **Languages.** A large share of the district reads Chinese first. Translated titles and a Chinese interface.
- **Accessibility and cost.** Mark free events, wheelchair access and kid-friendly events where feeds say so.
- **Better sorting.** A classifier for event categories that beats the keyword list in `scripts/lib/classify.mjs`.

## House rules for copy

Plain words, no em dashes, no hype adjectives. Say what a group does and how to show up, from what its own site says. `scripts/check-voice.mjs` lists the banned words and shapes and runs on every build. Only public contact channels for groups; never personal phone numbers or emails.

## Credits

Map data from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Geocoding by the US Census Bureau and OpenStreetMap Nominatim. Event data belongs to the groups and platforms that publish it; every listing links back to the source.
