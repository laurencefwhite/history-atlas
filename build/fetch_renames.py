"""Candidate earlier names for the atlas's modern cities, gathered for review into work/city_renames.tsv.

Sources, all cached in raw/renames/:
- Wikipedia's lists of renamed cities ('List of city name changes' and the per-country lists), whose lines
  read 'Old (year) -> Newer (year) -> [[Modern]] (year)', the year being when a name was taken;
- Wikipedia's lists of Latin place names (Britain, continental Europe, Italy, Iberia, the Balkans, Africa,
  Asia) and of Greek place names, which give the classical name without a date;
- Wikidata official names (P1448) with start and end times (P580, P582).
A name is matched to a city by the English Wikipedia article its list links to, redirects resolved, against
the article of the city's own Wikidata item. For a classical name that has an article of its own, Wikidata's
inception (P571), earliest record (P1249) and end (P576) are fetched for it.
"""
import json, os, re, time
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw', 'renames')
UA = {'User-Agent': 'history-atlas-build/0.5 (https://github.com/laurencefwhite/history-atlas)'}
CHAINS = ['List_of_city_name_changes', 'List_of_renamed_cities_and_towns_in_Russia', 'List_of_renamed_cities_in_Ukraine',
          'List_of_renamed_cities_in_Kazakhstan', 'List_of_renamed_cities_in_Uzbekistan', 'List_of_renamed_cities_in_Belarus',
          'List_of_renamed_cities_in_Armenia', 'List_of_cities_renamed_by_Azerbaijan', 'List_of_renamed_cities_in_Tajikistan',
          'List_of_renamed_cities_in_Kyrgyzstan', 'List_of_renamed_cities_in_Turkmenistan', 'List_of_renamed_cities_in_Latvia',
          'List_of_renamed_cities_in_Lithuania', 'List_of_renamed_cities_in_Estonia', 'List_of_renamed_populated_places_in_Moldova',
          'List_of_renamed_cities_and_municipalities_in_the_Philippines']
LATIN = ['List_of_Latin_place_names_in_Britain', 'List_of_Latin_names_for_cities_or_towns_in_Continental_Europ',
         'List_of_Latin_place_names_in_Italy_and_Malta', 'List_of_Latin_place_names_in_the_Balkans',
         'List_of_Latin_place_names_in_Africa', 'List_of_Latin_place_names_in_Asia', 'List_of_Latin_place_names_in_Iberia']
GREEK = 'List_of_Greek_place_names'

def api(params, url='https://en.wikipedia.org/w/api.php'):
    for a in range(5):
        try:
            r = requests.get(url, params=dict(params, format='json'), headers=UA, timeout=90)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            print('  err', e)
        time.sleep(5 * (a + 1))
    return {}

def sparql(q):
    for a in range(5):
        r = requests.get('https://query.wikidata.org/sparql', params={'query': q, 'format': 'json'},
                         headers=dict(UA, Accept='application/sparql-results+json'), timeout=180)
        if r.status_code == 200:
            return r.json()['results']['bindings']
        time.sleep(8 * (a + 1))
    return []

