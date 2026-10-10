"""Build a small vector basemap (streets, parks, water, beach, neighborhood outlines) for the Sunset."""
import json
import sys

import osmium
from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import unary_union

pbf, nhoods_path, out_path = sys.argv[1:4]
BBOX = box(-122.5155, 37.7255, -122.4435, 37.7720)
ROAD_CLASS = {"motorway": 1, "trunk": 1, "primary": 1, "secondary": 2, "tertiary": 2,
              "residential": 3, "unclassified": 3, "living_street": 3, "pedestrian": 4}


def rnd(geom, nd=5):
    gj = mapping(geom)

    def r(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    return {"type": gj["type"], "coordinates": r(gj["coordinates"])}


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.roads, self.green, self.water, self.sand = [], [], [], []

    def way(self, w):
        hw = w.tags.get("highway")
        if hw not in ROAD_CLASS:
            return
        try:
            coords = [(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(coords) < 2:
            return
        ls = LineString(coords)
        if not ls.intersects(BBOX):
            return
        ls = ls.intersection(BBOX).simplify(0.00002)
        if ls.is_empty:
            return
        self.roads.append({"c": ROAD_CLASS[hw], "n": w.tags.get("name", ""), "g": ls})

    def area(self, a):
        t = a.tags
        kind = None
        if t.get("leisure") in ("park", "golf_course", "nature_reserve") or t.get("landuse") in ("grass", "recreation_ground", "forest", "cemetery") or t.get("natural") in ("wood", "scrub"):
            kind = "green"
        elif t.get("natural") == "water" or t.get("water") or t.get("landuse") == "reservoir":
            kind = "water"
        elif t.get("natural") in ("beach", "sand"):
            kind = "sand"
        if not kind:
            return
        try:
            polys = []
            for outer in a.outer_rings():
                ring = [(n.lon, n.lat) for n in outer]
                inners = [[(n.lon, n.lat) for n in inner] for inner in a.inner_rings(outer)]
                polys.append(Polygon(ring, inners))
            g = unary_union(polys).buffer(0)
        except Exception:
            return
        if not g.intersects(BBOX):
            return
        g = g.intersection(BBOX)
        if g.area < 2e-7:
            return
        getattr(self, kind).append(g.simplify(0.00003))


h = H()
h.apply_file(pbf, locations=True)

# coastline -> ocean polygon west of it
class C(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def way(self, w):
        if w.tags.get("natural") != "coastline":
            return
        try:
            coords = [(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        ls = LineString(coords)
        if ls.intersects(BBOX.buffer(0.01)):
            self.lines.append(ls)


c = C()
c.apply_file(pbf, locations=True)
ocean = None
if c.lines:
    from shapely.ops import linemerge, split
    merged = linemerge(unary_union(c.lines))
    pieces = split(BBOX, merged)
    # the ocean piece is the one touching the bbox west edge at mid-latitude
    west_mid = box(-122.5155, 37.748, -122.5150, 37.749)
    for p in getattr(pieces, "geoms", [pieces]):
        if p.intersects(west_mid) and p.area < BBOX.area * 0.5:
            ocean = p.simplify(0.00003)

nh = json.load(open(nhoods_path))
hoods = [{"n": f["properties"]["nhood"], "g": rnd(shape(f["geometry"]).simplify(0.00003))} for f in nh["features"]]


def merge(lst):
    if not lst:
        return None
    u = unary_union(lst)
    return rnd(u)


out = {
    "bbox": list(BBOX.bounds),
    "roads": [{"c": r["c"], "n": r["n"], "g": rnd(r["g"])} for r in h.roads],
    "green": merge(h.green),
    "water": merge(h.water),
    "sand": merge(h.sand),
    "ocean": rnd(ocean) if ocean is not None else None,
    "hoods": hoods,
}
s = json.dumps(out, separators=(",", ":"))
open(out_path, "w").write(s)
print("roads", len(out["roads"]), "green", len(h.green), "water", len(h.water), "sand", len(h.sand),
      "ocean", ocean is not None, "bytes", len(s))
