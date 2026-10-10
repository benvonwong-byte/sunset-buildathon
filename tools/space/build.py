"""Join OSM storefronts with SF parcels, assessor roll, building footprints and business registry."""
import difflib
import json
import math
import re
import os
import subprocess
import sys
from collections import Counter, defaultdict

from shapely.geometry import Point, Polygon, shape
from shapely.strtree import STRtree

S = sys.argv[1]
osm = json.load(open(f"{S}/work/osm.json"))
parcels_raw = json.load(open(f"{S}/dl/parcels.json"))
assessor = {r["parcel_number"]: r for r in json.load(open(f"{S}/dl/assessor.json"))}
biz = json.load(open(f"{S}/dl/biz.json"))

LAT0 = 37.75
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110540
SQFT = 10.7639


def m_dist(a, b):
    return math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY)


def area_sqft(poly):
    xs = [(x * KX, y * KY) for x, y in poly.exterior.coords]
    return abs(Polygon(xs).area) * SQFT


# ---------------------------------------------------------------- categories
EXCLUDE = {"school", "fire_station", "library", "post_office", "police", "townhall", "hospital",
           "university", "college", "taxi", "motel", "hotel", "hostel", "guest_house",
           "educational_institution", "social_facility", "courthouse", "ranger_station",
           "prison", "grave_yard", "marketplace", "car_rental", "ferry_terminal", "government",
           "camp_site", "caravan_site", "apartment", "museum", "zoo", "aquarium", "events_venue"}
FOOD = {"restaurant", "cafe", "fast_food", "bar", "pub", "bakery", "ice_cream", "deli",
        "bubble_tea", "food_court", "biergarten", "confectionery", "pastry", "coffee", "tea",
        "wine", "alcohol", "beverages", "butcher", "seafood", "greengrocer", "supermarket",
        "convenience", "cheese", "chocolate", "nightclub", "brewery", "winery"}
PERSONAL = {"beauty", "hairdresser", "massage", "laundry", "dry_cleaning", "tattoo", "nail_salon",
            "tailor", "shoemaker", "cosmetics", "spa", "piercing", "sauna", "tanning", "barber"}
HEALTH = {"dentist", "clinic", "doctors", "optician", "physiotherapist", "veterinary", "pharmacy",
          "alternative", "herbalist", "chiropractor", "psychotherapist", "medical_supply",
          "hearing_aids", "chemist", "counselling", "acupuncture", "podiatrist", "nutrition_supplements"}
OFFICE_AMEN = {"bank", "bureau_de_change", "money_transfer", "estate_agent", "coworking_space",
               "lawyer", "insurance", "tax_advisor", "accountant", "travel_agency", "employment_agency"}
ACTIVE = {"fitness_centre", "dance", "music_school", "language_school", "training", "prep_school",
          "sports_centre", "gallery", "theatre", "art", "pottery", "studio", "arts_centre",
          "yoga", "dojo", "driving_school", "cinema", "fitness_station", "sports_hall", "escape_game",
          "amusement_arcade", "bowling_alley", "music_venue", "photo", "photographer", "craft",
          "games", "hackerspace", "climbing", "tutoring"}
AUTO = {"car_repair", "fuel", "car_wash", "tyres", "car", "car_parts", "motorcycle", "vehicle_inspection"}
COMMUNITY = {"place_of_worship", "community_centre", "social_centre", "childcare", "kindergarten",
             "nursing_home", "association", "club", "religion"}


def category(p):
    k, t = p["key"], p["type"]
    if t in EXCLUDE:
        return None
    if t in FOOD:
        return "food"
    if t in PERSONAL:
        return "personal"
    if t in HEALTH or k == "healthcare":
        return "health"
    if t in AUTO:
        return "auto"
    if t in COMMUNITY:
        return "community"
    if t in ACTIVE or k in ("craft", "leisure"):
        return "active"
    if t in OFFICE_AMEN or k == "office":
        return "office"
    if k == "shop":
        return "retail"
    if k == "amenity":
        return "other"
    return "other"


