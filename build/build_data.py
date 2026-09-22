"""History atlas - build data/ from Cliopatria.

Reads build/raw/cliopatria_polities_only.geojson and build/raw/wd_succession.json,
writes data/base.js and data/c<NN>_<w|f>.js, plus reports in build/work/.

Rows drawn: Type == POLITY and the entity name is not parenthesised.  Cliopatria marks
aggregates and relations with parenthesised names ("(British Empire)", "(Allegiance of X
to Y)"); every aggregate declares its members through MemberOf and every member names its
aggregate, so drawing the members alone covers the same ground once instead of twice.
"""
import json, os, sys, math, re, subprocess, collections, gc, time

import shapely
from shapely.geometry import shape, mapping
from shapely.strtree import STRtree
from shapely import STRtree as _t

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
WORK = os.path.join(HERE, 'work')
DATA = os.path.normpath(os.path.join(HERE, '..', 'data'))
RIVERS_BASE = os.path.normpath(os.path.join(HERE, '..', '..', 'river-valleys-site', 'data', 'base.js'))
MAPSHAPER = os.path.join(HERE, 'node_modules', '.bin', 'mapshaper.cmd')
if not os.path.exists(MAPSHAPER):
    MAPSHAPER = os.path.join(HERE, 'node_modules', '.bin', 'mapshaper')
for d in (WORK, DATA):
    os.makedirs(d, exist_ok=True)

T0 = time.time()
def log(*a):
    print('[%6.1fs]' % (time.time() - T0), *a, flush=True)

# ------------------------------------------------------------------ chunks
def chunk_bounds():
    out, y = [], -3400
    while y < 0:    out.append((y, min(0, y + 500))); y += 500
    y = 0
    while y < 1500: out.append((y, y + 250));         y += 250
    while y < 2025: out.append((y, min(2025, y + 100))); y += 100
    return out
CHUNKS = chunk_bounds()

WORLD_KM, FINE_KM = 8000, 2000          # mapshaper simplify intervals, metres

# ------------------------------------------------------------------ 1. read
def is_agg(name):
    return (name or '').startswith('(')

log('reading Cliopatria')
with open(os.path.join(RAW, 'cliopatria_polities_only.geojson'), 'r', encoding='utf-8') as f:
    gj = json.load(f)

ents = {}          # name -> entity dict
rows = []          # row dicts, in file order
chunk_files = {}
for i, b in enumerate(CHUNKS):
    chunk_files[i] = open(os.path.join(WORK, 'chunk%02d.geojson' % i), 'w', encoding='utf-8')
    chunk_files[i].write('{"type":"FeatureCollection","features":[\n')
chunk_n = collections.Counter()
ROWN = [0]

def ent_of(p):
    n = p['Name']
    e = ents.get(n)
    if e is None:
        e = ents[n] = {'name': n, 'idx': len(ents), 'wp': p.get('Wikipedia') or '',
                       'wd': p.get('Wikidata') or '', 'seshat': p.get('SeshatID') or '',
                       'aggs': set(), 'rows': [], 'first': 9999, 'last': -9999}
    for a in (p.get('MemberOf') or '').split(';'):
        a = a.strip()
        if a: e['aggs'].add(a)
    return e

