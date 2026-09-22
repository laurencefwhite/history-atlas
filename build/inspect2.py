import json, os, collections, random
from shapely.geometry import shape

P = os.path.join(os.path.dirname(__file__), 'raw', 'cliopatria_polities_only.geojson')
with open(P, 'r', encoding='utf-8') as f:
    feats = json.load(f)['features']

# 1. does Type==RELATION match parenthesised names?
par_rel = par_pol = nopar_rel = 0
rel_names, pol_par = set(), set()
for ft in feats:
    p = ft['properties']
    par = (p['Name'] or '').startswith('(')
    if p['Type'] == 'RELATION':
        rel_names.add(p['Name'])
        if par: par_rel += 1
        else: nopar_rel += 1
    elif par:
        par_pol += 1; pol_par.add(p['Name'])
print('RELATION rows w/ parens', par_rel, 'without', nopar_rel)
print('POLITY rows w/ parens', par_pol, sorted(pol_par)[:20])
print('distinct RELATION names', len(rel_names))
print('RELATION name shapes', collections.Counter(n.split()[0] for n in rel_names if n))

# 2. Components / MemberOf
comp = [ft['properties'] for ft in feats if ft['properties'].get('Components')]
memb = [ft['properties'] for ft in feats if ft['properties'].get('MemberOf')]
print('rows with Components', len(comp), 'with MemberOf', len(memb))
for p in comp[:4]: print('  COMP', p['Name'], p['FromYear'], p['ToYear'], '::', str(p['Components'])[:220])
for p in memb[:4]: print('  MEMB', p['Name'], p['FromYear'], p['ToYear'], '::', str(p['MemberOf'])[:220])
cn = set(); mn = set()
for p in comp: cn.add(p['Name'])
for p in memb: mn.add(p['Name'])
print('entities that ever have Components', len(cn), sorted(cn)[:15])
print('entities that ever have MemberOf', len(mn), sorted(mn)[:15])
print('Components on RELATION rows', sum(1 for p in comp if p['Type']=='RELATION'), '/', len(comp))
print('MemberOf on RELATION rows', sum(1 for p in memb if p['Type']=='RELATION'), '/', len(memb))

# 3. spatial overlap among POLITY rows alive in the same year
for yr in (200, 750, 1300, 1700):
    live = [ft for ft in feats if ft['properties']['Type']=='POLITY'
            and ft['properties']['FromYear'] <= yr <= ft['properties']['ToYear']]
    geoms = []
    for ft in live:
        try:
            g = shape(ft['geometry'])
            if not g.is_valid: g = g.buffer(0)
            geoms.append((ft['properties']['Name'], g))
        except Exception:
            pass
    pairs = 0; ex = []
    tot = 0.0
    for i in range(len(geoms)):
        for j in range(i+1, len(geoms)):
            a, b = geoms[i], geoms[j]
            if a[1].intersects(b[1]):
                inter = a[1].intersection(b[1]).area
                if inter > 0.05 * min(a[1].area, b[1].area):
                    pairs += 1; tot += inter
                    if len(ex) < 5: ex.append((a[0], b[0], round(inter/min(a[1].area,b[1].area),2)))
    print('year', yr, 'live polity rows', len(live), 'substantially overlapping pairs', pairs, ex)

# 4. how many rows in each proposed time chunk
def chunks():
    out = []
    y = -3400
    while y < 0:   out.append((y, min(0, y+500))); y += 500
    while y < 1500: out.append((y, y+250)); y += 250
    while y < 2025: out.append((y, min(2025, y+100))); y += 100
    return out
ch = chunks()
print('chunks', len(ch))
for a, b in ch:
    n = sum(1 for ft in feats if ft['properties']['Type']=='POLITY'
            and ft['properties']['FromYear'] <= b and ft['properties']['ToYear'] >= a)
    print('  %6d..%-6d %5d rows' % (a, b, n))