# ---------------------------------------------------------------- address normalisation
SUFFIX = {"street": "st", "avenue": "ave", "boulevard": "blvd", "drive": "dr", "way": "way",
          "terrace": "ter", "place": "pl", "court": "ct", "lane": "ln", "road": "rd", "alley": "aly",
          "highway": "hwy", "plaza": "plz", "circle": "cir"}
ORD = {"first": "1st", "second": "2nd", "third": "3rd", "fourth": "4th", "fifth": "5th",
       "sixth": "6th", "seventh": "7th", "eighth": "8th", "ninth": "9th", "tenth": "10th"}


def norm_street(s):
    s = s.lower().replace(".", "").strip()
    toks = s.split()
    toks = [ORD.get(t, t) for t in toks]
    if toks and toks[-1] in SUFFIX:
        toks[-1] = SUFFIX[toks[-1]]
    if toks and toks[-1] in SUFFIX.values():
        toks = toks[:-1]
    toks = [re.sub(r"^0+(\d)", r"\1", t) for t in toks]
    return " ".join(toks)


def parse_addr(s):
    m = re.match(r"^\s*(\d+)[A-Za-z]?(?:-\d+)?\s+(.+?)(?:\s*(?:#|apt|ste|suite|unit).*)?$", s or "", re.I)
    if not m:
        return None
    return int(m.group(1)), norm_street(m.group(2))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# ---------------------------------------------------------------- parcels
parcel_geoms, parcel_rows = [], []
by_street = defaultdict(list)
for r in parcels_raw:
    g = shape(r["shape"])
    parcel_geoms.append(g)
    parcel_rows.append(r)
    if r.get("street_name") and r.get("from_address_num"):
        try:
            lo, hi = int(r["from_address_num"]), int(r.get("to_address_num") or r["from_address_num"])
        except ValueError:
            continue
        by_street[norm_street(r["street_name"])].append((min(lo, hi), max(lo, hi), len(parcel_rows) - 1))
ptree = STRtree(parcel_geoms)

COMMERCIAL_USES = ("Commercial", "Flat & Store", "Apartment  & Commercial Store", "Industrial")


def is_commercial(a):
    if not a:
        return False
    return a["use_definition"].startswith("Commercial") or "Store" in a["property_class_code_definition"] \
        or a["use_definition"] == "Industrial"


def parcel_for(lon, lat, addr=None):
    cands = []
    pt = Point(lon, lat)
    for i in ptree.query(pt):
        if parcel_geoms[i].contains(pt):
            cands.append(i)
    if addr:
        num, st = addr
        for lo, hi, i in by_street.get(st, []):
            if lo <= num <= hi and (num - lo) % 2 == 0 and m_dist(
                    (parcel_geoms[i].centroid.x, parcel_geoms[i].centroid.y), (lon, lat)) < 150:
                cands.append(i)
    if not cands:
        idx = ptree.nearest(pt)
        if idx is not None and parcel_geoms[idx].distance(pt) * KX < 12:
            cands.append(idx)
    if not cands:
        return None
    # prefer a parcel with commercial assessor data, then any assessor data
    def score(i):
        a = assessor.get(parcel_rows[i]["blklot"])
        return (2 if is_commercial(a) else 1 if a else 0)
    return max(cands, key=score)


# ---------------------------------------------------------------- buildings
bpolys, bmeta = [], []
for b in osm["buildings"]:
    try:
        poly = Polygon(b["coords"])
        if not poly.is_valid:
            poly = poly.buffer(0)
    except Exception:
        continue
    bpolys.append(poly)
    bmeta.append(b)
btree = STRtree(bpolys)


def building_for(lon, lat):
    pt = Point(lon, lat)
    hits = [i for i in btree.query(pt) if bpolys[i].contains(pt)]
    if not hits:
        i = btree.nearest(pt)
        if i is not None and bpolys[i].distance(pt) * KX < 8:
            hits = [i]
    if not hits:
        return None
    return min(hits, key=lambda i: bpolys[i].area)


# ---------------------------------------------------------------- registry index
reg = []
for b in biz:
    loc = b.get("location")
    if not loc:
        continue
    lon, lat = loc["coordinates"]
    reg.append({**b, "lon": lon, "lat": lat, "addr": parse_addr(b.get("full_business_address", ""))})