def cached(name, fn):
    p = os.path.join(RAW, name)
    if os.path.exists(p):
        return json.load(open(p, encoding='utf-8'))
    v = fn()
    json.dump(v, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
    return v

def wiki(name):
    return open(os.path.join(RAW, name + '.wiki'), encoding='utf-8').read()

LINK = re.compile(r'\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]')
def plain(s):
    s = LINK.sub(lambda m: m.group(2) or m.group(1), s)
    s = re.sub(r"\{\{[^{}]*\}\}|<ref[^>]*/>|<ref.*?</ref>|'''?|<[^>]+>", '', s)
    return re.sub(r'\s+', ' ', s).strip(' ,;')

YEAR = re.compile(r'\((?:c\.\s*|ca\.\s*|circa\s*)?(\d{1,4})(\s*(?:BC|BCE))?\)')
def seg_year(s):
    """the year a name was taken, from a trailing '(1924)' or '([[...|1924]])' after link text is flattened"""
    m = YEAR.search(plain(s))
    if not m:
        return None
    y = int(m.group(1))
    return -y if m.group(2) else y

def seg_name(s):
    t = plain(re.sub(r'\([^()]*\)', '', LINK.sub(lambda m: m.group(2) or m.group(1), s)))
    return t.split('/')[0].strip()

def seg_target(s):
    m = LINK.search(s)
    return m.group(1).strip() if m else None

def main():
    # ---- the atlas's cities and their English Wikipedia articles
    js = open(os.path.join(HERE, '..', 'data', 'cities.js'), encoding='utf-8').read()
    rows = json.loads(js.split('cities2=', 1)[1].rstrip().rstrip(';'))
    ids = json.load(open(os.path.join(HERE, 'raw', 'wd_cities.json'), encoding='utf-8'))['ids']
    city_q = {}
    for r in rows:
        if not r[1]:
            continue
        q = ids.get('%s|%.3f|%.3f' % (r[0], r[2], r[3]))
        if q:
            city_q[q] = r
    def titles():
        out, qs = {}, sorted(city_q)
        for i in range(0, len(qs), 50):
            d = api({'action': 'wbgetentities', 'ids': '|'.join(qs[i:i + 50]), 'props': 'sitelinks', 'sitefilter': 'enwiki'},
                    'https://www.wikidata.org/w/api.php')
            for q, e in d.get('entities', {}).items():
                t = e.get('sitelinks', {}).get('enwiki', {}).get('title')
                if t:
                    out[q] = t
            time.sleep(0.5)
        return out
    enwiki = cached('enwiki_titles.json', titles)
    by_title = {t: q for q, t in enwiki.items()}
    print('cities', len(city_q), 'with an English article', len(enwiki))

    # ---- parse the lists into (source, [(name, year, target)], modern target)
    found = []
    for pg in CHAINS:
        for line in wiki(pg).splitlines():
            if not line.startswith('*') or '→' not in line:
                continue
            segs = [s.strip() for s in line.lstrip('*').split('→')]
            parts = [(seg_name(s), seg_year(s), seg_target(s)) for s in segs]
            found.append(('chain', pg, parts))
    for pg in LATIN:
        for line in wiki(pg).splitlines():
            if not line.startswith('|') or '||' not in line or line.startswith('|-'):
                continue
            cells = line.lstrip('|').split('||')
            lat, mod = cells[0], cells[1]
            if re.match(r'\s*near\b', plain(mod)):
                continue                                # a site near the city, not the city
            names = [plain(x) for x in re.split(r',|\bor\b', LINK.sub(lambda m: m.group(2) or m.group(1),
                     re.sub(r'\([^()]*\)', '', lat)))]
            first = next((n for n in names if n), None)
            t0 = seg_target(lat)
            m = LINK.search(mod)
            if first and m:
                found.append(('latin', pg, [(first, None, t0), (plain(m.group(2) or m.group(1)), None, m.group(1).strip())]))
    for line in wiki(GREEK).splitlines():
        if not line.startswith('|') or '||' not in line:
            continue
        last = line.split('||')[-1]
        links = LINK.findall(last)
        if len(links) >= 2:
            found.append(('greek', GREEK, [(plain(x or t), None, t.strip()) for t, x in links]))

    # ---- resolve every linked article through redirects
    targets = sorted(set(p[2] for _, _, parts in found for p in parts if p[2]))
    def resolve():
        out = {}
        for i in range(0, len(targets), 50):
            d = api({'action': 'query', 'titles': '|'.join(targets[i:i + 50]), 'redirects': 1, 'prop': 'pageprops',
                     'ppprop': 'wikibase_item'})
            q = d.get('query', {})
            norm = {x['from']: x['to'] for x in q.get('normalized', [])}
            red = {x['from']: x['to'] for x in q.get('redirects', [])}
            pages = {p['title']: p.get('pageprops', {}).get('wikibase_item') for p in q.get('pages', {}).values()}
            for t in targets[i:i + 50]:
                a = norm.get(t, t); a = red.get(a, a)
                out[t] = [a, pages.get(a)]
            time.sleep(0.4)
        return out
    res = cached('resolved_targets.json', resolve)

    # ---- keep the lists' entries that end in (or pass through) one of the atlas's cities
    cand = {}
    for kind, pg, parts in found:
        for k, (nm, yr, tg) in enumerate(parts):
            if not tg or tg not in res:
                continue
            q = by_title.get(res[tg][0])
            if not q:
                continue
            if kind != 'chain' and k != len(parts) - 1:
                continue
            chain = [(n, y, res.get(t, [None, None])[1] if t else None) for n, y, t in parts[:k + 1]]
            if kind == 'chain' and k != len(parts) - 1:
                chain = [(n, y, res.get(t, [None, None])[1] if t else None) for n, y, t in parts]
            if len(chain) < 2:
                continue
            cand.setdefault(q, []).append((kind, pg, chain))
            break

    # ---- Wikidata official names with dates
    def official():
        out = []
        qs = sorted(city_q)
        for i in range(0, len(qs), 150):
            out += sparql("""SELECT ?c ?n (YEAR(?s) AS ?ys) (YEAR(?e) AS ?ye) WHERE { VALUES ?c { %s }
              ?c p:P1448 ?st . ?st ps:P1448 ?n . FILTER(LANG(?n) IN ("en","la","mul") || true)
              OPTIONAL { ?st pq:P580 ?s } OPTIONAL { ?st pq:P582 ?e } }""" % ' '.join('wd:' + q for q in qs[i:i + 150]))
            time.sleep(1.5)
        return out
    off = cached('wd_official_names.json', official)
    offn = {}
    for b in off:
        q = b['c']['value'].rsplit('/', 1)[-1]
        ys = int(b['ys']['value']) if 'ys' in b else None
        ye = int(b['ye']['value']) if 'ye' in b else None
        if ys is None and ye is None:
            continue
        offn.setdefault(q, set()).add((b['n']['value'], b['n'].get('xml:lang', ''), ys, ye))

    # ---- dates for the classical names that have a Wikidata item of their own
    oldq = sorted(set(x[2] for v in cand.values() for _, _, ch in v for x in ch[:-1] if x[2]))
    def olddates():
        out = {}
        for i in range(0, len(oldq), 150):
            for b in sparql("""SELECT ?c ?p (MIN(YEAR(?t)) AS ?y) (MAX(YEAR(?t)) AS ?ym) WHERE { VALUES ?c { %s }
                  VALUES ?p { wdt:P571 wdt:P576 wdt:P1249 } ?c ?p ?t . FILTER(DATATYPE(?t) = xsd:dateTime) } GROUP BY ?c ?p"""
                            % ' '.join('wd:' + q for q in oldq[i:i + 150])):
                q = b['c']['value'].rsplit('/', 1)[-1]; p = b['p']['value'].rsplit('/', 1)[-1]
                out.setdefault(q, {})[p] = int(b['ym' if p == 'P576' else 'y']['value'])
            time.sleep(1.5)
        return out
    od = cached('wd_old_name_dates.json', olddates)

    # ---- the working table
    out = os.path.join(HERE, 'work', 'city_renames.tsv')
    n = 0
    with open(out, 'w', encoding='utf-8') as f:
        f.write('city\tcountry\tpop\tsource\tchain (name, year taken where the list gives one)\tdates of the classical name (Wikidata)\tofficial names (Wikidata P1448, dated)\n')
        for q, r in sorted(city_q.items(), key=lambda kv: -kv[1][4]):
            if q not in cand and q not in offn:
                continue
            n += 1
            offs = '; '.join('%s [%s] %s–%s' % (a, l, s if s is not None else '', e if e is not None else '')
                             for a, l, s, e in sorted(offn.get(q, []), key=lambda x: (x[2] or -99999)))
            lines = cand.get(q) or [('', '', [])]
            for kind, pg, ch in lines:
                cs = ' > '.join(nm + (' (%d)' % y if y is not None else '') for nm, y, _ in ch)
                dd = '; '.join('%s %s' % (nm, json.dumps(od.get(oq, {}))) for nm, _, oq in ch[:-1] if oq and oq in od)
                f.write('%s\t%s\t%d\t%s\t%s\t%s\t%s\n' % (r[0], r[1], r[4], kind + (':' + pg.replace('List_of_', '')[:40] if pg else ''),
                                                        cs, dd, offs))
                offs = ''
    print('RENAMES: %d cities with candidates -> %s' % (n, out))

if __name__ == '__main__':
    main()
