"""Towns of the ancient and medieval world, down to small ones, for the atlas: data/towns.js.

Two sources:
- the Pleiades gazetteer (CC BY 3.0): every place typed settlement, urban, port or fortified settlement with
  a precise location and at least one dated period. A town is shown from the start of its first period to the
  end of its last period before 1500. Pleiades records the evidence for a place, not its fate, and most of its
  coverage stops at late antiquity, so a town is drawn as a ruin after that end only where there is reason to
  think it was abandoned: Pleiades types it an archaeological site and records no later period. (A record
  that ends early is no such reason: Pleiades' 'Roman' period ends in 300, and many towns attested only then
  still stand.) Otherwise it simply stops being shown. Every Pleiades date is an estimate from
  its periods, and the card says "about".
- checked research tables for the regions Pleiades barely covers (work/towns/out_<region>.json, merged into
  towns_research.json), each date with its Wikipedia basis.
A place within 2 km of a city the atlas already shows, or sharing its Pleiades id, is left out.
Modern places: Natural Earth's populated places of 50,000 people or more that the atlas's own 732 cities do
not include, dated from Wikidata (raw/wd_places.json, from fetch_places.py). Wikidata's inception for a city of
the old world is often the date of a municipal charter (Osaka 1889), so an inception from 1850 on is used only
in the Americas, Oceania, Israel and the former Soviet Union, where cities founded then are common; elsewhere
such a place is left undated (shown from 1500).

Ancient to modern: an ancient town is joined to the modern city on its site, becoming that city's earlier name,
only on evidence: the modern city's Wikidata item carries the town's Pleiades id, or says it replaces the
town's item, or the two names are the same within 10 km. The town's start dates the city. Its name becomes
the city's earlier name only within the Greek and Roman world, where the Latin or Greek name was the one in use
(elsewhere Pleiades' names are mostly classical renderings of local ones, such as Ptolemy's Ozene for Ujjain),
and only where it is not merely a spelling of the modern name; the switch is placed by the same conventions as
the checked renames (Britain 410; the western provinces 476; the Arab conquests about 640; the Balkans about
600; Anatolia about 1100), marked approximate. Other towns inside a modern city's footprint are listed for review in
work/town_city_candidates.tsv and stay separate. A modern city already given names over time keeps them.

Rows: [name, country, lat, lon, weight, 0, state, from, to, names, wikidata, wikipedia, pleiades, approx, kind]
(kind 'r': a ruin after its end; 'c': it continues or is lost from the record, not drawn after its end;
'm': a modern place). The atlas's own cities in data/cities.js are rewritten with any earlier names and dates.
Run build_cities.py first.
"""
import difflib, unicodedata
import csv, glob, gzip, json, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
DATA = os.path.normpath(os.path.join(HERE, '..', 'data'))
YMIN = -3400
SETTLE = {'settlement', 'urban', 'port', 'fortified-settlement'}
NOT_TOWN = re.compile(r'^(unnamed|untitled|settlement|site|place|anonymous|a )|\?', re.I)