reg_by_addr = defaultdict(list)
for r in reg:
    if r["addr"]:
        reg_by_addr[r["addr"]].append(r)

STOP = {"the", "and", "&", "of", "inc", "llc", "co", "corp", "sf", "san", "francisco", "cafe", "restaurant"}


def name_tokens(s):
    return {t for t in re.findall(r"[a-z0-9]+", (s or "").lower()) if t not in STOP and len(t) > 1}


def registry_match(p, addr):
    best, best_s = None, 0.0
    nm = p["name"].lower()
    nt = name_tokens(p["name"])
    pool = list(reg_by_addr.get(addr, [])) if addr else []
    pool += [r for r in reg if abs(r["lat"] - p["lat"]) < 0.0006 and abs(r["lon"] - p["lon"]) < 0.0008]
    for r in pool:
        dn = (r.get("dba_name") or "").lower()
        s = difflib.SequenceMatcher(None, nm, dn).ratio()
        if nt and nt & name_tokens(dn):
            s = max(s, 0.7)
        if addr and r["addr"] == addr:
            s += 0.15
        if s > best_s:
            best, best_s = r, s
    return best if best_s >= 0.7 else None


# ---------------------------------------------------------------- assemble
pois = []
for p in osm["pois"]:
    cat = category(p)
    if not cat:
        continue
    addr = None
    if p.get("addr:housenumber") and p.get("addr:street"):
        addr = parse_addr(f'{p["addr:housenumber"]} {p["addr:street"]}')
    pi = parcel_for(p["lon"], p["lat"], addr)
    bi = building_for(p["lon"], p["lat"])
    rm = registry_match(p, addr)
    pois.append({"p": p, "cat": cat, "addr": addr, "pi": pi, "bi": bi, "reg": rm})

# Registered businesses on commercial parcels that OSM doesn't know about (hours unknown)
STOREFRONT_NAICS = ("44", "45", "72", "81", "62", "71", "61", "52", "53", "54")
SKIP_NAICS_PREFIX = ("5311", "5312", "5313", "531")  # landlords / property managers
osm_addrs = {x["addr"] for x in pois if x["addr"]}
osm_reg = {x["reg"]["ttxid"] for x in pois if x["reg"]}
extra = []
seen_extra = set()
for r in reg:
    n = (r.get("self_reported_naics_code") or "")
    if r["ttxid"] in osm_reg or not n.startswith(STOREFRONT_NAICS) or n.startswith(SKIP_NAICS_PREFIX):
        continue
    if not r["addr"] or r["addr"] in osm_addrs:
        continue
    pi = parcel_for(r["lon"], r["lat"], r["addr"])
    if pi is None:
        continue
    a = assessor.get(parcel_rows[pi]["blklot"])
    z = (parcel_rows[pi].get("zoning_code") or "")
    if not is_commercial(a) or not z.startswith("NC"):
        continue
    upstairs = re.search(r"(#|\bapt\b|\bunit\b|\bste\b|suite|\bpmb\b)", r.get("full_business_address", ""), re.I)
    mixed = num(a["number_of_units"]) > 0
    if re.search(r"\bpmb\b|p\.?o\.? box", r.get("full_business_address", ""), re.I):
        continue  # private mailbox, not a premises
    if mixed and (upstairs or n.startswith(("52", "53", "54"))):
        continue  # likely a home office in an apartment above the shop
    key = r["addr"]
    if key in seen_extra:
        continue
    seen_extra.add(key)
    extra.append(r)

print("osm pois kept", len(pois), "| registry-only storefronts", len(extra))

# businesses per parcel / per building (for splitting floor area)
ground_per_parcel = Counter()
per_building = Counter()
for x in pois:
    if x["pi"] is not None:
        ground_per_parcel[x["pi"]] += 1
    if x["bi"] is not None:
        per_building[x["bi"]] += 1
extra_rows = []
for r in extra:
    pi = parcel_for(r["lon"], r["lat"], r["addr"])
    bi = building_for(r["lon"], r["lat"])
    ground_per_parcel[pi] += 1
    if bi is not None:
        per_building[bi] += 1
    extra_rows.append({"r": r, "pi": pi, "bi": bi})


