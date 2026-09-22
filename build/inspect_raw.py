import json, sys, collections, os

P = os.path.join(os.path.dirname(__file__), 'raw', 'cliopatria_polities_only.geojson')
print('size MB', round(os.path.getsize(P)/1e6, 1))
with open(P, 'r', encoding='utf-8') as f:
    gj = json.load(f)
print('top keys', list(gj.keys()))
feats = gj['features']
print('features', len(feats))
props = feats[0]['properties']
print('prop keys', list(props.keys()))
print('sample', json.dumps(props)[:600])

keys = collections.Counter()
for ft in feats:
    for k in ft['properties']:
        keys[k] += 1
print('key counts', dict(keys))

types = collections.Counter(ft['properties'].get('Type') for ft in feats)
print('Type', dict(types))
geom = collections.Counter(ft['geometry']['type'] if ft['geometry'] else None for ft in feats)
print('geom', dict(geom))

names = set(ft['properties'].get('Name') for ft in feats)
print('distinct Name', len(names))
paren = [n for n in names if n and '(' in n]
print('names with parens', len(paren), sorted(paren)[:25])

ys = [(ft['properties'].get('FromYear'), ft['properties'].get('ToYear')) for ft in feats]
fy = [a for a, b in ys if isinstance(a, (int, float))]
ty = [b for a, b in ys if isinstance(b, (int, float))]
print('FromYear range', min(fy), max(fy), 'ToYear range', min(ty), max(ty))
print('zero years from', sum(1 for y in fy if y == 0), 'to', sum(1 for y in ty if y == 0))
print('from>to', sum(1 for a, b in ys if isinstance(a,(int,float)) and isinstance(b,(int,float)) and a > b))
print('null years', sum(1 for a, b in ys if a is None or b is None))

# Wikidata / wikipedia coverage
wd = sum(1 for ft in feats if ft['properties'].get('Wikidata'))
wp = sum(1 for ft in feats if ft['properties'].get('Wikipedia'))
print('rows with Wikidata', wd, 'Wikipedia', wp)

# per-entity: how many rows, overlaps, gaps
byname = collections.defaultdict(list)
for i, ft in enumerate(feats):
    p = ft['properties']
    byname[p.get('Name')].append((p.get('FromYear'), p.get('ToYear'), i))
print('entities by Name', len(byname))
rowcount = collections.Counter(len(v) for v in byname.values())
print('rows per entity histogram (top)', sorted(rowcount.items())[:12], '... max', max(rowcount))

ov = gp = 0
gapex = []
for n, v in byname.items():
    v = sorted(x for x in v if x[0] is not None and x[1] is not None)
    for a, b in zip(v, v[1:]):
        if b[0] < a[1]: ov += 1
        elif b[0] > a[1] + 1:
            gp += 1
            if len(gapex) < 8: gapex.append((n, a[1], b[0]))
print('adjacent-row time overlaps', ov, 'gaps', gp)
print('gap examples', gapex)

# do entities share a Wikidata id under different names?
wdmap = collections.defaultdict(set)
for ft in feats:
    p = ft['properties']
    if p.get('Wikidata'): wdmap[p['Wikidata']].add(p.get('Name'))
multi = {k: v for k, v in wdmap.items() if len(v) > 1}
print('wikidata ids with >1 name', len(multi), list(multi.items())[:6])

# name -> distinct wikidata
nm = collections.defaultdict(set)
for ft in feats:
    p = ft['properties']
    if p.get('Wikidata'): nm[p.get('Name')].add(p['Wikidata'])
print('names with >1 wikidata', sum(1 for v in nm.values() if len(v) > 1))

# area stats
ar = sorted(ft['properties'].get('Area') or 0 for ft in feats)
print('Area min/med/max', ar[0], ar[len(ar)//2], ar[-1])

# live-in-year counts
for yr in (-500, 200, 750, 1300, 1700, 1914, 2000):
    n = sum(1 for ft in feats if (ft['properties'].get('FromYear') or 9999) <= yr <= (ft['properties'].get('ToYear') or -9999))
    print('alive at', yr, n)

# rough coordinate count
def cnt(g):
    if not g: return 0
    c = g['coordinates']; t = g['type']
    if t == 'Polygon': return sum(len(r) for r in c)
    if t == 'MultiPolygon': return sum(len(r) for poly in c for r in poly)
    return 0
tot = sum(cnt(ft['geometry']) for ft in feats)
print('total coordinate pairs', tot)
