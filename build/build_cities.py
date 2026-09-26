"""Cities through time for the history atlas: data/cities.js.

Two sources, joined:

- The modern list the atlas inherited (Natural Earth populated places, 732 cities), dated from Wikidata by
  fetch_cities.py: a city appears from its inception (P571), or failing that its earliest written record
  (P1249), and leaves at its dissolution (P576). A city with no date is shown in every year, as before.
- Ancient and extinct cities: Wikidata places linked to Pleiades (P1584), or classed as ancient or lost
  cities, with articles in at least MIN_LINKS Wikipedia languages. Start: Wikidata inception, earliest record,
  or Pleiades' first period (no earlier than the atlas's 3400 BCE). End: Wikidata's dissolution, or - for a
  place both sources treat as a ruin - the end of its last period in Pleiades before the modern ones.
- Only extinct places become dots of their own: those Wikidata gives an end date, or that Wikidata or
  Pleiades treat as a ruin. Towns of ancient origin that still stand are left to the modern list.
- Names over time come from checked tables, never from matching by distance, which could not tell a
  predecessor (Constantinople for Istanbul, 10 km from Natural Earth's point) from a neighbour (Fiesole for
  Florence, 5 km): build/city_names.json (from merge_city_names.py, every year with its basis), then
  build/city_overrides.json, which wins. An extinct place within 30 km bearing one of a city's earlier names
  is that city, not a dot of its own.

Wikipedia-language counts stand in for population where there is none, for label priority.
Writes data/cities.js and work/cities_report.tsv.
"""
import csv, gzip, io, json, math, os, re, time
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
RAW, WORK = os.path.join(HERE, 'raw'), os.path.join(HERE, 'work')
DATA = os.path.normpath(os.path.join(HERE, '..', 'data'))
UA = 'history-atlas-build/0.5 (https://github.com/laurencefwhite/history-atlas)'
MIN_LINKS, LINK_KM, YMIN = 25, 5.0, -3400
RUIN = {'Q839954', 'Q15661340', 'Q2974842', 'Q109607', 'Q350895', 'Q1266818'}   # archaeological site, ancient city, lost city, ruins, abandoned village, ancient Maya site
# Wikidata classes of a place that still stands (city, town, municipality and their national forms): a place
# carrying any of these is living, whatever else it is classed as or whatever end date an old incarnation has
LIVING = {'Q515', 'Q1549591', 'Q747074', 'Q484170', 'Q116457956', 'Q42744322', 'Q3957', 'Q2074737', 'Q667509',
          'Q15284', 'Q70208', 'Q5153359', 'Q532', 'Q902814', 'Q493522', 'Q2264924', 'Q21869758', 'Q15105893',
          'Q562061', 'Q2716259', 'Q16127605', 'Q89487741', 'Q56557504', 'Q15303838', 'Q134626', 'Q13539802',
          'Q51929311', 'Q16124843', 'Q1187811', 'Q7819319', 'Q7841907', 'Q15978299', 'Q5119', 'Q200250',
          'Q1637706', 'Q1093829', 'Q3184121'}
# not cities at all: kingdoms, regions, provinces, peoples
NOT_CITY = {'Q3024240', 'Q1620908', 'Q182547', 'Q82794', 'Q28171280', 'Q4204501', 'Q3502482', 'Q56061'}

def sparql(q):
    for attempt in range(6):
        try:
            r = requests.get('https://query.wikidata.org/sparql', params={'query': q, 'format': 'json'},
                             headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'}, timeout=180)
            if r.status_code == 200:
                return r.json()['results']['bindings']
            print('  http', r.status_code, flush=True)
        except Exception as e:
            print('  err', e, flush=True)
        time.sleep(8 * (attempt + 1))
    raise SystemExit('Wikidata query failed')

def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))