BIG_TYPES = {"supermarket", "place_of_worship", "nursing_home", "theatre", "sports_centre",
             "fitness_centre", "community_centre", "hardware", "department_store", "garden_centre",
             "registered business", "doityourself", "furniture", "social_centre", "club", "cinema"}


FT = 3.28084


def biggest(g):
    return max(g.geoms, key=lambda q: q.area) if g.geom_type == "MultiPolygon" else g


def ring_ft(poly, ox, oy, tol_ft=1.5):
    poly = biggest(poly).simplify(tol_ft / FT / 111000)
    return [[round((x - ox) * KX * FT), round((y - oy) * KY * FT)] for x, y in poly.exterior.coords[:-1]]


def plan_for(pi, bi, lon, lat):
    """Lot outline, building footprint and storefront position, in feet (x east, y north)."""
    b = bpolys[bi] if bi is not None else None
    lot = biggest(parcel_geoms[pi]) if pi is not None else None
    if b is not None and not b.is_valid:
        b = b.buffer(0)
    ref = b if b is not None else lot
    if ref is None:
        return None
    c = ref.centroid
    plan = {"p": [round((lon - c.x) * KX * FT), round((lat - c.y) * KY * FT)]}
    if lot is not None:
        plan["l"] = ring_ft(lot, c.x, c.y)
    if b is not None:
        plan["b"] = ring_ft(b, c.x, c.y)
        rr = b.minimum_rotated_rectangle
        pts = list(rr.exterior.coords)
        e1 = math.hypot((pts[1][0] - pts[0][0]) * KX, (pts[1][1] - pts[0][1]) * KY) * FT
        e2 = math.hypot((pts[2][0] - pts[1][0]) * KX, (pts[2][1] - pts[1][1]) * KY) * FT
        plan["d"] = [round(min(e1, e2)), round(max(e1, e2))]
    return plan


def sqft_info(pi, bi, ptype, lon=None, lat=None):
    info = {}
    if lon is not None:
        pl = plan_for(pi, bi, lon, lat)
        if pl:
            info["plan"] = pl
    a = assessor.get(parcel_rows[pi]["blklot"]) if pi is not None else None
    if pi is not None:
        pr = parcel_rows[pi]
        info["zone"] = pr.get("zoning_code")
    if a:
        info["bldg"] = round(num(a["property_area"]))
        info["stories"] = int(num(a["number_of_stories"]))
        info["units"] = int(num(a["number_of_units"]))
        info["lot"] = round(num(a["lot_area"]))
        info["use"] = a["property_class_code_definition"]
        info["built"] = a.get("year_property_built")
        info["apn"] = a["parcel_number"]
    if bi is not None:
        info["fp"] = round(area_sqft(bpolys[bi]))
    # estimate the ground-floor commercial area, then split among businesses there
    n = max(1, ground_per_parcel.get(pi, 1) if pi is not None else per_building.get(bi, 1))
    ground = None
    method = None
    if a and info["bldg"] > 0:
        stories = info["stories"] or (2 if info["units"] > 0 else 1)
        ground = info["bldg"] / stories
        method = "assessor"
        if info.get("fp") and info["fp"] < ground * 0.6:
            # assessor area may include several buildings / condos: trust the footprint
            ground = info["fp"]
            method = "footprint"
    elif info.get("fp"):
        ground = info["fp"]
        n = max(1, per_building.get(bi, 1))
        method = "footprint"
    if ground:
        info["ground"] = int(round(ground, -1))
        info["share"] = n
        info["method"] = method
        per = ground * 0.85 / n  # ~15% for walls, stairs, entries
        if per > 6000 and ptype not in BIG_TYPES:
            info["conf"] = "unknown"  # one known tenant in a big building: share unknown
        else:
            info["est"] = int(round(per, -1))
            agree = info.get("fp") and method == "assessor" and 0.6 <= info["fp"] / max(ground, 1) <= 1.6
            info["conf"] = "good" if agree and n <= 2 else "rough"
    return info