log('splitting rows into chunks and simplifying for analysis')
for ft in gj['features']:
    p = ft['properties']
    if p['Type'] != 'POLITY' or is_agg(p['Name']):
        continue
    g = ft['geometry']
    if not g:
        continue
    e = ent_of(p)
    fy, ty = int(p['FromYear']), int(p['ToYear'])
    r = {'i': ROWN[0], 'e': e['idx'], 'f': fy, 't': ty,
         'a': float(p['Area'] or 0), 'ent': e}
    ROWN[0] += 1
    e['rows'].append(r)
    e['first'] = min(e['first'], fy)
    e['last'] = max(e['last'], ty)
    try:
        sg = shape(g)
        if not sg.is_valid:
            sg = sg.buffer(0)
        sg = sg.simplify(0.05, preserve_topology=True)
        if sg.is_empty:
            sg = shape(g).simplify(0.05, preserve_topology=False)
    except Exception:
        sg = None
    r['sg'] = sg
    r['bounds'] = sg.bounds if sg is not None and not sg.is_empty else None
    # anchor: pole of inaccessibility of the largest part, for rows big enough to label
    r['k'] = None
    if sg is not None and not sg.is_empty and r['a'] >= 12000:
        try:
            parts = list(sg.geoms) if sg.geom_type == 'MultiPolygon' else [sg]
            big = max(parts, key=lambda q: q.area)
            mic = shapely.maximum_inscribed_circle(big, 0.05)
            c = mic.coords[0]
            r['k'] = [round(c[0], 2), round(c[1], 2)]
        except Exception:
            c = sg.representative_point()
            r['k'] = [round(c.x, 2), round(c.y, 2)]
    # write the raw geometry into every chunk it is alive in
    feat = {'type': 'Feature', 'properties': {'r': r['i'], 'e': e['idx'], 'f': fy, 't': ty,
                                              'a': round(r['a'], 1)}, 'geometry': g}
    line = json.dumps(feat, separators=(',', ':'))
    for ci, (ca, cb) in enumerate(CHUNKS):
        if fy <= cb and ty >= ca:
            fh = chunk_files[ci]
            if chunk_n[ci]:
                fh.write(',\n')
            fh.write(line)
            chunk_n[ci] += 1

for ci, fh in chunk_files.items():
    fh.write('\n]}\n')
    fh.close()
del gj
gc.collect()
rows = sorted([r for e in ents.values() for r in e['rows']], key=lambda r: r['i'])
log('rows %d, entities %d' % (len(rows), len(ents)))
for ci, (ca, cb) in enumerate(CHUNKS):
    log('  chunk %2d %6d..%-6d %5d rows' % (ci, ca, cb, chunk_n[ci]))

ENTS = sorted(ents.values(), key=lambda e: e['idx'])
for e in ENTS:
    e['rows'].sort(key=lambda r: r['f'])

# ------------------------------------------------------------------ 2. lineage graph
log('building the succession graph')
wd = json.load(open(os.path.join(RAW, 'wd_succession.json'), 'r', encoding='utf-8'))
# a Wikidata id may be shared by several Cliopatria names (a few data slips, plus the
# aggregates); prefer a drawn entity, and the earliest one if there is still a choice
q2e, qcount = {}, collections.Counter()
for e in ENTS:
    if e['wd']:
        qcount[e['wd']] += 1
        cur = q2e.get(e['wd'])
        if cur is None or e['first'] < cur['first']:
            q2e[e['wd']] = e
ambig = set(q for q, n in qcount.items() if n > 1)
q2e = {q: e for q, e in q2e.items() if q not in ambig}

edges = set()                    # (predecessor idx, successor idx)
for a, p, b in wd['edges']:
    ea, eb = q2e.get(a), q2e.get(b)
    if not ea or not eb or ea is eb:
        continue
    if p == 'P1366':             # a replaced by b
        edges.add((ea['idx'], eb['idx']))
    else:                        # P1365: a replaces b
        edges.add((eb['idx'], ea['idx']))
log('  %d edges from Wikidata (%d raw statements, %d ambiguous ids skipped)' % (len(edges), len(wd['edges']), len(ambig)))

def first_shape(e):
    for r in e['rows']:
        if r['sg'] is not None and not r['sg'].is_empty:
            return r['sg']
    return None
def last_shape(e):
    for r in reversed(e['rows']):
        if r['sg'] is not None and not r['sg'].is_empty:
            return r['sg']
    return None
for e in ENTS:
    e['fs'] = first_shape(e)
    e['ls'] = last_shape(e)

