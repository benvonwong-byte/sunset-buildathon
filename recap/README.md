# Event recap kit

The Sunset Neighborhood Build-a-thon recap (9 October 2026) is built from this folder. It is published twice from the same files: at [dearcrisis.com/buildathon](https://dearcrisis.com/buildathon), its canonical home, and at `/recap/` on this site. Everything needed to make the next one lives here: the words, the photo choices, the page template, the share card, and the scripts that turn an event recording and a photo album into the page.

## What is in here

| File | What it holds |
|---|---|
| `content.json` | Every word on the page and every photo choice. The only file to rewrite for a new event. |
| `template.html` | The look: colours, fonts, the line-drawn rowhouses, the photo viewer, the thread filters. No event text. |
| `render.mjs` | Builds the page from the two files above, counts everything that can be counted, and refuses to render if a card points at a missing photo or thread. |
| `cards/cards.json` | The share cards for the recap and both Sunset tools, and the photo panel each one uses. |
| `tools/fetch-icloud.mjs` | Downloads a shared iCloud album in the order the photos were taken. |
| `tools/photos.py` | Contact sheets, captions list, and the web sizes: viewer copy, timeline thumbnail, card crop. |
| `tools/card.mjs` | Draws the 1200x630 share cards. |
| `tools/screenshot.mjs` | Screenshots of anything a team built, for the "Built by 5pm" cards. |
| `../site/recap/` | The published photos (`photos/`), tool screenshots (`tools/`) and share card (`og.jpg`). |

The page itself has six sections: the afternoon as a timeline with the photos from each part, one card per person at the mic, what existed by the end, the threads across all the ideas, dates people announced, and thanks.

## Making a recap, step by step

You need Node 20 or newer, Python 3 with Pillow (`pip install pillow`), and Playwright for the three browser tools (`npm i -g playwright`, or set `PLAYWRIGHT` to its path). Keep a work folder outside the repo for the raw material: the transcript and the full-size photos never go in this repo.

**1. Gather the inputs.** The event page (Luma), the run of show (a photo of the slide is fine), an automatic transcript of the recording, and a shared photo album.

**2. Download the photos.**

```bash
node recap/tools/fetch-icloud.mjs <album link> ~/recap-work
python3 recap/tools/photos.py sheet ~/recap-work
```

The contact sheets number every photo with the time it was taken. Read them next to the transcript: the speaking order, the camera clock and visual anchors (the sign each speaker made, the shirt, the mic) are how a voice gets matched to a face. The album link opens every photo in it, so keep it out of the repo, the page and the docs.

**3. Write `content.json`.** Start from this event's file and replace the words section by section. The rules that held for this one:

- One card per voice, in speaking order. When a name was not caught, give the card a plain descriptive name ("The Gear Swapper", "The Lower Haight Editor") and set `"nameNotCaught": true`; the page then says so. Never guess a name.
- Never guess anyone's pronouns. Use the person's name, or "they".
- Quotes are the speaker's words, lightly cleaned from the transcript and never invented. Leave out side conversations, phone numbers, emails and anything said in confidence.
- Strip the framing sentence at the front and the verdict at the back of every paragraph: open on what the person proposed and stop on the last concrete thing.
- Each dream gets one or two `threads` (from `dreams.threads`) and a `format`: `analog`, `both` or `digital`, for whether it needs a screen. The chips, counts, bars and the screen split are all computed from these.
- Timeline times: `time` is what the run of show planned; `plan` says when the photos show it happened. This one ran about twenty minutes behind.
- Credit what people built by name, with their own links, and only links you have opened.

Text fields are HTML: write `&amp;` for "&" and links as `<a href="..." target="_blank" rel="noopener">`. `{site}` in any field becomes the Sunset site's address.

**4. Caption and crop the photos.**

```bash
python3 recap/tools/photos.py init ~/recap-work     # paste the list into "photos" and write each caption
python3 recap/tools/photos.py build ~/recap-work    # writes site/recap/photos/
```

A photo used on a card needs a `"crop": [x, y, width]`: the centre of the crop as fractions of the photo, and the share of its width to keep (0.5 for a face at the mic). `build` writes `~/recap-work/crops.jpg` with every card crop on one sheet; check that every face is in frame.

**5. Screenshot anything that was built.**

```bash
node recap/tools/screenshot.mjs https://sunset.dearcrisis.com/events/ site/recap/tools/events.jpg
```

**6. Draw the share card. Every time.** WhatsApp, Signal and iMessage show a link's `og:image`, title and description, and a page is not finished without them. Add or edit the entry in `cards/cards.json` (series line, title, dateline, footer, and a 936x1260 photo panel), then:

```bash
node recap/tools/card.mjs
```

The card must stay under 280,000 bytes; the script says if it does not. Write `page.description`, `page.shareTitle`, `page.shareDescription` and `page.shareImageAlt` in `content.json` as one or two plain sentences each. `render.mjs` puts them, the canonical link, geo tags for the venue and JSON-LD (an Article about the Event, with date, place and organizers) in the page head.

**7. Check it.**

```bash
npm run gate                      # house voice over content.json, docs and code
npm run build                     # renders the recap into dist/recap/ and checks every share card
npm run dev                       # then open http://localhost:4321/recap/
```

Look at it on a phone width too. Press each thread chip and watch the cards change.

**8. Edit in a Google Doc, if others want to.**

```bash
node recap/render.mjs doc > ~/recap-work/recap-text.html
```

Upload that file to Google Drive and open it with Google Docs. It has every word on the page in reading order, the share text first. Copy the edits back into `content.json` and render again.

**9. Publish.** A pull request to this repo publishes `/recap/` when it merges. To update the dearcrisis.com copy, in a checkout of the dear-crisis repo next to this one:

```bash
SITE_URL=<the SITE_URL in .github/workflows/deploy.yml> node recap/render.mjs dearcrisis > ../dear-crisis/public/buildathon.html
cp -r site/recap/photos site/recap/tools site/recap/og.jpg ../dear-crisis/public/buildathon/
```

`SITE_URL` sets where the tool links point. Without it they point at sunset.dearcrisis.com.

Then, in dear-crisis, run `npm run gate` and `node scripts/check-page-preview.mjs`, and open a pull request. A new page there also needs its line in `src/app/sitemap.ts`, `src/app/llms.txt/route.ts` and the atlas (`src/data/map/atlas.mjs`); that repo's AGENTS.md has the rules.

## The next event

One recap per copy of this folder. For the next event, copy `recap/` and `site/recap/` to wherever it will live, change `slug` in `content.json` (it names the dearcrisis.com folder), replace the words and the photos, and follow the steps above. `template.html` stays as it is.