# ---------------------------------------------------------------- hours
hours_in = [{"id": x["p"]["osm"], "oh": x["p"]["opening_hours"]} for x in pois if x["p"].get("opening_hours")]
json.dump(hours_in, open(f"{S}/work/hours_in.json", "w"))
subprocess.run(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "eval_hours.js"), f"{S}/work/hours_in.json", f"{S}/work/hours_out.json"], check=True)
hours = json.load(open(f"{S}/work/hours_out.json"))

records = []
for x in pois:
    p = x["p"]
    info = sqft_info(x["pi"], x["bi"], p["type"], p["lon"], p["lat"])
    h = hours.get(p["osm"], {})
    street = " ".join(filter(None, [p.get("addr:housenumber"), p.get("addr:street")]))
    if not street and x["reg"]:
        street = x["reg"]["full_business_address"]
    if re.search(r"Gov|Public Use|FIRE STATION|POLICE", info.get("use") or ""):
        continue
    rec = {
        "id": p["osm"], "n": p["name"], "c": x["cat"], "t": p["type"].replace("_", " "),
        "lat": p["lat"], "lon": p["lon"], "h": "i" if p["hood"] == "Inner Sunset" else "o",
        "a": street, **info,
    }
    if p.get("brand"):
        rec["chain"] = 1
    if p.get("opening_hours"):
        rec["oh"] = h.get("pretty") or p["opening_hours"]
        if h.get("week"):
            rec["w"] = h["week"]
    if x["reg"]:
        rec["reg"] = (x["reg"].get("location_start_date") or x["reg"].get("dba_start_date") or "")[:4]
    if p.get("website") or p.get("contact:website"):
        rec["web"] = p.get("website") or p.get("contact:website")
    records.append(rec)

NAICS_CAT = {"44": "retail", "45": "retail", "72": "food", "81": "personal", "62": "health",
             "71": "active", "61": "active", "52": "office", "53": "office", "54": "office"}
for e in extra_rows:
    r = e["r"]
    info = sqft_info(e["pi"], e["bi"], "registered business", r["lon"], r["lat"])
    n = r["self_reported_naics_code"]
    cat = NAICS_CAT.get(n[:2], "other")
    if n.startswith("722"):
        cat = "food"
    if n.startswith(("4451", "4452", "4453")):
        cat = "food"
    records.append({
        "id": "reg/" + r["ttxid"], "n": (r.get("dba_name") or r.get("ownership_name") or "").strip(),
        "c": cat, "t": "registered business", "lat": round(r["lat"], 6), "lon": round(r["lon"], 6),
        "h": "i" if r["neighborhoods_analysis_boundaries"] == "Inner Sunset" else "o",
        "a": r["full_business_address"], "reg": (r.get("location_start_date") or "")[:4], **info,
    })

json.dump(records, open(f"{S}/work/records.json", "w"), separators=(",", ":"))

# ---------------------------------------------------------------- report
print("records", len(records))
print("with hours", sum(1 for r in records if "w" in r), "| oh string but unparsed",
      sum(1 for r in records if "oh" in r and "w" not in r))
print("with sqft est", sum(1 for r in records if "est" in r))
print("methods", Counter(r.get("method") for r in records)); print("conf", Counter(r.get("conf") for r in records))
print("cats", Counter(r["c"] for r in records))
print("hood", Counter(r["h"] for r in records))
print("registry matched (osm)", sum(1 for r in records if r.get("reg") and not r["id"].startswith("reg/")))
ests = sorted(r["est"] for r in records if "est" in r)
print("est quantiles", [ests[int(len(ests) * q)] for q in (0.05, 0.25, 0.5, 0.75, 0.95)], "max", ests[-1])
for r in sorted(records, key=lambda r: -r.get("est", 0))[:15]:
    print(r["n"], r["t"], r["a"], r.get("est"), r.get("bldg"), r.get("stories"), r.get("units"), r.get("fp"), r.get("share"), r.get("use"))
print("---- sample")
import random
random.seed(4)
for r in random.sample(records, 15):
    print(r["n"], "|", r["t"], "|", r["a"], "| est", r.get("est"), "| bldg", r.get("bldg"), r.get("stories"), r.get("units"), "| fp", r.get("fp"), "| share", r.get("share"), r.get("method"), "|", r.get("use"), "|", r.get("oh"))