def km(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 12742 * math.asin(math.sqrt(d))

class Grid:
    """points bucketed by half-degree cells, for 'anything within n km' tests"""
    def __init__(self): self.g = {}
    def key(self, la, lo): return (int(math.floor(la * 2)), int(math.floor(lo * 2)))
    def add(self, la, lo): self.g.setdefault(self.key(la, lo), []).append((la, lo))
    def near(self, la, lo, d):
        k = self.key(la, lo)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for p in self.g.get((k[0] + i, k[1] + j), ()):
                    if km(p, (la, lo)) < d:
                        return True
        return False

def clean(title):
    t = title.split('/')[0].strip()
    t = re.sub(r'\s*\([^)]*\)', '', t).strip()
    t = re.sub(r'^(Col|Mun|Res Publica|Civ)\.?\s+', '', t).strip()       # Col. Aquae Sextiae
    if '[' in t: return ''                                     # a name Pleiades reconstructs, not attested
    return t

def main():
    import importlib.util
    spec = importlib.util.spec_from_file_location('bc', os.path.join(HERE, 'build_cities.py'))
    bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)
    prows, per = bc.pleiades()

    s = open(os.path.join(DATA, 'cities.js'), encoding='utf-8').read()
    have = json.loads(s.split('cities2=', 1)[1].rstrip().rstrip(';'))
    grid, used_pl = Grid(), set()
    for r in have:
        grid.add(r[2], r[3])
        if len(r) > 12 and r[12]: used_pl.add(str(r[12]))

    rows = []
    # ---- the research tables first: checked by hand, they win over Pleiades where both have a place
    research = []
    for fn in sorted(glob.glob(os.path.join(HERE, 'work', 'towns', 'out_*.json'))):
        for e in json.load(open(fn, encoding='utf-8')):
            e['region'] = os.path.basename(fn)[4:-5]
            research.append(e)
    if research:
        json.dump(research, open(os.path.join(HERE, 'towns_research.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    elif os.path.exists(os.path.join(HERE, 'towns_research.json')):
        research = json.load(open(os.path.join(HERE, 'towns_research.json'), encoding='utf-8'))
    nres = 0
    for e in research:
        try:
            la, lo, fr = float(e['lat']), float(e['lon']), e.get('from')
        except (KeyError, TypeError, ValueError):
            continue
        if fr is None or grid.near(la, lo, 2):
            continue
        cont = bool(e.get('continues'))
        to = None if cont else e.get('to')           # a town that still stands runs to today, under its last name
        names = [[max(YMIN, int(y)), n] for y, n in (e.get('names') or []) if y is not None]
        if len(names) < 2: names = []
        w = (e.get('links') or 20) * 20000 * (1 if e.get('kind') == 'city' else 0.6)
        rows.append([e['name'], '', round(la, 3), round(lo, 3), int(w), 0, None, max(YMIN, int(fr)),
                     None if to is None else int(to), names, e.get('qid'), e.get('wikipedia'), None,
                     1 if e.get('approx') else 0, 'c' if cont or to is None else 'r'])
        grid.add(la, lo); nres += 1

    # ---- Pleiades
    cand = []
    for x in prows.values():
        ft = set(x['featureTypes'].replace(' ', '').split(','))
        if not ft & SETTLE or x['locationPrecision'] != 'precise' or not x['reprLat']:
            continue
        if x['id'] in used_pl:
            continue
        name = clean(x['title'])
        if not name or NOT_TOWN.search(name) or name[0].islower() or len(name) > 28:
            continue
        spans = [per[k.strip()] for k in x['timePeriodsKeys'].split(',') if k.strip() in per]
        if not spans:
            continue
        old = [p for p in spans if p[1] <= 1500]
        if not old:
            continue                                   # known only from modern times
        fr = max(YMIN, min(p[0] for p in spans))
        to = max(p[1] for p in old)
        if fr >= to:
            continue
        later = any(p[1] > 1500 for p in spans)
        ruin = not later and 'archaeological-site' in ft
        conn = len([c for c in (x.get('connectsWith') or '').split(',') if c.strip()])
        w = (150000 if 'urban' in ft else 40000 if ft & {'port', 'fortified-settlement'} else 20000) + 8000 * min(conn, 8)
        cand.append((w, name, float(x['reprLat']), float(x['reprLong']), fr, to, x['id'], ruin))
    cand.sort(key=lambda c: -c[0])
    npl = 0
    for w, name, la, lo, fr, to, pid, ruin in cand:
        if grid.near(la, lo, 1.0 if w < 150000 else 2.0):
            continue
        rows.append([name, '', round(la, 3), round(lo, 3), w, 0, None, fr, to, [], None, None, pid, 1, 'r' if ruin else 'c'])
        grid.add(la, lo); npl += 1

    rows = join_modern(rows, have)
    with open(os.path.join(DATA, 'cities.js'), 'w', encoding='utf-8') as f:
        f.write('window.HA_DATA=window.HA_DATA||{};window.HA_DATA.cities2=')
        json.dump(have, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    rows.sort(key=lambda r: -r[4])
    with open(os.path.join(DATA, 'towns.js'), 'w', encoding='utf-8') as f:
        f.write('window.HA_TOWNS=')
        json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';if(window.HA_ONTOWNS)window.HA_ONTOWNS();\n')
    print('TOWNS BUILT: %d from research, %d from Pleiades (%d ruins); %.0f kB' % (
        nres, npl, sum(1 for r in rows if r[14] == 'r'), os.path.getsize(os.path.join(DATA, 'towns.js')) / 1024))

NEW_WORLD = {'United States of America', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru',
             'Venezuela', 'Ecuador', 'Bolivia', 'Paraguay', 'Uruguay', 'Guatemala', 'Honduras', 'El Salvador',
             'Nicaragua', 'Costa Rica', 'Panama', 'Cuba', 'Dominican Republic', 'Haiti', 'Jamaica', 'Puerto Rico',
             'Trinidad and Tobago', 'Guyana', 'Suriname', 'Belize', 'The Bahamas', 'Australia', 'New Zealand',
             'Papua New Guinea', 'Fiji', 'Israel', 'Russia', 'Ukraine', 'Belarus', 'Kazakhstan', 'Uzbekistan',
             'Kyrgyzstan', 'Tajikistan', 'Turkmenistan', 'Azerbaijan', 'Armenia', 'Georgia', 'Moldova', 'Latvia',
             'Lithuania', 'Estonia'}

def fold(s):
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'^(ancient|old|the)\s+', '', s)
    return re.sub(r'[^a-z]', '', s)

def switch_year(la, lo):
    if lo < 2 and la > 49.5: return 410                        # Britain
    if la > 35 and lo < 16: return 476                         # Gaul, Iberia, Italy, the Rhine and Danube
    if la < 37.5 and lo > -10 and not (lo < 16 and la > 35): return 640   # Africa, Egypt, the Levant
    if lo < 29 and la >= 39: return 600                        # the Balkans
    return 1100                                                # Anatolia and the Caucasus

def classical(la, lo):
    if lo > 8.5 and la > 48.3 and lo < 30: return False         # beyond the Rhine and Danube frontier
    return -10 <= lo <= 45 and 25 <= la <= 56

def footprint(pop):
    return max(2.0, min(20.0, 3.0 * math.sqrt(max(pop, 1) / 100000.0)))

def join_modern(rows, have):
    wd = json.load(open(os.path.join(RAW, 'wd_places.json'), encoding='utf-8'))
    ne = [r for r in csv.DictReader(open(os.path.join(RAW, 'ne_places', 'places_full.csv'), encoding='utf-8'))
          if float(r['POP_MAX'] or 0) >= 50000 and r['WIKIDATAID'].startswith('Q')]
    # ---- the modern places: the atlas's own cities, then Natural Earth's others
    modern = [r for r in have if r[1]]
    known_q = set(r[10] for r in modern if r[10])
    mgrid = Grid()
    for r in modern: mgrid.add(r[2], r[3])
    added = []
    for x in sorted(ne, key=lambda x: -float(x['POP_MAX'])):
        q, la, lo = x['WIKIDATAID'], float(x['LATITUDE']), float(x['LONGITUDE'])
        if q in known_q or mgrid.near(la, lo, 3):
            continue
        d = wd.get(q, {})
        st = d.get('start') if d.get('start') is not None else d.get('rec')
        if st is not None and st >= 1850 and x['ADM0NAME'] not in NEW_WORLD:
            st = None                                   # a municipal date, most likely
        row = [x['NAME'], x['ADM0NAME'], round(la, 3), round(lo, 3), int(float(x['POP_MAX'])), 0, None, st,
               d.get('end'), [], q, d.get('wp'), None, 0, 'm']
        added.append(row); modern.append(row); mgrid.add(la, lo); known_q.add(q)
    # ---- evidence: Pleiades ids and 'replaces' links on the modern items
    by_pl, by_rep = {}, {}
    for r in modern:
        d = wd.get(r[10] or '', {})
        for pl in d.get('pleiades', []): by_pl.setdefault(str(pl), []).append(r)
        for rq in d.get('replaces', []): by_rep.setdefault(rq, []).append(r)
    cells = {}
    for r in modern:
        cells.setdefault((int(math.floor(r[2] * 2)), int(math.floor(r[3] * 2))), []).append(r)
    def nearby(la, lo, dmax):
        k = (int(math.floor(la * 2)), int(math.floor(lo * 2)))
        out = []
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for r in cells.get((k[0] + i, k[1] + j), ()):
                    dd = km((la, lo), (r[2], r[3]))
                    if dd < dmax: out.append((dd, r))
        return sorted(out, key=lambda t: t[0])
    joined, keep, cand = {}, [], []
    for t in rows:
        m, how = None, ''
        for r in by_pl.get(str(t[12] or ''), []):
            if km((t[2], t[3]), (r[2], r[3])) < 25: m, how = r, 'pleiades id'; break
        if not m and t[10]:
            for r in by_rep.get(t[10], []):
                if km((t[2], t[3]), (r[2], r[3])) < 25: m, how = r, 'replaces'; break
        if not m:
            for dd, r in nearby(t[2], t[3], 10):
                if fold(r[0]) == fold(t[0]): m, how = r, 'same name'; break
        if m:
            joined.setdefault(id(m), (m, []))[1].append((t, how))
            continue
        for dd, r in nearby(t[2], t[3], 20):
            if dd < footprint(r[4]):
                cand.append('%s\t%s\t%s\t%.1f\t%s' % (t[0], r[0], r[1], dd, t[12] or t[10] or ''))
                break
        keep.append(t)
    names_given = 0
    for m, ts in joined.values():
        ts.sort(key=lambda x: (x[1] != 'pleiades id', x[0][7]))
        t = ts[0][0]
        first = min(x[0][7] for x in ts)
        while len(m) < 15: m.append(None)
        beyond = t[3] > 8.5 and t[2] > 48.3 and t[3] < 30        # Roman finds beyond the frontier do not date a later town
        if not beyond and (m[7] is None or first < m[7]):
            m[7] = first
            m[13] = 1
        a, b = fold(t[0]), fold(m[0])
        if not m[9] and t[12] and classical(t[2], t[3]) and difflib.SequenceMatcher(None, a, b).ratio() < 0.6                 and not (a in b or b in a):
            sw = switch_year(t[2], t[3])
            if t[7] < sw:
                m[9] = [[t[7], t[0], 1], [sw, m[0], 1]]; names_given += 1
        if not m[12] and t[12]:
            m[12] = t[12]
    with open(os.path.join(HERE, 'work', 'town_city_candidates.tsv'), 'w', encoding='utf-8') as f:
        f.write('ancient town\tmodern city\tcountry\tkm\tpleiades or wikidata id\n' + '\n'.join(cand) + '\n')
    print('MODERN: %d places added from Natural Earth; %d ancient towns joined to %d modern cities (%d given '
          'earlier names); %d candidates left for review' % (len(added), sum(len(v[1]) for v in joined.values()),
          len(joined), names_given, len(cand)))
    return keep + added

if __name__ == '__main__':
    main()
