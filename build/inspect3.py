import json, os, collections
from shapely.geometry import shape
from shapely.ops import unary_union

P = os.path.join(os.path.dirname(__file__), 'raw', 'cliopatria_polities_only.geojson')
with open(P, 'r', encoding='utf-8') as f:
    feats = json.load(f)['features']

pol = [ft for ft in feats if ft['properties']['Type'] == 'POLITY']
par = lambda n: (n or '').startswith('(')

# For each aggregate (parenthesised POLITY) row, how much of its area is covered by
# rows of entities that name it in MemberOf and are alive in the same span?
memberof = collections.defaultdict(set)   # entity name -> set of aggregate names it ever belongs to
for ft in pol:
    p = ft['properties']
    for a in (p.get('MemberOf') or '').split(';'):
        a = a.strip()
        if a: memberof[p['Name']].add(a)
members_of_agg = collections.defaultdict(set)
for ent, aggs in memberof.items():
    for a in aggs: members_of_agg[a].add(ent)

aggrows = [ft for ft in pol if par(ft['properties']['Name'])]
aggnames = set(ft['properties']['Name'] for ft in aggrows)
print('aggregate (parenthesised POLITY) entities', len(aggnames), 'rows', len(aggrows))
print('of those, with declared members', sum(1 for n in aggnames if members_of_agg.get(n)))
print('aggregates with NO declared members:', sorted(n for n in aggnames if not members_of_agg.get(n))[:30])

# do any non-parenthesised entities have members? (i.e. would the paren rule miss an aggregate)
nonpar_agg = sorted(n for n in members_of_agg if not par(n))
print('NON-parenthesised names that others declare MemberOf:', len(nonpar_agg), nonpar_agg[:20])

# coverage test on a sample of aggregate rows
import random
random.seed(1)
sample = random.sample(aggrows, 60)
low = []
for ft in sample:
    p = ft['properties']
    try:
        g = shape(ft['geometry'])
        if not g.is_valid: g = g.buffer(0)
    except Exception:
        continue
    mem = members_of_agg.get(p['Name'], set())
    gs = []
    for ft2 in pol:
        p2 = ft2['properties']
        if p2['Name'] not in mem: continue
        if p2['FromYear'] > p['ToYear'] or p2['ToYear'] < p['FromYear']: continue
        try:
            g2 = shape(ft2['geometry'])
            if not g2.is_valid: g2 = g2.buffer(0)
            gs.append(g2)
        except Exception: pass
    if not gs:
        low.append((p['Name'], p['FromYear'], p['ToYear'], 0.0)); continue
    u = unary_union(gs)
    cov = g.intersection(u).area / g.area if g.area else 1
    if cov < 0.8: low.append((p['Name'], p['FromYear'], p['ToYear'], round(cov, 2)))
print('sampled 60 aggregate rows; %d covered <80%% by their members:' % len(low))
for r in low[:25]: print('   ', r)

# how many entities are ONLY ever members (never aggregates) - these are what we draw
draw = set(ft['properties']['Name'] for ft in pol if not par(ft['properties']['Name']))
print('entities drawn under the paren rule', len(draw), 'of', len(set(ft['properties']['Name'] for ft in pol)))
rows_drawn = sum(1 for ft in pol if not par(ft['properties']['Name']))
print('rows drawn', rows_drawn, 'of', len(pol))