# ------------------------------------------------------------------ the ancient places, from Wikidata (cached)
def ancient_places():
    cache = os.path.join(RAW, 'wd_ancient.json')
    if os.path.exists(cache):
        return json.load(open(cache, encoding='utf-8'))
    ids = set()
    for b in sparql("""SELECT DISTINCT ?c WHERE { { ?c wdt:P1584 ?p } UNION
        { VALUES ?cls { wd:Q15661340 wd:Q2974842 } ?c wdt:P31 ?cls }
        ?c wikibase:sitelinks ?n . FILTER(?n >= %d) }""" % MIN_LINKS):
        ids.add(b['c']['value'].rsplit('/', 1)[-1])
    ids = sorted(ids)
    print('ancient candidates', len(ids), flush=True)
    out = {}
    for i in range(0, len(ids), 120):
        vals = ' '.join('wd:' + x for x in ids[i:i + 120])
        for b in sparql("""SELECT ?c ?cl ?coord ?n (MIN(YEAR(?a)) AS ?start) (MIN(YEAR(?r)) AS ?rec) (MAX(YEAR(?e)) AS ?end)
            (SAMPLE(?pl) AS ?pleiades) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?t), "entity/"); separator=",") AS ?types) WHERE {
            VALUES ?c { %s } ?c wikibase:sitelinks ?n .
            OPTIONAL { ?c rdfs:label ?cl . FILTER(LANG(?cl) = "en") }
            OPTIONAL { ?c wdt:P625 ?coord } OPTIONAL { ?c wdt:P1584 ?pl } OPTIONAL { ?c wdt:P31 ?t }
            OPTIONAL { ?c wdt:P571 ?a } OPTIONAL { ?c wdt:P1249 ?r } OPTIONAL { ?c wdt:P576 ?e }
          } GROUP BY ?c ?cl ?coord ?n""" % vals):
            q = b['c']['value'].rsplit('/', 1)[-1]
            if q in out or 'coord' not in b or 'cl' not in b:
                continue
            m = re.match(r'Point\(([-\d.eE]+) ([-\d.eE]+)\)', b['coord']['value'])
            if not m:
                continue
            g = lambda k: int(b[k]['value']) if k in b else None
            out[q] = {'name': b['cl']['value'], 'lon': float(m.group(1)), 'lat': float(m.group(2)),
                      'links': int(b['n']['value']), 'start': g('start'), 'rec': g('rec'), 'end': g('end'),
                      'pleiades': b['pleiades']['value'] if 'pleiades' in b else None,
                      'types': b['types']['value'].split(',') if 'types' in b else []}
        time.sleep(1.5)
    json.dump(out, open(cache, 'w', encoding='utf-8'), ensure_ascii=False)
    return out

# ------------------------------------------------------------------ Pleiades: places and period ranges
def pleiades():
    rows = {x['id']: x for x in csv.DictReader(gzip.open(os.path.join(RAW, 'pleiades', 'pleiades-places-latest.csv.gz'), 'rt', encoding='utf-8'))}
    page = os.path.join(RAW, 'pleiades', 'time-periods.html')
    if not os.path.exists(page):
        open(page, 'w', encoding='utf-8').write(requests.get('https://pleiades.stoa.org/vocabularies/time-periods',
                                                             headers={'User-Agent': UA}, timeout=60).text)
    s = open(page, encoding='utf-8', errors='replace').read()
    per = {}
    for key, e1, y1, e2, y2 in re.findall(r'href="time-periods/([^"]+)">[^<]*?\((AD|BC) ([\d,]+) -\s*(AD|BC) ([\d,]+)\)</a>', s):
        y1, y2 = int(y1.replace(',', '')), int(y2.replace(',', ''))
        per[key] = (-y1 if e1 == 'BC' else y1, -y2 if e2 == 'BC' else y2)
    # periods the page words differently: their range from the places that belong to that period alone
    single = {}
    for x in rows.values():
        ks = [k.strip() for k in x['timePeriodsKeys'].split(',') if k.strip()]
        if len(ks) == 1 and x['timePeriodsRange'] and ks[0] not in per:
            a, b = x['timePeriodsRange'].split(',')
            single.setdefault(ks[0], (int(float(a)), int(float(b))))
    per.update(single)
    return rows, per

