"""Polity shapes fitted to the coastline.

Cliopatria's boundaries are drawn by hand at a coarse scale, so along a coast a shape often stops short of the
shore or runs out over the sea, and a coastal city (Barcelona in 1300) can fall outside every polity. Where a
shape reaches the coast, the coast is taken as its border instead: the shape is extended over the strip of
land within COAST_KM of the sea that lies within COAST_KM of the shape, and then trimmed to the land (with a
small margin, so that a harbour town on a spit stays inside). Land borders between polities are untouched,
since the extension reaches only into the coastal strip.

The land is the country outlines the page draws (from the river valleys atlas's base file), so the fills meet
the coastline drawn beneath them. Work is done tile by tile, 10 degrees square, so each shape meets only the
coast near it.
"""
import json, math, os
from shapely.geometry import shape, Polygon, MultiPolygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.prepared import prep

COAST_KM = 13.0
MARGIN_KM = 1.5
TILE = 10.0

def km_deg(km, lat=0.0):
    return km / 111.32

def _topo_land(topo):
    """decode a TopoJSON object of polygons into shapely polygons"""
    tr = topo.get('transform')
    arcs = []
    for a in topo['arcs']:
        x = y = 0
        pts = []
        for p in a:
            if tr:
                x += p[0]; y += p[1]
                pts.append((x * tr['scale'][0] + tr['translate'][0], y * tr['scale'][1] + tr['translate'][1]))
            else:
                pts.append((p[0], p[1]))
        arcs.append(pts)
    def ring(ix):
        out = []
        for i in ix:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(a if not out else a[1:])
        return out
    polys = []
    def add(rings):
        rs = [ring(r) for r in rings]
        rs = [r for r in rs if len(r) >= 4]
        if rs:
            polys.append(Polygon(rs[0], rs[1:]))
    obj = list(topo['objects'].values())[0]
    for g in obj['geometries']:
        if g['type'] == 'Polygon':
            add(g['arcs'])
        elif g['type'] == 'MultiPolygon':
            for pg in g['arcs']:
                add(pg)
    return [p if p.is_valid else p.buffer(0) for p in polys]

class Coast:
    def __init__(self, countries_topo):
        land = unary_union(_topo_land(countries_topo)).buffer(0)
        d = km_deg(COAST_KM)
        self.tiles = {}
        for tx in range(-180, 180, int(TILE)):
            for ty in range(-90, 90, int(TILE)):
                b = box(tx, ty, tx + TILE, ty + TILE)
                bb = b.buffer(d * 2)
                L = land.intersection(bb)
                if L.is_empty:
                    continue
                inner = L.buffer(-d)
                band = L.difference(inner) if not inner.is_empty else L
                self.tiles[(tx, ty)] = (L.buffer(km_deg(MARGIN_KM)).intersection(b), band.intersection(b), b)
        self.keys = list(self.tiles)

    def fit(self, g):
        """the shape extended over the coastal strip near it and trimmed to the land"""
        if g.is_empty:
            return g
        d = km_deg(COAST_KM)
        x0, y0, x1, y1 = g.bounds
        near = g.buffer(d, 4)
        parts = []
        for tx in range(int(math.floor((x0 - d) / TILE) * TILE), int(x1 + d) + 1, int(TILE)):
            for ty in range(int(math.floor((y0 - d) / TILE) * TILE), int(y1 + d) + 1, int(TILE)):
                t = self.tiles.get((tx, ty))
                if not t:
                    continue
                landm, band, b = t
                gt = g.intersection(b)
                add = band.intersection(near.intersection(b))
                piece = gt.union(add) if not add.is_empty else gt
                piece = piece.intersection(landm)
                if not piece.is_empty:
                    parts.append(piece)
        if not parts:
            return g                                    # a shape entirely at sea: left as drawn
        out = unary_union(parts)
        polys = [p for p in getattr(out, 'geoms', [out]) if isinstance(p, Polygon) and p.area > 1e-6]
        if not polys:
            return g
        return MultiPolygon(polys) if len(polys) > 1 else polys[0]