# fallback: B starts where and when A ends
GAP = 25
cands = [e for e in ENTS if e['ls'] is not None]
tree = STRtree([e['ls'] for e in cands])
added = 0
for b in ENTS:
    if b['fs'] is None:
        continue
    for j in tree.query(b['fs']):
        a = cands[j]
        if a is b or (a['idx'], b['idx']) in edges:
            continue
        if not (b['first'] - GAP <= a['last'] <= b['first'] + GAP):
            continue
        try:
            inter = a['ls'].intersection(b['fs']).area
        except Exception:
            continue
        if b['fs'].area and inter > 0.6 * min(a['ls'].area, b['fs'].area):
            edges.add((a['idx'], b['idx'])); added += 1
log('  %d fallback edges added, %d total' % (added, len(edges)))

# hand corrections
OVR = os.path.join(HERE, 'lineage_overrides.json')
overrides = json.load(open(OVR, encoding='utf-8')) if os.path.exists(OVR) else {'add': [], 'drop': [], 'root': []}
byname = {e['name']: e for e in ENTS}
for a, b in overrides.get('drop', []):
    if a in byname and b in byname:
        edges.discard((byname[a]['idx'], byname[b]['idx']))
forced = set()
for a, b in overrides.get('add', []):
    if a in byname and b in byname:
        e2 = (byname[a]['idx'], byname[b]['idx'])
        edges.add(e2); forced.add(e2)
    else:
        log('  ! override names "%s" -> "%s" not both in the data' % (a, b))
for n in overrides.get('root', []):
    if n in byname:
        i = byname[n]['idx']
        edges = set((x, y) for x, y in edges if y != i)

# A succession is a handover: the successor must begin about when the predecessor ends, and
# the two must share ground.  Wikidata's P1365/P1366 reach well beyond Cliopatria's 1,540
# polities and across the world, so the same test is applied to those edges too.
GAP_AFTER, GAP_BEFORE = 60, 300
edges = set((a, b) for a, b in edges
            if a != b
            and ENTS[b]['first'] >= ENTS[a]['first']
            and ENTS[b]['last'] >= ENTS[a]['last']
            and ENTS[b]['first'] - ENTS[a]['last'] <= GAP_AFTER
            and ENTS[a]['last'] - ENTS[b]['first'] <= GAP_BEFORE) | set(
            (a, b) for a, b in forced if a != b)

def ratios(a, b):
    """(share of A that B took over, share of B that came out of A)"""
    ga, gb = ENTS[a]['ls'], ENTS[b]['fs']
    if ga is None or gb is None or ga.is_empty or gb.is_empty or not ga.area or not gb.area:
        return (0.0, 0.0)
    try:
        if not ga.intersects(gb):
            return (0.0, 0.0)
        inter = ga.intersection(gb).area
        return (inter / ga.area, inter / gb.area)
    except Exception:
        return (0.0, 0.0)

log('  weighing %d edges' % len(edges))
W = {}
for a, b in edges:
    W[(a, b)] = (1.0, 1.0) if (a, b) in forced else ratios(a, b)
MINSHARE = 0.15
edges = set(k for k, v in W.items() if max(v) >= MINSHARE)
W = {k: v for k, v in W.items() if k in edges}
log('  %d edges survive the handover test (%d forced by hand)' % (len(edges), len(forced & edges)))

# Each entity keeps at most one main predecessor: the one most of it came out of.  Measured
# against the successor's own area, so a small state is not credited to whichever giant
# happened to contain it.
preds = collections.defaultdict(list)
for (a, b), v in W.items():
    preds[b].append((v[1], ENTS[a]['ls'].area, a))
mainpred = {}
for b, lst in preds.items():
    lst.sort(reverse=True)
    mainpred[b] = lst[0][2]

# And each entity hands its lineage on to at most one successor: the one that took over most
# of it.  Measured the other way about, against the predecessor's area, or a tiny splinter
# lying wholly inside the old state would inherit the line ahead of its real heir.
succs = collections.defaultdict(list)
for b, a in mainpred.items():
    succs[a].append((W[(a, b)][0], ENTS[b]['ls'].area, b))
cont = {}
for a, lst in succs.items():
    lst.sort(reverse=True)
    cont[a] = lst[0][2]

