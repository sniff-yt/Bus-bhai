#!/usr/bin/env python3
"""Telangana-wide basemap for Bus Bhai.
inputs: tg.geojson (state roads/water/rail/places), tgres.geojson (residential streets),
        f.geojson (Hyderabad detail, already used for v1.0.2)
output: assets/data/map.json  {k: kinds, f: features per kind, p: place labels}
"""
import json, math, sys
from shapely.geometry import shape, Polygon, Point
from shapely.strtree import STRtree

D = 'data/osm/'
OUT = 'assets/data/map.json'
HYD = (78.15, 17.15, 78.80, 17.70)
ORDER = ["water", "park", "river", "minor", "mid", "major", "rail", "metro"]
TOL = {"water": 0.00012, "park": 0.00015, "river": 0.0002, "rail": 0.0001, "metro": 0.00006, "major": 0.00006, "mid": 0.00008, "minor": 0.00012}
TOL_OUT = {"water": 0.0004, "river": 0.0004, "rail": 0.0002, "major": 0.00012, "mid": 0.00025, "minor": 0.00015}
MINAREA = {"water": 2e-7, "park": 4e-7}
MINAREA_OUT = {"water": 1.5e-5}

def inhyd(b): return b[0] >= HYD[0] and b[2] <= HYD[2] and b[1] >= HYD[1] and b[3] <= HYD[3]

def kind_of(p):
    if p.get("waterway") == "river": return "river"
    if p.get("natural") == "water" or p.get("water") in ("lake", "reservoir", "pond", "river"): return "water"
    if p.get("leisure") == "park": return "park"
    r = p.get("railway")
    if r in ("subway", "light_rail"): return "metro"
    if r == "rail": return "rail"
    h = p.get("highway")
    if h in ("motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link"): return "major"
    if h in ("secondary", "tertiary", "secondary_link"): return "mid"
    if h in ("residential", "unclassified"): return "minor"
    return None

def enc(coords):
    out = []; px = py = 0
    for x, y in coords:
        ix, iy = int(round(x * 1e5)), int(round(y * 1e5))
        out += [ix - px, iy - py]; px, py = ix, iy
    return out

feats = {k: [] for k in ORDER}
places = []

def add(ft, outside_only):
    k = kind_of(ft.get("properties") or {})
    if not k or not ft.get("geometry"): return
    try: g = shape(ft["geometry"])
    except Exception: return
    b = g.bounds
    if outside_only and inhyd(b): return   # Hyderabad detail comes from f.geojson
    hyd = inhyd(b)
    if k in ("water", "park"):
        if g.geom_type == "LineString" and len(g.coords) > 3 and g.coords[0] == g.coords[-1]: g = Polygon(g.coords)
        if g.geom_type not in ("Polygon", "MultiPolygon"): return
        ma = MINAREA[k] if hyd else MINAREA_OUT.get(k, 1)
        tol = TOL[k] if hyd else TOL_OUT.get(k, TOL[k])
        for pg in ([g] if g.geom_type == "Polygon" else list(g.geoms)):
            if pg.area < ma: continue
            pg = pg.simplify(tol, preserve_topology=True)
            if pg.is_empty or pg.geom_type != "Polygon": continue
            rings = [list(pg.exterior.coords)] + [list(r.coords) for r in pg.interiors if Polygon(r).area > ma]
            feats[k].append([enc(r) for r in rings])
    else:
        tol = TOL[k] if hyd else TOL_OUT.get(k, TOL[k])
        lines = [g] if g.geom_type == "LineString" else list(g.geoms) if g.geom_type == "MultiLineString" else []
        for ln in lines:
            ln = ln.simplify(tol)
            if len(ln.coords) < 2: continue
            feats[k].append(enc(ln.coords))

# 1. Hyderabad detail
for ft in json.load(open(D + 'f.geojson'))["features"]: add(ft, False)
# 2. statewide roads / water / rail, places
tg = json.load(open(D + 'tg.geojson'))["features"]
towns = []
for ft in tg:
    p = ft.get("properties") or {}
    if ft.get("geometry", {}).get("type") == "Point" and p.get("place"):
        x, y = ft["geometry"]["coordinates"]
        name = p.get("name:en") or p.get("name")
        if not name: continue
        rank = {"city": 0, "town": 1, "suburb": 2, "village": 3}.get(p["place"], 3)
        if rank == 3 and not (p.get("population") and int(''.join(c for c in str(p.get("population")) if c.isdigit()) or 0) > 5000): continue
        if rank == 2 and not (HYD[0] <= x <= HYD[2] and HYD[1] <= y <= HYD[3]): continue
        te = p.get("name:te") or ""
        places.append([round(x, 4), round(y, 4), rank, name, te])
        if rank <= 1: towns.append(Point(x, y))
        continue
    add(ft, True)
# 3. residential streets within 3 km of every city/town outside Hyderabad
tree = STRtree(towns)
R = 0.014
n = 0
for ft in json.load(open(D + 'tgres.geojson'))["features"]:
    g = ft.get("geometry")
    if not g or g["type"] != "LineString": continue
    c = g["coordinates"][0]
    if HYD[0] <= c[0] <= HYD[2] and HYD[1] <= c[1] <= HYD[3]: continue
    pt = Point(c)
    if not len(tree.query(pt.buffer(R))): continue
    add(ft, True); n += 1

out = {"q": 1e5, "k": ORDER, "f": [feats[k] for k in ORDER], "p": places}
json.dump(out, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
print({k: len(v) for k, v in feats.items()}, "places", len(places), "town streets", n)
