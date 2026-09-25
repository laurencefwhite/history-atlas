"""Merge the checked tables of names over time (work/renames/out_<region>.json) into city_names.json, which
build_cities.py reads, and write a review table (CSV, opens in Excel) to the notes folder.

Each checked entry gives a city's chain of names, [year the name came into use, name], ending in the atlas's own
name for the city, and for every year its basis: 'sourced' (a Wikipedia sentence), 'convention' (a gradual,
undated change placed by a stated rule), 'approx' (a circa date or a century) or 'memory' (no sentence found).
Entries that fail the checks here (the chain out of order, the last name not the city's) are reported and left out.
"""
import csv, datetime, glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
NOTES = os.path.normpath(os.path.join(HERE, '..', 'notes'))

def main():
    js = open(os.path.join(HERE, '..', 'data', 'cities.js'), encoding='utf-8').read()
    rows = json.loads(js.split('cities2=', 1)[1].rstrip().rstrip(';'))
    known = {(r[0], r[1]) for r in rows if r[1]}
    out, table, bad = {}, [], []
    for fn in sorted(glob.glob(os.path.join(HERE, 'work', 'renames', 'out_*.json'))):
        region = os.path.basename(fn)[4:-5]
        for e in json.load(open(fn, encoding='utf-8')):
            key = (e.get('city'), e.get('country'))
            names = e.get('names') or []
            basis = {(b.get('name'), b.get('year')): b for b in e.get('basis', [])}
            why = []
            if names:
                if key not in known: why.append('no such city')
                if names[-1][1] != e['city']: why.append('last name is not the city')
                ys = [n[0] for n in names]
                if ys != sorted(ys) or len(set(ys)) != len(ys): why.append('years out of order')
                if any(not isinstance(y, int) for y in ys): why.append('a year is not a whole number')
            if why:
                bad.append('%s (%s): %s' % (e.get('city'), region, ', '.join(why)))
            elif names:
                rough = lambda y, n: basis.get((n, y), {}).get('kind') in ('convention', 'approx', 'memory')
                out['%s|%s' % key] = {'from': e.get('from'),
                                      'names': [[max(-3400, y), n] + ([1] if rough(y, n) else []) for y, n in names]}
            for i, (y, n) in enumerate(names or [[None, '']]):
                b = basis.get((n, y), {})
                table.append([e.get('city'), e.get('country'), region, 'yes' if names and not why else 'no',
                              ' > '.join('%s (%s)' % (nm, yr) for yr, nm in names) if i == 0 else '',
                              n, y if y is not None else '', b.get('kind', ''), b.get('article', ''), b.get('quote', ''),
                              (e.get('note') or '') if i == 0 else '',
                              '; '.join(': '.join(map(str, r)) if isinstance(r, list) else str(r) for r in e.get('rejected', [])) if i == 0 else ''])
    json.dump(out, open(os.path.join(HERE, 'city_names.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    p = os.path.join(NOTES, 'city_names_%s.csv' % stamp)
    with open(p, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['City', 'Country', 'Region', 'Used', 'Chain', 'Name', 'Year taken', 'Basis', 'Wikipedia article',
                    'Quote', 'Note', 'Candidates rejected'])
        w.writerows(table)
    kinds = {}
    for t in table:
        if t[7]: kinds[t[7]] = kinds.get(t[7], 0) + 1
    print('NAMES MERGED: %d cities with names over time; years by basis %s; table %s' % (len(out), kinds, p))
    for b in bad:
        print('  ! left out:', b)

if __name__ == '__main__':
    main()