# walk the chains
lin_of = {}
lineages = []
for e in ENTS:
    i = e['idx']
    if i in lin_of:
        continue
    if i in mainpred and cont.get(mainpred[i]) == i:
        continue                       # not a chain head; it will be reached from its predecessor
    chain, j, guard = [], i, 0
    while j is not None and j not in lin_of and guard < 200:
        chain.append(j); lin_of[j] = len(lineages)
        j = cont.get(j); guard += 1
    lineages.append({'id': len(lineages), 'members': chain})
# anything left (a cycle the walk could not enter) becomes its own lineage
for e in ENTS:
    if e['idx'] not in lin_of:
        lin_of[e['idx']] = len(lineages)
        lineages.append({'id': len(lineages), 'members': [e['idx']]})

for L in lineages:
    L['members'].sort(key=lambda i: (ENTS[i]['first'], ENTS[i]['last']))
for e in ENTS:
    e['lin'] = lin_of[e['idx']]
    # a branch remembers the polity it came out of, even though it takes its own hue
    mp = mainpred.get(e['idx'])
    e['parent'] = mp if (mp is not None and lin_of[mp] != e['lin']) else -1
log('  %d lineages over %d entities' % (len(lineages), len(ENTS)))

# ------------------------------------------------------------------ 3. hues
log('weighing which lineages were ever neighbours')
# Cliopatria draws each polity on its own, so two states that shared a frontier rarely share
# an edge in the file; the test is therefore against a thin band round each shape, whose
# overlap with its neighbour's band is the length of the border they held in common.
EPS = 0.06
live = [r for r in rows if r['sg'] is not None and not r['sg'].is_empty]
for r in live:
    try:
        r['bg'] = r['sg'].buffer(EPS)
    except Exception:
        r['bg'] = None
live = [r for r in live if r['bg'] is not None and not r['bg'].is_empty]
log('  %d row bands built' % len(live))
tree = STRtree([r['bg'] for r in live])
nbr = collections.defaultdict(float)
pairs = 0
for n, r in enumerate(live):
    la = ENTS[r['e']]['lin']
    for j in tree.query(r['bg']):
        s = live[j]
        if s['i'] <= r['i']:
            continue
        lb = ENTS[s['e']]['lin']
        if la == lb:
            continue
        yrs = min(r['t'], s['t']) - max(r['f'], s['f']) + 1
        if yrs <= 0:
            continue
        try:
            if not r['bg'].intersects(s['bg']):
                continue
            band = r['bg'].intersection(s['bg']).area / (2 * EPS)
        except Exception:
            continue
        if band <= 0.05:
            continue
        k = (la, lb) if la < lb else (lb, la)
        nbr[k] += band * yrs
        pairs += 1
log('  %d adjacent row pairs, %d lineage pairs' % (pairs, len(nbr)))
for r in live:
    r['bg'] = None

# Sharing a border is not the only way two lineages come to sit side by side on the globe.
# Scythia and the Achaemenids faced each other across the Black Sea and never touch in the
# file, yet the eye puts them next to each other, so a weaker term joins the lineages that
# were merely near each other while both were alive.  Only the lineages large enough to take
# a full hue at the world view are worth the work.
from shapely.ops import unary_union
PROX_DEG, PROX_W, PROX_TOP = 4.0, 3.0, 300
log('  weighing which lineages were merely near each other')
for L in lineages:
    L['area'] = sum(max(r['a'] for r in ENTS[i]['rows']) for i in L['members'])
    L['years'] = sum(ENTS[i]['last'] - ENTS[i]['first'] + 1 for i in L['members'])
    L['weight'] = L['area'] * L['years']
    L['first'] = min(ENTS[i]['first'] for i in L['members'])
    L['last'] = max(ENTS[i]['last'] for i in L['members'])
top = sorted(lineages, key=lambda L: -L['weight'])[:PROX_TOP]
shapes, keep = [], []
for L in top:
    gs = [r['sg'] for i in L['members'] for r in ENTS[i]['rows']
          if r['sg'] is not None and not r['sg'].is_empty]
    if not gs:
        continue
    try:
        u = unary_union(gs).simplify(0.15)
    except Exception:
        continue
    if u.is_empty:
        continue
    shapes.append(u.buffer(PROX_DEG)); keep.append((L, u))
