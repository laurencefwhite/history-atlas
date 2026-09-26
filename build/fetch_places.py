"""Wikidata facts for Natural Earth's populated places of 50,000 people or more, and for the atlas's own modern
cities, cached once in raw/wd_places.json: inception (P571), earliest record (P1249), end (P576), Pleiades ids
(P1584, all of them), what the place replaces (P1365), its first-level division (P131 label) and its English
Wikipedia title. The Pleiades ids and 'replaces' links are the evidence build_towns.py uses to join an ancient
town to the modern city on its site.
"""
import csv, json, os, time
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
UA = {'User-Agent': 'history-atlas-build/0.5 (https://github.com/laurencefwhite/history-atlas)'}
MINPOP = 50000

def sparql(q):
    for a in range(6):
        try:
            r = requests.get('https://query.wikidata.org/sparql', params={'query': q, 'format': 'json'},
                             headers=dict(UA, Accept='application/sparql-results+json'), timeout=180)
            if r.status_code == 200:
                return r.json()['results']['bindings']
            print('  http', r.status_code, flush=True)
        except Exception as e:
            print('  err', e, flush=True)
        time.sleep(8 * (a + 1))
    return []

def main():
    rows = [r for r in csv.DictReader(open(os.path.join(RAW, 'ne_places', 'places_full.csv'), encoding='utf-8'))
            if r['WIKIDATAID'].startswith('Q') and float(r['POP_MAX'] or 0) >= MINPOP]
    ids = json.load(open(os.path.join(RAW, 'wd_cities.json'), encoding='utf-8'))['ids']
    qs = sorted(set(r['WIKIDATAID'] for r in rows) | set(ids.values()))
    print('places', len(rows), 'ids', len(qs), flush=True)
    out = {}
    for i in range(0, len(qs), 100):
        vals = ' '.join('wd:' + q for q in qs[i:i + 100])
        for b in sparql("""SELECT ?c (MIN(YEAR(?s)) AS ?st) (MIN(YEAR(?r)) AS ?rec) (MAX(YEAR(?e)) AS ?en)
            (GROUP_CONCAT(DISTINCT ?pl; separator=",") AS ?pls) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?rp), "entity/"); separator=",") AS ?reps)
            (SAMPLE(?wt) AS ?wp) WHERE { VALUES ?c { %s }
            OPTIONAL { ?c wdt:P571 ?s . FILTER(DATATYPE(?s) = xsd:dateTime) }
            OPTIONAL { ?c wdt:P1249 ?r . FILTER(DATATYPE(?r) = xsd:dateTime) }
            OPTIONAL { ?c wdt:P576 ?e . FILTER(DATATYPE(?e) = xsd:dateTime) }
            OPTIONAL { ?c wdt:P1584 ?pl } OPTIONAL { ?c wdt:P1365 ?rp }
            OPTIONAL { ?a schema:about ?c ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wt }
          } GROUP BY ?c""" % vals):
            q = b['c']['value'].rsplit('/', 1)[-1]
            g = lambda k: int(b[k]['value']) if k in b and b[k]['value'] else None
            out[q] = {'start': g('st'), 'rec': g('rec'), 'end': g('en'),
                      'pleiades': [x for x in b.get('pls', {}).get('value', '').split(',') if x],
                      'replaces': [x for x in b.get('reps', {}).get('value', '').split(',') if x],
                      'wp': b.get('wp', {}).get('value')}
        print(' ', min(i + 100, len(qs)), flush=True)
        time.sleep(1.5)
    json.dump(out, open(os.path.join(RAW, 'wd_places.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print('PLACES DONE', len(out), 'with a Pleiades id', sum(1 for v in out.values() if v['pleiades']), flush=True)

if __name__ == '__main__':
    main()
