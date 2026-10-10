#!/usr/bin/env python3
"""Find where each place without opening hours might post them.

    python3 find_candidates.py ../../site/space/spaces.json WORK/candidates.json

For every place in spaces.json with no hours, this gathers:
  - every contact tag OpenStreetMap has for it (website, contact:website, url, facebook,
    instagram, phone), read from the OSM API in batches of 100;
  - the matching place in Overture Maps, an open places dataset (overturemaps.org) that
    lists websites and phone numbers for many shops OpenStreetMap has none for. A match
    is the same name (or close to it) within 40 to 150 m. Overture also flags places that
    have closed for good.

The output feeds find_hours.js. Needs: pip install duckdb. Overture is read straight from
its public S3 bucket, only the rows inside the Sunset's box (a few seconds).
"""
import difflib
import json
import math
import os
import re
import sys
import time
import urllib.request

SPACES, OUT = sys.argv[1:3]
RELEASE = os.environ.get("OVERTURE_RELEASE", "2026-09-23.1")
BOX = (-122.520, -122.440, 37.725, 37.772)  # lon min, lon max, lat min, lat max
UA = "SunsetIdleSpace/0.2 (github.com/benvonwong-byte/sunset-buildathon; hours lookup)"

spaces = json.load(open(SPACES))
todo = [r for r in spaces if not r.get("w")]
print(f"{len(todo)} of {len(spaces)} places have no hours")

# 1. OpenStreetMap: every tag, not only the ones the first build kept
tags = {}
for kind in ("node", "way"):
    ids = [r["id"].split("/")[1] for r in todo if r["id"].startswith(kind + "/")]
    for i in range(0, len(ids), 100):
        url = f"https://api.openstreetmap.org/api/0.6/{kind}s.json?{kind}s={','.join(ids[i:i + 100])}"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        for e in json.load(urllib.request.urlopen(req, timeout=60))["elements"]:
            tags[f"{kind}/{e['id']}"] = e.get("tags", {})
        time.sleep(1)
print(f"OpenStreetMap tags for {len(tags)} places")

# 2. Overture Maps places inside the box
import duckdb  # noqa: E402

for k in [k for k in os.environ if k.startswith("AWS_") and k != "AWS_CA_BUNDLE"]:
    os.environ.pop(k)  # the bucket is public; stray credentials make S3 refuse the request
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
proxy = os.environ.get("HTTPS_PROXY", "").replace("http://", "")
if proxy:
    con.execute(f"SET http_proxy='{proxy}'")
if os.environ.get("SSL_CERT_FILE"):
    con.execute(f"SET ca_cert_file='{os.environ['SSL_CERT_FILE']}'")
con.execute("CREATE SECRET anon (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2')")
rows = con.execute(f"""
  SELECT names.primary, websites, socials, phones, operating_status, confidence, ST_X(geometry), ST_Y(geometry)
  FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN {BOX[0]} AND {BOX[1]} AND bbox.ymin BETWEEN {BOX[2]} AND {BOX[3]}
""").fetchall()
overture = [dict(zip(("name", "websites", "socials", "phones", "status", "conf", "lon", "lat"), r)) for r in rows]
print(f"Overture: {len(overture)} places in the box")

STOP = {"the", "inc", "llc", "co", "corp", "sf", "san", "francisco", "of", "and", "restaurant", "cafe", "salon", "store", "shop", "sunset"}


def words(s):
    return [w for w in re.sub(r"[^a-z0-9 ]", " ", (s or "").lower().replace("'", "")).split() if w not in STOP]


def similar(a, b):
    a, b = " ".join(words(a)), " ".join(words(b))
    if not a or not b:
        return 0
    r = difflib.SequenceMatcher(None, a, b).ratio()
    if (len(a) >= 4 and a in b) or (len(b) >= 4 and b in a):
        r = max(r, 0.85)
    return r


def metres(lat1, lon1, lat2, lon2):
    return math.hypot((lat1 - lat2) * 110540, (lon1 - lon2) * 111320 * math.cos(math.radians(37.75)))


out = []
for r in todo:
    t = tags.get(r["id"], {})
    urls = [{"url": t[k], "src": "osm:" + k} for k in ("website", "contact:website", "url", "website:menu") if t.get(k)]
    socials = [t[k] for k in ("contact:facebook", "facebook", "contact:instagram", "instagram") if t.get(k)]
    best = None
    for o in overture:
        d = metres(r["lat"], r["lon"], o["lat"], o["lon"])
        if d > 150:
            continue
        s = similar(r["n"], o["name"])
        if (s >= 0.75 or (s >= 0.6 and d <= 40)) and (not best or s - d / 1000 > best[0]):
            best = (s - d / 1000, o, round(d), round(s, 2))
    match = None
    if best:
        o = best[1]
        match = {"name": o["name"], "metres": best[2], "similarity": best[3], "status": o["status"], "phones": o["phones"]}
        urls += [{"url": w, "src": "overture"} for w in o["websites"] or []]
        socials += o["socials"] or []
    seen, unique = set(), []
    for u in urls:
        key = re.sub(r"^https?://(www\.)?", "", u["url"].strip().lower()).rstrip("/")
        if key not in seen:
            seen.add(key)
            unique.append(u)
    house, street = t.get("addr:housenumber"), t.get("addr:street")
    addr = r.get("a") or (f"{house} {street}" if house and street else "")
    out.append({
        "id": r["id"], "name": r["n"], "type": r["t"], "addr": addr, "lat": r["lat"], "lon": r["lon"],
        "phone": t.get("phone") or t.get("contact:phone") or (match and match["phones"] and match["phones"][0]) or None,
        "urls": unique, "socials": socials, "overture": match,
    })

json.dump(out, open(OUT, "w"), indent=1, ensure_ascii=False)
print(f"wrote {OUT}: {sum(1 for c in out if c['urls'])} places with a website to read "
      f"({sum(1 for c in out if any(u['src'].startswith('osm') for u in c['urls']))} from OpenStreetMap, "
      f"{sum(1 for c in out if any(u['src'] == 'overture' for u in c['urls']))} from Overture); "
      f"{sum(1 for c in out if c['overture'] and c['overture']['status'] not in (None, 'open'))} marked closed by Overture")