def main():
    base = open(os.path.join(DATA, 'base.js'), encoding='utf-8').read()
    modern = json.loads(base.split('Object.assign(window.HA_DATA,', 1)[1].rsplit(');', 1)[0])['cities']
    wdc = json.load(open(os.path.join(RAW, 'wd_cities.json'), encoding='utf-8'))
    anc = ancient_places()
    prows, per = pleiades()
    print('periods parsed', len(per), '| ancient places', len(anc), flush=True)
    ovr = json.load(open(os.path.join(HERE, 'city_overrides.json'), encoding='utf-8')) if os.path.exists(os.path.join(HERE, 'city_overrides.json')) else {}

    # ---- the modern list, dated
    cities = []
    modern_q = {}
    for c in modern:
        q = wdc['ids'].get('%s|%.3f|%.3f' % (c[0], c[2], c[3]))
        d = wdc['dates'].get(q, {}) if q else {}
        start = d.get('P571', d.get('P1249'))
        city = {'name': c[0], 'country': c[1], 'lat': c[2], 'lon': c[3], 'pop': c[4], 'rank': c[5], 'state': c[6],
                'from': start, 'to': d.get('P576'), 'names': [], 'q': q, 'kind': 'modern', 'why': 'wikidata' if start is not None else 'undated'}
        cities.append(city)
        if q: modern_q[q] = city

    # ---- the ancient places: settlements only, dated by the rules above
    ancient = []
    for q, a in anc.items():
        p = prows.get(a['pleiades']) if a['pleiades'] else None
        ftypes = (p['featureTypes'] if p else '').replace(' ', '').split(',')
        settlement = any(t in ('settlement', 'urban', 'port') for t in ftypes)
        ruin = bool(RUIN & set(a['types'])) or 'archaeological-site' in ftypes
        if p and not settlement:
            continue                                   # a temple, a region, a river
        if not p and not ruin:
            continue
        start = a['start'] if a['start'] is not None else a['rec']
        keys = [k.strip() for k in (p['timePeriodsKeys'] if p else '').split(',') if k.strip() in per]
        spans = sorted(per[k] for k in keys)
        if start is None and spans:
            start = max(YMIN, spans[0][0])
        if LIVING & set(a['types']) or NOT_CITY & set(a['types']):
            continue                                   # still standing, or not a city
        if start is None:
            continue                                   # cannot be placed in time
        if a['end'] is None and not ruin:
            continue                                   # still standing: the modern list's business
        end = a['end']
        if end is not None and end > 1800:
            end = None                                 # an administrative change to the site, not the city's end
        if end is None and ruin and spans:
            old = [s for s in spans if s[1] <= 1500]
            if old and any(s[0] >= 1500 for s in spans):
                end = max(s[1] for s in old)            # its last ancient period, before the modern ones
        ancient.append({'name': a['name'], 'lat': a['lat'], 'lon': a['lon'], 'links': a['links'], 'from': start,
                        'to': end, 'q': q, 'ruin': ruin, 'pleiades': a['pleiades']})

    # ---- names over time from the checked table (merge_city_names.py), then hand corrections, which win
    byname = {c['name']: c for c in cities}
    bykey = {(c['name'], c['country']): c for c in cities}
    absorbed = []
    cn = os.path.join(HERE, 'city_names.json')
    for key, o in (json.load(open(cn, encoding='utf-8')) if os.path.exists(cn) else {}).items():
        c = bykey.get(tuple(key.split('|', 1)))
        if not c:
            print('  ! city_names.json: no such city %s' % key); continue
        c['names'] = [list(x) for x in o['names']]          # [year, name] or [year, name, 1] where the year is approximate
        first = o['names'][0][0]
        if c['from'] is None or first < c['from']:
            c['from'] = first
        absorbed += [(x[1], c['lat'], c['lon']) for x in o['names']]
    for name, o in ovr.get('modern', {}).items():
        c = byname.get(name)
        if not c:
            print('  ! override for %s: no such city' % name); continue
        if 'from' in o: c['from'] = o['from']
        if 'to' in o: c['to'] = o['to']
        if 'names' in o:
            c['names'] = [[y, n] for y, n in o['names']]
            absorbed += [(n, c['lat'], c['lon']) for y, n in o['names']]
        c['why'] = 'override: ' + o.get('why', '')
    for name, o in ovr.get('extinct', {}).items():
        hit = [x for x in ancient if x['name'] == name or (o.get('qid') and x['q'] == o['qid'])]
        if o.get('drop'):
            for x in hit: x['to'] = None                   # not a city of its own: left out below
            continue
        if hit:
            for k in ('from', 'to', 'lat', 'lon', 'links'):
                if k in o: hit[0][k] = o[k]
            hit[0]['name'] = name
            if o.get('wikipedia'): hit[0]['wp'] = o['wikipedia']
            if o.get('names'): hit[0]['names'] = o['names']
            if o.get('approx'): hit[0]['approx'] = True
            hit[0]['why'] = 'override: ' + o.get('why', '')
        elif 'lat' in o:
            ancient.append({'name': name, 'lat': o['lat'], 'lon': o['lon'], 'links': o.get('links', 60), 'from': o['from'],
                            'to': o.get('to'), 'q': o.get('qid') or 'added:' + name, 'ruin': True, 'wp': o.get('wikipedia'),
                            'pleiades': o.get('pleiades'), 'names': o.get('names', []), 'approx': o.get('approx', False),
                            'why': 'added: ' + o.get('why', '')})
        else:
            print('  ! extinct override for %s: not in the data and no position given' % name)
    used = set(x['q'] for x in ancient for n, la, lo in absorbed
               if x['name'] == n and km((x['lat'], x['lon']), (la, lo)) < 30)   # an earlier name of a city, not a dot of its own

    # ---- the rest stand on their own, one dot per place (the most notable of any within 2 km)
    extinct = []
    for a in sorted(ancient, key=lambda x: -x['links']):
        if a['q'] in used or a['to'] is None:
            continue                                   # absorbed, or no known end (a dot would stand to this day)
        if any(km((a['lat'], a['lon']), (b['lat'], b['lon'])) < 2 for b in extinct):
            continue
        extinct.append(a)

    # ---- English Wikipedia titles, for the card's links
    qs = sorted(set(x['q'] for x in cities + extinct if x.get('q') and x['q'].startswith('Q')))
    tp = os.path.join(RAW, 'wd_enwiki_titles.json')
    titles = json.load(open(tp, encoding='utf-8')) if os.path.exists(tp) else {}
    need = [q for q in qs if q not in titles]
    for i in range(0, len(need), 50):
        r = requests.get('https://www.wikidata.org/w/api.php', params={'action': 'wbgetentities', 'ids': '|'.join(need[i:i + 50]),
                         'props': 'sitelinks', 'sitefilter': 'enwiki', 'format': 'json'}, headers={'User-Agent': UA}, timeout=90).json()
        for q in need[i:i + 50]:
            titles[q] = r.get('entities', {}).get(q, {}).get('sitelinks', {}).get('enwiki', {}).get('title')
        time.sleep(0.5)
    if need:
        json.dump(titles, open(tp, 'w', encoding='utf-8'), ensure_ascii=False)

    # ---- out: [name, country, lat, lon, pop, rank, state, from, to, [[year, earlier name], ...], wikidata id,
    #            English Wikipedia title, Pleiades id]
    rows = []
    for c in cities:
        names = c['names']
        rows.append([c['name'], c['country'], c['lat'], c['lon'], c['pop'], c['rank'], c['state'], c['from'], c['to'], names,
                     c['q'], titles.get(c['q']), None])
    for a in extinct:
        q = a['q'] if a['q'].startswith('Q') else None
        rows.append([a['name'], '', round(a['lat'], 3), round(a['lon'], 3), a['links'] * 20000, 0, None, a['from'], a['to'], a.get('names') or [],
                     q, a.get('wp') or titles.get(q), a.get('pleiades'), 1 if a.get('approx') else 0, 'r'])
    with open(os.path.join(DATA, 'cities.js'), 'w', encoding='utf-8') as f:
        f.write('window.HA_DATA=window.HA_DATA||{};window.HA_DATA.cities2=')
        json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    with open(os.path.join(WORK, 'cities_report.tsv'), 'w', encoding='utf-8') as f:
        f.write('kind\tname\tfrom\tto\tearlier names\tlinks_or_pop\twhy\n')
        for c in sorted(cities, key=lambda c: -c['pop']):
            f.write('modern\t%s\t%s\t%s\t%s\t%s\t%s\n' % (c['name'], c['from'], c['to'], '; '.join('%s %s' % (n[1], n[0]) for n in c['names']), c['pop'], c['why']))
        for a in extinct:
            f.write('ancient\t%s\t%s\t%s\t\t%s\t%s\n' % (a['name'], a['from'], a['to'], a['links'], a.get('why') or ('ruin' if a['ruin'] else 'ended')))
    print('CITIES BUILT: %d modern (%d dated, %d with names over time), %d extinct; %.0f kB' % (
        len(cities), sum(1 for c in cities if c['from'] is not None), sum(1 for c in cities if c['names']), len(extinct),
        os.path.getsize(os.path.join(DATA, 'cities.js')) / 1024), flush=True)

if __name__ == '__main__':
    main()
