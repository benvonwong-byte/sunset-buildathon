"""Extract named storefront POIs and building footprints for the Sunset from an OSM .pbf."""
import json
import sys

import osmium
from shapely.geometry import Point, Polygon, shape
from shapely.ops import unary_union
from shapely.prepared import prep

pbf, nhoods_path, out_path = sys.argv[1:4]

nh = json.load(open(nhoods_path))
areas = {f["properties"]["nhood"]: shape(f["geometry"]) for f in nh["features"]}
union = unary_union(list(areas.values()))
prepared = {k: prep(v) for k, v in areas.items()}
minx, miny, maxx, maxy = union.bounds
pad = 0.002
bbox = (minx - pad, miny - pad, maxx + pad, maxy + pad)

POI_KEYS = ("shop", "amenity", "office", "craft", "healthcare", "leisure", "tourism")
SKIP_AMENITY = {
    "parking", "bench", "waste_basket", "bicycle_parking", "post_box", "drinking_water",
    "parking_entrance", "toilets", "recycling", "vending_machine", "fire_hydrant",
    "telephone", "charging_station", "parking_space", "shelter", "bus_station",
    "fountain", "clock", "atm", "waste_disposal", "motorcycle_parking", "car_sharing",
    "bicycle_rental", "public_bookcase", "letter_box", "grit_bin", "loading_dock",
}
SKIP_LEISURE = {"park", "playground", "pitch", "garden", "track", "picnic_table", "golf_course",
                "nature_reserve", "dog_park", "swimming_pool", "common", "stadium", "slipway"}
SKIP_TOURISM = {"artwork", "viewpoint", "information", "picnic_site", "attraction"}


def inside(lon, lat):
    if not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
        return None
    p = Point(lon, lat)
    for k, g in prepared.items():
        if g.contains(p):
            return k
    return None


def poi_kind(tags):
    for k in POI_KEYS:
        v = tags.get(k)
        if not v or v == "no":
            continue
        if k == "amenity" and v in SKIP_AMENITY:
            continue
        if k == "leisure" and v in SKIP_LEISURE:
            continue
        if k == "tourism" and v in SKIP_TOURISM:
            continue
        return k, v
    return None


KEEP_TAGS = ("name", "opening_hours", "addr:housenumber", "addr:street", "addr:unit",
             "website", "phone", "contact:website", "contact:phone", "cuisine",
             "check_date:opening_hours", "check_date", "survey:date", "disused:shop",
             "level", "brand")


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.pois = []
        self.buildings = []

    def _poi(self, osm_type, osm_id, tags, lon, lat):
        k = poi_kind(tags)
        if not k or "name" not in tags:
            return
        hood = inside(lon, lat)
        if not hood:
            return
        rec = {"osm": f"{osm_type}/{osm_id}", "lon": round(lon, 6), "lat": round(lat, 6),
               "hood": hood, "key": k[0], "type": k[1]}
        for t in KEEP_TAGS:
            if t in tags:
                rec[t] = tags[t]
        self.pois.append(rec)

    def node(self, n):
        if not n.tags or not n.location.valid():
            return
        tags = {t.k: t.v for t in n.tags}
        self._poi("node", n.id, tags, n.location.lon, n.location.lat)

    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        try:
            coords = [(nd.lon, nd.lat) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(coords) < 4 or coords[0] != coords[-1]:
            return
        cx = sum(c[0] for c in coords[:-1]) / (len(coords) - 1)
        cy = sum(c[1] for c in coords[:-1]) / (len(coords) - 1)
        if not (bbox[0] <= cx <= bbox[2] and bbox[1] <= cy <= bbox[3]):
            return
        if "building" in tags and tags["building"] != "no":
            self.buildings.append({"id": w.id, "coords": coords,
                                   "levels": tags.get("building:levels"),
                                   "btype": tags["building"]})
        self._poi("way", w.id, tags, cx, cy)


h = H()
h.apply_file(pbf, locations=True)
json.dump({"pois": h.pois, "buildings": h.buildings}, open(out_path, "w"))
print(len(h.pois), "pois;", len(h.buildings), "buildings")
oh = sum(1 for p in h.pois if "opening_hours" in p)
print(oh, "with opening_hours")
from collections import Counter
print(Counter(p["hood"] for p in h.pois))
print(Counter((p["key"]) for p in h.pois))
print(Counter((p["key"]) for p in h.pois if "opening_hours" in p))
