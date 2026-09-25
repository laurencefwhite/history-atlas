"""Check the dates in city_overrides.json against Wikipedia, sentence by sentence (as verify_dates.py does for
the polity corrections). Prints, for each claim, the first sentence of the article holding both the year and
one of the keywords; writes work/city_date_checks.tsv."""
import os, re, time, requests
HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'history-atlas-build/0.5 (https://github.com/laurencefwhite/history-atlas)'
CASES = [
    ('Istanbul: Byzantium founded', 'Byzantium', '667', r'found|settl|coloni'),
    ('Istanbul: Constantinople from 330', 'Constantinople', '330', r'dedicat|found|capital|inaugurat'),
    ('Istanbul: Ottoman conquest 1453', 'Fall of Constantinople', '1453', r'captur|fell|conquest|Ottoman'),
    ('Mexico City: Tenochtitlan founded', 'Tenochtitlan', '1325', r'found'),
    ('Mexico City: from 1521', 'Tenochtitlan', '1521', r'destroy|captur|fell|conquer|Spanish'),
    ('Tokyo: Edo 1457', 'Edo', '1457', r'castle|built|Ōta|Dōkan'),
    ('Tokyo: renamed 1868', 'Tokyo', '1868', r'renamed|capital|Edo'),
    ('Ho Chi Minh City: Saigon 1698', 'Ho Chi Minh City', '1698', r'Nguyễn|establish|found|Saigon|Gia Định'),
    ('Ho Chi Minh City: renamed 1976', 'Ho Chi Minh City', '1976', r'renamed|Ho Chi Minh'),
    ('Singapore 1819', 'Singapore', '1819', r'Raffles|found|establish'),
    ('Hong Kong 1841', 'Hong Kong', '1841', r'British|occup|colony|ceded'),
    ('Nagoya 1610', 'Nagoya', '1610', r'castle|Tokugawa|moved|capital'),
    ('Sapporo 1868', 'Sapporo', '1868', r'found|Hokkaido|settl|capital|develop'),
    ('Hiroshima 1589', 'Hiroshima', '1589', r'found|Mōri|castle|Terumoto'),
    ('Pompeii 79', 'Pompeii', '79', r'erupt|Vesuvius|buried|destroy'),
    ('Cahokia end', 'Cahokia', '1350', r'abandon|declin|decline|by'),
    ('Merv 1221', 'Merv', '1221', r'Mongol|destroy|sack|massacre'),
    ('Pripyat 1970', 'Pripyat', '1970', r'found|establish'),
    ('Pripyat 1986', 'Pripyat', '1986', r'evacuat|abandon|disaster'),
    ('Teotihuacan', 'Teotihuacan', '550', r'declin|destroy|burn|collapse|abandon|fire|sack'),
]
def text(t):
    r = requests.get('https://en.wikipedia.org/w/api.php', params={'action': 'query', 'prop': 'extracts', 'explaintext': 1,
                     'redirects': 1, 'titles': t, 'format': 'json'}, headers={'User-Agent': UA}, timeout=60)
    return list(r.json()['query']['pages'].values())[0].get('extract', '') or ''
out = []
for key, art, year, kw in CASES:
    t = re.sub(r'=+[^=]+=+', ' ', text(art).replace('\n', ' '))
    hit = next((s.strip() for s in re.split(r'(?<=[.!?])\s+(?=[A-Z])', t)
                if re.search(r'(?<!\d)' + year + r'(?!\d)', s) and re.search(kw, s, re.I)), '')
    out.append((key, art, year, hit[:260] or 'NO SENTENCE FOUND'))
    time.sleep(0.4)
with open(os.path.join(HERE, 'work', 'city_date_checks.tsv'), 'w', encoding='utf-8') as f:
    for row in out: f.write('\t'.join(row) + '\n')
for key, art, year, s in out: print('%-34s %s' % (key, s[:200]))
