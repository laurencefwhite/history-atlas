"""Check the dates behind data_overrides.json against Wikipedia, sentence by sentence.

For each case, fetch the article's plain text and print the first sentence that contains both the year
and one of the keywords, so every correction rests on a quoted source. Results go to work/date_checks.tsv.
"""
import os, re, json, time, sys
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'history-atlas-build/0.3 (https://github.com/laurencefwhite/history-atlas)'
API = 'https://en.wikipedia.org/w/api.php'

# (key, article, year, keywords)
CASES = [
    ('Oman', 'Oman', None, r'protectorate|never|independen|colon'),
    ('UAE', 'United Arab Emirates', '1971', r'independen|formed|established|federation'),
    ('Qatar', 'Qatar', '1971', r'independen|protectorate'),
    ('Bahrain', 'Bahrain', '1971', r'independen|protectorate'),
    ('Suriname', 'Suriname', '1975', r'independen'),
    ('Japan', 'Occupation of Japan', '1952', r'end|San Francisco|sovereign'),
    ('South Korea', 'South Korea', '1948', r'established|republic|government|independen'),
    ('West Germany', 'West Germany', '1955', r'sovereign|occupation|Bonn|Paris'),
    ('Paris Peace Accords', 'Paris Peace Accords', '1973', r'withdraw|troops|signed'),
    ('Iraq sovereignty', 'Coalition Provisional Authority', '2004', r'sovereignty|dissolved|transfer|Interim'),
    ('Newfoundland', 'Newfoundland and Labrador', '1949', r'Canada|confederat|join'),
    ('New Zealand', 'Statute of Westminster Adoption Act 1947', '1947', r'adopt|Statute'),
    ('Kenya', 'Kenya', '1963', r'independen'),
    ('Uganda', 'Uganda', '1962', r'independen'),
    ('Zambia', 'Zambia', '1964', r'independen'),
    ('Botswana', 'Botswana', '1966', r'independen'),
    ('Malawi', 'Malawi', '1964', r'independen'),
    ('Lesotho', 'Lesotho', '1966', r'independen'),
    ('The Gambia', 'The Gambia', '1965', r'independen'),
    ('Zanzibar', 'Sultanate of Zanzibar', '1963', r'independen|British'),
    ('Kuwait', 'Kuwait', '1961', r'independen|protectorate'),
    ('Cyprus', 'Cyprus', '1960', r'independen'),
    ('Solomon Islands', 'Solomon Islands', '1978', r'independen'),
    ('Fiji', 'Fiji', '1970', r'independen'),
    ('Bahamas', 'The Bahamas', '1973', r'independen'),
    ('Belize', 'Belize', '1981', r'independen'),
    ('Brunei', 'Brunei', '1984', r'independen'),
    ('Dominica', 'Dominica', '1978', r'independen'),
    ('Saint Lucia', 'Saint Lucia', '1979', r'independen'),
    ('Guyana', 'Guyana', '1966', r'independen'),
    ('Djibouti', 'Djibouti', '1977', r'independen'),
    ('Cape Verde', 'Cape Verde', '1975', r'independen|Portug'),
    ('Equatorial Guinea', 'Equatorial Guinea', '1968', r'independen'),
    ('Guinea-Bissau', 'Guinea-Bissau', '1974', r'independen|recogni'),
    ('Dominican Republic', 'Dominican Restoration War', '1865', r'Spain|Spanish|withdr|restor|annex'),
    ('Syria / UAR', 'United Arab Republic', '1961', r'Syria|secession|coup|dissol'),
    ('Luxembourg', 'Luxembourg', '1890', r'personal union|Netherlands|Dutch'),
    ('Iceland', 'Danish–Icelandic Act of Union', '1918', r'sovereign|kingdom|union|recogni'),
    ('Bolivia', 'Bolivia', '1825', r'independen'),
    ('Memel', 'Klaipėda Revolt', '1923', r'Lithuania|annex|revolt'),
    ('Piedmont', 'Kingdom of Sardinia', '1802', r'annex|France|French|Piedmont'),
    ('Papal States', 'Papal States', '1809', r'annex|France|French|Napoleon'),
    ('Taiwan', 'Taiwan', '1949', r'Republic of China|retreat|government|Kuomintang|ROC'),
]

def text(title):
    r = requests.get(API, params={'action': 'query', 'prop': 'extracts', 'explaintext': 1, 'redirects': 1,
                                  'titles': title, 'format': 'json'}, headers={'User-Agent': UA}, timeout=60)
    pages = r.json()['query']['pages']
    pg = list(pages.values())[0]
    return pg.get('title', title), pg.get('extract', '') or ''

out = []
for key, art, year, kw in CASES:
    try:
        title, t = text(art)
    except Exception as e:
        out.append((key, art, year or '', 'FETCH FAILED: %s' % e)); continue
    sents = re.split(r'(?<=[.!?])\s+(?=[A-Z])', t.replace('\n', ' '))
    hit = ''
    for s_ in sents:
        if (year is None or year in s_) and re.search(kw, s_, re.I):
            hit = s_.strip(); break
    out.append((key, title, year or '', hit[:300] if hit else 'NO SENTENCE FOUND'))
    time.sleep(0.4)

with open(os.path.join(HERE, 'work', 'date_checks.tsv'), 'w', encoding='utf-8') as f:
    f.write('case\tarticle\tyear\tsentence\n')
    for row in out:
        f.write('\t'.join(row) + '\n')
for key, title, year, s_ in out:
    print('%-20s %-5s %s' % (key, year, s_[:230]))
