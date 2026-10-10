#!/usr/bin/env python3
"""Look for a website for places neither OpenStreetMap nor Overture has one for.

    python3 search_sites.py WORK/candidates.json WORK/candidates_search.json

For each place with no website, asks DuckDuckGo's HTML search (html.duckduckgo.com, whose
robots.txt allows it) for "name" + street address + San Francisco, one query every five
seconds. A result is kept only when its domain contains the place's distinctive name
words (two of them when the name has two or more), so directories, review sites and
same-named places elsewhere fall away. find_hours.js then reads the kept sites and applies
nothing unless the site shows this place's address or phone number.
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

SRC, OUT = sys.argv[1:3]
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
GENERIC = {"the", "inc", "llc", "corp", "and", "san", "francisco", "sunset", "restaurant", "cafe", "salon", "shop",
           "store", "market", "services", "service", "company", "center", "studio", "group", "house", "food"}


def tokens(name):
    words = re.sub(r"[^a-z0-9 ]", " ", name.lower().replace("'", "").replace("&", " ")).split()
    return [w for w in words if len(w) >= 4 and w not in GENERIC]


def search(q):
    req = urllib.request.Request("https://html.duckduckgo.com/html/", data=urllib.parse.urlencode({"q": q}).encode(),
                                 headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"})
    page = urllib.request.urlopen(req, timeout=30).read().decode("utf8", "replace")
    out = []
    for href in re.findall(r'class="result__a" href="([^"]+)"', page):
        href = html.unescape(href)
        m = re.search(r"uddg=([^&]+)", href)
        out.append(urllib.parse.unquote(m.group(1)) if m else href)
    return out


cands = json.load(open(SRC))
todo = [c for c in cands if not c["urls"]]
found = []
for i, c in enumerate(todo, 1):
    toks = tokens(c["name"])
    if not toks:
        continue
    need = 2 if len(toks) >= 2 else 1
    try:
        results = search(f'"{c["name"]}" {c["addr"]} San Francisco'.replace("  ", " "))
    except Exception as e:  # rate limited or offline: stop rather than hammer
        print(f"search stopped at {i}: {e}")
        break
    keep = []
    for u in results:
        host = re.sub(r"^www\.", "", urllib.parse.urlparse(u).hostname or "")
        flat = host.split(".")[0].replace("-", "")
        if re.search(r"(^|\.)(wheree|mapcarta|cylex|yelp|yellowpages|chamberofcommerce|manta)\.", host):
            continue  # directory pages, not the business's own site
        if sum(1 for t in toks if t in flat) >= need and not any(k["url"].startswith(f"https://{host}") for k in keep):
            keep.append({"url": u, "src": "search"})
    if keep:
        found.append({**c, "urls": keep[:2]})
    print(f"[{i}/{len(todo)}] {c['name']}: {', '.join(k['url'] for k in keep[:2]) or '-'}")
    time.sleep(5)

json.dump(found, open(OUT, "w"), indent=1, ensure_ascii=False)
print(f"wrote {OUT}: a website for {len(found)} of {len(todo)} places that had none")
