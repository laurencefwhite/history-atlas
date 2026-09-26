"""Fit Cliopatria's shapes to the coastline (see coast.py) once, in parallel, before build_data.py.

Reads raw/cliopatria_polities_only.geojson, writes raw/cliopatria_coast.geojson with the same features and
properties and fitted geometry; build_data.py reads the fitted file when it exists. About a minute on eight
processes; memory stays modest because each process builds its own coast tiles and takes shapes in batches.
"""
import json, os, sys, time
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
RIVERS_BASE = os.path.normpath(os.path.join(HERE, '..', '..', 'river-valleys-site', 'data', 'base.js'))
C = None

def countries():
    s = open(RIVERS_BASE, encoding='utf-8').read()
    i = s.index('Object.assign(window.RV_DATA,')
    return json.loads(s[i + len('Object.assign(window.RV_DATA,'):s.rindex(')')])['countries']

def init():
    global C
    sys.path.insert(0, HERE)
    import coast
    C = coast.Coast(countries())

def work(geom):
    from shapely.geometry import shape, mapping
    if not geom:
        return geom
    g = shape(geom)
    g = g if g.is_valid else g.buffer(0)
    try:
        return mapping(C.fit(g))
    except Exception:
        return geom

def main():
    t0 = time.time()
    gj = json.load(open(os.path.join(RAW, 'cliopatria_polities_only.geojson'), encoding='utf-8'))
    feats = gj['features']
    print('features', len(feats), flush=True)
    with Pool(8, initializer=init) as pool:
        out = pool.map(work, [f['geometry'] for f in feats], chunksize=40)
    for f, g in zip(feats, out):
        f['geometry'] = g
    with open(os.path.join(RAW, 'cliopatria_coast.geojson'), 'w', encoding='utf-8') as f:
        json.dump(gj, f)
    print('COAST DONE in %.0f s' % (time.time() - t0), flush=True)

if __name__ == '__main__':
    main()
