#!/usr/bin/env python3
"""Build Bus Bhai's own offline basemap from an OSM GeoJSON export.
Output: assets/data/map.json
  { "b": [minLat, minLon, maxLat, maxLon], "q": 1e5,
    "k": ["water","park","rail","metro","major","mid","minor"],
    "f": [[kind, [x0,y0,dx,dy,...]], ...]  # delta-encoded ints (lon*1e5, lat*1e5)
  }
Lines and polygon rings are simplified per class.
"""
import json, sys, math
from shapely.geometry import shape, LineString, Polygon, MultiPolygon, MultiLineString
from shapely.ops import unary_union

SRC = sys.argv[1]
OUT = sys.argv[2]
BOX = (78.15, 17.15, 78.80, 17.70)

KIND = {}
for h in ("motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link"): KIND[h] = "major"
for h in ("secondary", "tertiary", "secondary_link"): KIND[h] = "mid"
for h in ("residential", "unclassified"): KIND[h] = "minor"
TOL = {"water": 0.00012, "park": 0.00015, "rail": 0.00008, "metro": 0.00006, "major": 0.00005, "mid": 0.00006, "minor": 0.00008}
MINAREA = {"water": 2e-7, "park": 4e-7}
ORDER = ["water", "park", "minor", "mid", "major", "rail", "metro"]

def kind_of(p):
    if p.get("natural") == "water" or p.get("water") in ("lake", "reservoir", "pond"): return "water"
    if p.get("leisure") == "park": return "park"
    r = p.get("railway")
    if r in ("subway", "light_rail"): return "metro"
    if r == "rail": return "rail"
    return KIND.get(p.get("highway"))

def enc(coords):
    out = []; px = py = 0
    for x, y in coords:
        ix, iy = int(round(x * 1e5)), int(round(y * 1e5))
        out += [ix - px, iy - py]; px, py = ix, iy
    return out

feats = {k: [] for k in ORDER}
n = 0
with open(SRC) as fh:
    gj = json.load(fh)
for ft in gj["features"]:
    k = kind_of(ft.get("properties") or {})
    if not k or not ft.get("geometry"): continue
    try: g = shape(ft["geometry"])
    except Exception: continue
    if k in ("water", "park"):
        if g.geom_type in ("LineString",) and len(g.coords) > 3 and g.coords[0] == g.coords[-1]:
            g = Polygon(g.coords)
        if g.geom_type not in ("Polygon", "MultiPolygon"): continue
        polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
        for pg in polys:
            if pg.area < MINAREA[k]: continue
            pg = pg.simplify(TOL[k], preserve_topology=True)
            if pg.is_empty or pg.geom_type != "Polygon": continue
            rings = [list(pg.exterior.coords)] + [list(r.coords) for r in pg.interiors if Polygon(r).area > MINAREA[k]]
            feats[k].append([enc(r) for r in rings])
    else:
        lines = [g] if g.geom_type == "LineString" else list(g.geoms) if g.geom_type == "MultiLineString" else []
        for ln in lines:
            ln = ln.simplify(TOL[k])
            if len(ln.coords) < 2: continue
            feats[k].append(enc(ln.coords))
    n += 1

out = {"b": [BOX[1], BOX[0], BOX[3], BOX[2]], "q": 1e5, "k": ORDER, "f": [feats[k] for k in ORDER]}
with open(OUT, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print({k: len(v) for k, v in feats.items()}, "from", n)
