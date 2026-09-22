#!/bin/sh
# Raw inputs for the history atlas. Run once, from build/.
set -e
mkdir -p raw
cd raw
curl -sL -o cliopatria.geojson.zip \
  https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/v0.2.0/cliopatria.geojson.zip
unzip -o -q cliopatria.geojson.zip
cd ..
python fetch_wikidata.py      # caches raw/wd_succession.json
