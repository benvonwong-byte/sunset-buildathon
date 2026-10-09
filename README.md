# The Sunset Calendar

Every public event we can find in San Francisco's Inner and Outer Sunset, plus a directory of the groups and places behind them. Live at **[sunset.dearcrisis.com](https://sunset.dearcrisis.com)**, a [Dear Crisis](https://www.dearcrisis.com) project, and the starting point for a Sunset buildathon.

The site has four views over the same data:

| View | What it shows |
|---|---|
| Agenda | Upcoming events by day, with filters for day, kind of event and neighborhood |
| Calendar | A month grid; tap a day to list it |
| Map | Events and groups on a map of the district |
| Groups | The directory: what each group does, how to show up, and whether we can read its calendar |

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
2. **Aggregators** in `scripts/lib/aggregators.mjs`: Luma, Eventbrite, Meetup, the San Francisco Public Library and others, filtered to the district by coordinates.

An event stays if its location falls inside the Sunset: Lincoln Way to Sloat, Stanyan to the ocean, plus the south half of Golden Gate Park, Stern Grove and the Zoo. Street addresses go to the US Census geocoder, intersections like "Irving & 9th" or "37th Ave between Ortega and Quintara" are placed by a model of the street grid in `scripts/lib/geo.mjs`, and every lookup is cached in `data/geocache.json`. When the same event appears in several places, the group's own calendar wins and the others become "also listed at" links.

No API keys. No dependencies. Node 20 or newer.

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

A feed can also take `"scope": "filter"` (for a citywide calendar: keep only events with a Sunset address), `"skip": "regex"` (drop titles that match), and `"maxPerDay": 1` (for calendars that list every daily session).

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

## Buildathon ideas

- **Wire in the rest.** The Groups view counts the groups with no readable calendar. Most post on Instagram or a flyer. Helping each one set up a free public Google Calendar is the highest-value job here.
- **A weekly digest.** Turn the next seven days into an email or a printable one-page flyer for cafes and the library.
- **Merchant corridors.** A view per street: Irving, Judah, Noriega, Taraval.
- **Languages.** A large share of the district reads Chinese first. Translated titles and a Chinese interface.
- **Accessibility and cost.** Mark free events, wheelchair access and kid-friendly events where feeds say so.
- **Better sorting.** A classifier for event categories that beats the keyword list in `scripts/lib/classify.mjs`.

## House rules for copy

Plain words. No em dashes. Never the verb "carry". No hype adjectives. Say what a group does and how to show up, from what its own site says. `scripts/check-voice.mjs` enforces the mechanical part on every build. Only public contact channels for groups; never personal phone numbers or emails.

## Credits

Map data from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Geocoding by the US Census Bureau and OpenStreetMap Nominatim. Event data belongs to the groups and platforms that publish it; every listing links back to the source.
