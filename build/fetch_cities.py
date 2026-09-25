"""Dates for the atlas's cities, from Wikidata, cached once in raw/wd_cities.json.

Each city in the list the atlas inherits from the world clock (Natural Earth populated places) is matched to
Natural Earth's full file by name and position, which carries a Wikidata id. For each id: inception (P571),
dissolved or abolished (P576), and time of earliest written record (P1249), as years. Wikidata writes BCE
years as negatives (753 BCE is -753), as Cliopatria does.
"""
import csv, json, math, os, time
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
BASE = os.path.normpath(os.path.join(HERE, '..', 'data', 'base.js'))
OUT = os.path.join(RAW, 'wd_cities.json')
UA = 'history-atlas-build/0.5 (https://github.com/laurencefwhite/history-atlas)'

def load_cities():
    s = open(BASE, encoding='utf-8').read()
    return json.loads(s.split('Object.assign(window.HA_DATA,', 1)[1].rsplit(');', 1)[0])['cities']

def match(cities):
    rows = list(csv.DictReader(open(os.path.join(RAW, 'ne_places', 'places_full.csv'), encoding='utf-8')))
    out = {}
    for c in cities:
        best, bd = None, 9
        for r in rows:
            try: la, lo = float(r['LATITUDE']), float(r['LONGITUDE'])
            except ValueError: continue
            if abs(la - c[2]) > 0.5: continue
            dd = math.hypot(la - c[2], (lo - c[3]) * math.cos(math.radians(la)))
            named = r['NAME'] == c[0] or r['NAMEASCII'] == c[0]
            if dd < 0.3 and (named or dd < 0.05) and dd < bd:
                bd, best = dd, r
        if best and best['WIKIDATAID'].startswith('Q'):
            out['%s|%.3f|%.3f' % (c[0], c[2], c[3])] = best['WIKIDATAID']
    return out

QUERY = """
SELECT ?c ?p (MIN(YEAR(?t)) AS ?y) (MAX(YEAR(?t)) AS ?ymax) WHERE {
  VALUES ?c { %s }
  VALUES ?p { wdt:P571 wdt:P576 wdt:P1249 }
  ?c ?p ?t .
  FILTER(DATATYPE(?t) = xsd:dateTime)
} GROUP BY ?c ?p
"""

def run(batch):
    q = QUERY % ' '.join('wd:' + i for i in batch)
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
    return []

def main():
    cities = load_cities()
    ids = match(cities)
    print('cities', len(cities), 'matched', len(ids), flush=True)
    qs = sorted(set(ids.values()))
    dates = {}
    for i in range(0, len(qs), 150):
        for row in run(qs[i:i + 150]):
            c = row['c']['value'].rsplit('/', 1)[-1]
            p = row['p']['value'].rsplit('/', 1)[-1]
            d = dates.setdefault(c, {})
            if p == 'P576': d[p] = int(row['ymax']['value'])       # the latest end, if there are several
            else: d[p] = int(row['y']['value'])                    # the earliest start
        time.sleep(1.5)
    json.dump({'ids': ids, 'dates': dates}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print('CITIES DONE', len(dates), 'of', len(qs), 'ids have a date ->', OUT, flush=True)

if __name__ == '__main__':
    main()
