# Handing over Sunset Events

Sunset Events ([/events/](https://benvonwong-byte.github.io/sunset-buildathon/events/)) rebuilds itself every morning on GitHub's servers. Nobody's laptop has to stay on, and there is no server to rent: GitHub Actions reads the feeds and GitHub Pages serves the site, both free for a public repository. A laptop only ever covered Eventbrite, which refuses GitHub's servers, and the steps below say what to do about it.

## What runs, and where

`.github/workflows/deploy.yml` ("Refresh listings and deploy") runs every day at 13:17 UTC (6:17 AM Pacific in summer, 5:17 AM in winter), on every push to `main`, and by hand from the Actions tab. Each run:

1. runs the language gate and the data check (`npm run gate`);
2. places new groups on the map (`scripts/geocode-orgs.mjs`);
3. reads every feed (`scripts/fetch-events.mjs`) and keeps the next 60 days of events inside the district;
4. rewrites `docs/needs-a-feed.md`, the list of groups with no readable calendar;
5. builds the site into `dist/` and checks every share card and search tag;
6. on the daily and manual runs only, commits the refreshed data files with the message "data: listings for YYYY-MM-DD";
7. publishes `dist/` to GitHub Pages.

A run takes about two minutes. A feed that breaks never stops it: the source is logged, shown as "did not load" in the site's footer, and skipped.

## The source that needs a home connection

Eventbrite refuses requests from data centers, so GitHub's daily run gets nothing from it. On 10 October 2026 it had 48 of the 433 listings. The San Fran Dhammaram Temple (Wat San Fran) site failed on one of that day's two GitHub runs and loaded on the other. Every other source loads from GitHub's servers.

Von's Mac read every source each morning at 5:40 AM (`scripts/home-refresh.sh`, installed by `scripts/install-home-refresh.sh`) and pushed the result before GitHub's run. When that stops, the daily run keeps showing a failed source's still-upcoming events for 14 days after its last good read, then drops them, and the footer lists the source as not loaded. Every other source keeps updating.

There are three choices:

1. **Let Eventbrite go.** No work. About a tenth of the listings fade out over the two weeks after the last home read.
2. **Run the refresh on any computer that stays on at a home or office connection**: a Mac mini, an old laptop, a Raspberry Pi, a desktop at a community space. It needs Node 20 or newer, git, and permission to push to this repo.
   - On a Mac: clone the repo, sign git in to GitHub as someone with write access, then run `scripts/install-home-refresh.sh`. It installs a launch agent that runs at 5:40 AM and logs to `/tmp/dc-sunset-refresh.*.log`.
   - On Linux or a Raspberry Pi: install `zsh` (the script uses it), clone the repo, sign git in, and add one line to `crontab -e`: `40 5 * * * /bin/zsh /path/to/sunset-buildathon/scripts/home-refresh.sh >> /tmp/dc-sunset-refresh.log 2>&1`.
   - For the sign-in, a [fine-grained personal access token](https://github.com/settings/personal-access-tokens) limited to this one repository with "Contents: Read and write" is enough. Use it as the password when git asks.
3. **A hosting company** (Vercel, Netlify, Render, Cloudflare) does not solve this. Their servers are in data centers like GitHub's, so expect Eventbrite to refuse them too, and the site itself is already hosted for free. Test a single fetch from one before paying for anything.

## Handover checklist

Do these before Von's laptop stops refreshing.

1. **Give the new steward access.** The simplest way: Settings, Collaborators, add them with the Admin role. Nothing else changes. To move the repo to them for good instead, use Settings, General, Transfer ownership. GitHub then redirects github.com links and git remotes to the new address, but not the github.io address, so set `SITE_URL` in `deploy.yml` to the new github.io address (or set the custom domain, step 5). Repository secrets move with it.
2. **Make sure failure emails reach them.** GitHub emails a failed daily run only to the person who created the workflow, or the last person who changed its `cron:` line. The new steward should change the minute in the `cron:` line of `.github/workflows/deploy.yml` (for example `17` to `19`) and push it, so the emails come to them.
3. **Confirm it runs.** The Actions tab should show a green "Refresh listings and deploy" run every morning, and Settings, Pages should show "GitHub Actions" as the source.
4. **Know the 60-day rule.** GitHub pauses scheduled workflows in a public repository after 60 days with no repository activity. To restart it: Actions, "Refresh listings and deploy", Enable workflow. Any push also counts as activity.
5. **Set the custom domain** (optional): Settings, Pages, Custom domain, `sunset.dearcrisis.com`, then delete the `SITE_URL` line in `.github/workflows/deploy.yml`. The README has the details.
6. **Decide on Eventbrite** (the section above), and if someone takes over the home refresh, have them install it before Von removes the laptop job.
7. **Von removes the laptop job** with:

   ```bash
   launchctl bootout gui/$(id -u)/com.dearcrisis.sunset-refresh
   rm ~/Library/LaunchAgents/com.dearcrisis.sunset-refresh.plist
   rm -rf ~/.sunset-refresh
   ```

## Day to day

- **A feed stops loading.** The footer names it, and the run's log has a line starting `fetch-events:` with the reason. Most fixes are a new feed address in `data/orgs.json`; the README has a table for finding each platform's feed.
- **A group asks to be listed.** The "Add a group" button opens a GitHub issue form. Add the entry to `data/orgs.json` as the README describes; the next run places it on the map.
- **Groups with no calendar we can read** are listed in `docs/needs-a-feed.md`, rebuilt every day. Helping one set up a free public Google Calendar adds every event they post from then on.
- **Sunset Idle Space** (`/space/`) is rebuilt by hand every month or two with `tools/space` (its README has the steps). Nothing runs on a schedule there.
- **The Build-a-thon recap** does not change unless someone edits it; `recap/README.md` covers it.

## Cost

Nothing, as long as the repository stays public: Actions minutes and Pages are free for public repositories. The optional `GOOGLE_MAPS_BROWSER_KEY` secret turns on Street View photos on `/space/`; Google's first 10,000 Street View images each month are free.

## Turning it off

Actions, "Refresh listings and deploy", the "..." menu, Disable workflow stops the daily refresh and leaves the last version online. Settings, Pages, Unpublish takes the site down.
