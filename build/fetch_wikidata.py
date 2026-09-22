"""Fetch P1365 (replaces) / P1366 (replaced by) for every Cliopatria Wikidata id, once, into raw/."""
import json, os, time, sys
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'raw', 'cliopatria_polities_only.geojson')
OUT = os.path.join(HERE, 'raw', 'wd_succession.json')
ENDPOINT = 'https://query.wikidata.org/sparql'
UA = 'history-atlas-build/0.1 (https://github.com/laurencefwhite/history-atlas)'

def ids():
    seen = {}
    with open(SRC, 'r', encoding='utf-8') as f:
        for ft in json.load(f)['features']:
            p = ft['properties']
            q = (p.get('Wikidata') or '').strip()
            if q.startswith('Q'):
                seen.setdefault(q, set()).add(p['Name'])
    return seen

QUERY = """
SELECT ?a ?p ?b WHERE {
  VALUES ?a { %s }
  VALUES ?p { wdt:P1365 wdt:P1366 }
  ?a ?p ?b .
}
"""

def run(batch):
    q = QUERY % ' '.join('wd:' + i for i in batch)
    for attempt in range(6):
        try:
            r = requests.get(ENDPOINT, params={'query': q, 'format': 'json'},
                             headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'},
                             timeout=180)
            if r.status_code == 200:
                return r.json()['results']['bindings']
            print('  http', r.status_code, r.text[:200], flush=True)
        except Exception as e:
            print('  err', e, flush=True)
        time.sleep(8 * (attempt + 1))
    return []

def main():
    m = ids()
    qs = sorted(m)
    print('wikidata ids', len(qs), flush=True)
    edges = []
    B = 150
    for i in range(0, len(qs), B):
        batch = qs[i:i + B]
        rows = run(batch)
        for row in rows:
            a = row['a']['value'].rsplit('/', 1)[-1]
            b = row['b']['value'].rsplit('/', 1)[-1]
            p = row['p']['value'].rsplit('/', 1)[-1]
            edges.append([a, p, b])
        print('  batch %d/%d -> %d edges (total %d)' % (i // B + 1, (len(qs) + B - 1) // B, len(rows), len(edges)), flush=True)
        time.sleep(1.5)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'ids': {k: sorted(v) for k, v in m.items()}, 'edges': edges}, f)
    print('WIKIDATA DONE', len(edges), 'edges ->', OUT, flush=True)

main()
