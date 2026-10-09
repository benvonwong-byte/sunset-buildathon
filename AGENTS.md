# Working in this repo

The Sunset Calendar (sunset.dearcrisis.com): a static site plus a Node fetcher, no framework, no dependencies. Read README.md first.

## Rules that the build enforces

- `npm run gate` must pass. It runs `scripts/check-voice.mjs` (em dashes, the verb "carry" in any form, stock machine-writing words) over the group blurbs, the page copy, the scripts and the docs, and `scripts/check-data.mjs` over `data/orgs.json`.
- Adding a new prose field to `data/orgs.json`? Add its name to `ORG_FIELDS` in `scripts/check-voice.mjs` in the same commit, or the gate never reads it.
- Adding a feed format? Add a parser in `scripts/lib/parsers.mjs`, then the format name to `FORMATS` in `scripts/check-data.mjs`.

## House voice for anything published

Same rules as dearcrisis.com. Plain words. Open on the substance and stop on the last concrete thing: no framing sentence at the front, no verdict at the back. No metaphors where a literal word exists. No hype adjectives. Write a group's `what` and `plugIn` from what its own site says, and only record links you have actually loaded.

## Data rules

- Public contact channels only. Never a private person's name, phone number or email.
- Only groups with evidence of activity in the last year.
- `data/events.json` and `data/geocache.json` are generated. Do not edit them by hand.
- The fetcher must never fail the build. A broken feed is logged, shown as "did not load" in the footer, and skipped.

## Geography

`scripts/lib/geo.mjs` holds the district box, the neighborhood rules, the landmark table and the street-grid model. Change the constants there and nowhere else; the build publishes them to the page as `data/geo.json`.