ptree = STRtree(shapes)
pn = 0
for a in range(len(keep)):
    La, ua = keep[a]
    for b in ptree.query(shapes[a]):
        if b <= a:
            continue
        Lb, ub = keep[b]
        yrs = min(La['last'], Lb['last']) - max(La['first'], Lb['first']) + 1
        if yrs <= 0:
            continue
        try:
            d = ua.distance(ub)
        except Exception:
            continue
        if d >= PROX_DEG:
            continue
        k = (La['id'], Lb['id']) if La['id'] < Lb['id'] else (Lb['id'], La['id'])
        nbr[k] += PROX_W * yrs * (1 - d / PROX_DEG)
        pn += 1
log('  %d near pairs among the %d largest lineages, %d lineage pairs in all' % (pn, len(keep), len(nbr)))

adj = collections.defaultdict(dict)
for (a, b), w in nbr.items():
    adj[a][b] = w
    adj[b][a] = w

HUES = [h for h in range(0, 360, 15) if not (185 <= h <= 275)]      # blue is water
def wheel(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)
order = sorted(lineages, key=lambda L: -L['weight'])
hue_of = {}
used = collections.Counter()
for L in order:
    ns = adj.get(L['id'], {})
    best, bestcost = HUES[0], None
    for h in HUES:
        cost = 0.0
        for n, w in ns.items():
            hn = hue_of.get(n)
            if hn is None:
                continue
            d = wheel(h, hn)
            if d < 60:
                cost += w * (60 - d) ** 2
        cost += used[h] * 1e-6 * (L['weight'] + 1)
        if bestcost is None or cost < bestcost:
            bestcost, best = cost, h
    hue_of[L['id']] = best
    used[best] += 1
    L['hue'] = best
log('  hues assigned; spread %s' % dict(sorted(used.items())))

# shade within a lineage: one colour that ages slightly
for L in lineages:
    n = len(L['members'])
    for k, i in enumerate(L['members']):
        ENTS[i]['L'] = 63.0 if n == 1 else round(72 - (k / (n - 1)) * 17, 1)
        ENTS[i]['pos'] = k

# ------------------------------------------------------------------ 4. report
log('writing the lineage report')
with open(os.path.join(WORK, 'lineage_report.tsv'), 'w', encoding='utf-8') as f:
    f.write('rank\tlineage\thue\tspan\tarea_Mkm2\tmembers\n')
    for n, L in enumerate(sorted(lineages, key=lambda L: -L['weight'])[:50], 1):
        ms = L['members']
        span = '%s..%s' % (ENTS[ms[0]]['first'], ENTS[ms[-1]]['last'])
        names = ' > '.join(ENTS[i]['name'] for i in ms)
        f.write('%d\t%s\t%d\t%s\t%.2f\t%s\n' % (n, ENTS[ms[0]]['name'], L['hue'], span, L['area'] / 1e6, names))

with open(os.path.join(WORK, 'lineage_cases.txt'), 'w', encoding='utf-8') as f:
    for probe in ('Roman Republic', 'Roman Empire', 'Eastern Roman Empire', 'Byzantine Empire',
                  'Rashidun Caliphate', 'Umayyad Caliphate', 'Abbasid Caliphate', 'Fatimid Caliphate',
                  'Han Dynasty', 'Tang Dynasty', 'Song Dynasty', 'Ming Dynasty', 'Qing Dynasty',
                  'Mongol Empire', 'Yuan Dynasty', 'Ilkhanate', 'Golden Horde', 'Chagatai Khanate',
                  'West Franks', 'Kingdom of France', 'French Republic', 'Russian Empire'):
        e = byname.get(probe)
        if not e:
            f.write('%s: NOT FOUND\n' % probe); continue
        L = lineages[e['lin']]
        f.write('%s  [lineage %d, hue %d, position %d/%d]\n    %s\n    parent: %s\n\n' % (
            probe, L['id'], L['hue'], e['pos'] + 1, len(L['members']),
            ' > '.join(ENTS[i]['name'] for i in L['members']),
            ENTS[e['parent']]['name'] if e['parent'] >= 0 else '-'))

