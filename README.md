# Sunset Events

Every public event we can find in San Francisco's Inner and Outer Sunset, plus a directory of the groups and places that hold them. Live at **[sunset.dearcrisis.com](https://sunset.dearcrisis.com)**, a [Dear Crisis](https://www.dearcrisis.com) project, and the starting point for a Sunset buildathon.

The page has two views over the same data.

**Events** is a threaded list on the left, one line per event, grouped by day the way dearcrisis.com/events reads. Click a line and its details open in place. On the right, a month calendar and a map stay pinned while you scroll and follow the day you are reading: the calendar marks it, and the map shows that day's events. Hover a line and its pin lifts; click a pin and its line opens; click a calendar day and the list jumps there. On a phone the calendar becomes a swipeable date strip and the map opens full screen from a button.

**Groups** is the directory beside the same map: what each group does, where it is, how to show up, and whether we can read its calendar.

Filters for kind of event, neighborhood, day and text apply to both, and every state is a shareable link (`#event=...`, `#view=groups`, `#org=...`).

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

An event stays if its location falls inside the Sunset: an outline in `scripts/lib/geo.mjs` that runs along JFK Drive (so the south half of Golden Gate Park), Stanyan St, UCSF Parnassus and Mount Sutro, the edge of Golden Gate Heights, Sloat Blvd (with the Zoo), and the beach. Street addresses go to the US Census geocoder, intersections like "Irving & 9th" or "37th Ave between Ortega and Quintara" are placed by a model of the street grid in `scripts/lib/geo.mjs`, and every lookup is cached in `data/geocache.json`. When the same event appears in several places, the group's own calendar wins and the others become "also listed at" links.

It runs on Node 20 or newer with no dependencies and no API keys.

## Run it

```bash
npm run fetch      # read every feed into data/events.json (a minute or two)
npm run dev        # build dist/ and serve it at http://localhost:4321
```

`npm run gate` runs the language gate and the data check. `npm run build` runs both before building, so copy that breaks the house rules cannot deploy.

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