# ------------------------------------------------------------------ 5. geometry
def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        log('  ! ' + (r.stderr or r.stdout)[-600:])
    return r.returncode == 0

def topo_to_js(topo_path, ci, kind, out_path):
    with open(topo_path, 'r', encoding='utf-8') as f:
        topo = json.load(f)
    obj = topo['objects'][list(topo['objects'].keys())[0]]
    topo['objects'] = {'u': obj}
    # carry the row anchors across, and drop properties the page does not read
    for g in obj.get('geometries', []):
        p = g.get('properties') or {}
        ri = p.get('r')
        r = rows[ri] if ri is not None and ri < len(rows) else None
        g['properties'] = {'e': p.get('e'), 'f': p.get('f'), 't': p.get('t'), 'a': p.get('a')}
        if r and r['k']:
            g['properties']['k'] = r['k']
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('HA_CHUNK(%d,"%s",' % (ci, kind))
        json.dump(topo, f, separators=(',', ':'))
        f.write(');\n')
    return os.path.getsize(out_path)

log('simplifying and packing the chunks')
sizes = []
for ci, (ca, cb) in enumerate(CHUNKS):
    src = os.path.join(WORK, 'chunk%02d.geojson' % ci)
    if chunk_n[ci] == 0:
        continue
    for kind, interval, q in (('w', WORLD_KM, 4000), ('f', FINE_KM, 12000)):
        topo = os.path.join(WORK, 'chunk%02d_%s.topo.json' % (ci, kind))
        ok = run('"%s" -i "%s" -simplify keep-shapes interval=%d -o "%s" format=topojson quantization=%d'
                 % (MAPSHAPER, src, interval, topo, q))
        if not ok:
            continue
        out = os.path.join(DATA, 'c%02d%s.js' % (ci, kind))
        sz = topo_to_js(topo, ci, kind, out)
        sizes.append((os.path.basename(out), sz))
    log('  chunk %2d done (%s)' % (ci, ', '.join('%s %.0fkB' % (n, s / 1024) for n, s in sizes[-2:])))

# ------------------------------------------------------------------ 6. base.js
log('writing base.js')
def rv_slice(key):
    """lift one value out of the river atlas's base.js without parsing the whole of it twice"""
    s = open(RIVERS_BASE, encoding='utf-8').read()
    i = s.index('Object.assign(window.RV_DATA,')
    j = s.rindex(')')
    d = json.loads(s[i + len('Object.assign(window.RV_DATA,'):j])
    return d[key]

countries = rv_slice('countries')
cities = rv_slice('cities')

ent_out = []
for e in ENTS:
    ent_out.append([e['name'], e['lin'], lineages[e['lin']]['hue'], e['L'],
                    e['wp'], e['wd'], e['first'], e['last'],
                    sorted(e['aggs']), e['parent'], e['pos']])
lin_out = [[L['id'], L['hue'], L['members']] for L in lineages]

base = {
    'ents': ent_out,
    'lins': lin_out,
    'chunks': [[a, b] for a, b in CHUNKS],
    'counts': {'rows': len(rows), 'ents': len(ENTS), 'lins': len(lineages)},
    'countries': countries,
    'cities': cities,
}
with open(os.path.join(DATA, 'base.js'), 'w', encoding='utf-8') as f:
    f.write('window.HA_DATA=window.HA_DATA||{};Object.assign(window.HA_DATA,')
    json.dump(base, f, separators=(',', ':'))
    f.write(');\n')

tot = sum(s for _, s in sizes) + os.path.getsize(os.path.join(DATA, 'base.js'))
log('base.js %.0f kB; %d chunk files; %.1f MB in data/' % (
    os.path.getsize(os.path.join(DATA, 'base.js')) / 1024, len(sizes), tot / 1e6))
log('BUILD DONE')
