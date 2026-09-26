---
title: History Atlas
subtitle: A globe of world history on a time scrubber
---

**Live:** https://laurencefwhite.github.io/history-atlas/ (v0.7)

One globe, one timeline. Drag the ribbon along the bottom to choose a year and the globe shows who held
what, from 3400 BCE to 2024 CE. Each political lineage has its own hue and each polity within it a shade,
so a line of succession holds its colour across the whole scrub. Hover a polity and the card names it,
gives its succession path, and lifts the rest of its lineage out of the map.

It is an early stage of a larger design. For now every border is crisp and every change a cut, and several
things a historical atlas should show are still to come; *What it does not do yet* lists them.

# What it does

- **The scrubber.** A ribbon of five unequal eras (Bronze Age, Classical, Medieval, Early modern, Modern),
  linear within each, so the last five centuries get the room their detail needs. Drag it, wheel over it,
  step with the arrow keys by the era's own unit, or press space to play. The year reads out in the masthead.
  Behind the ribbon, a faint curve shows how many polities were about in each period.
- **The globe.** An orthographic globe with drag, momentum, pinch and wheel zoom and fly-to, drawn on the
  graphics card with WebGL where the browser allows and in 2D otherwise (see *Rendering*), so it redraws on
  every tick of the scrub without stutter.
- **Colour.** A hue per lineage, assigned greedily over a graph of which lineages were ever neighbours in
  space while alive at the same time, weighted by the length of the shared border times the years it was
  shared. Lineages that never met may share a hue. Blue is kept for water. Within a lineage, lightness
  steps gently from earliest to latest, so a lineage reads as one colour that ages.
- **Minor polities.** Anything standing too small on the screen to read keeps its hue but loses almost all
  its chroma, and takes no label. Zoom in and the threshold falls, so the muted patchwork of the Holy
  Roman Empire resolves into its own colours once it fills the window.
- **The card.** Short name, then the succession path — `Roman Kingdom > Roman Republic > Roman Empire /
  Eastern Roman Empire`, where `>` is the same polity under a new form and `/` a branch — then the dates
  of the row under the pointer, the entity's whole span and its area. Click to pin the card, click elsewhere
  or press Escape to release. A pinned card links to Wikipedia, Wikidata and the Seshat Global History
  Databank; Seshat keeps a record per phase, so the Roman Empire's card links to the Principate in 117 and
  the Dominate in 300. Every name in a pinned card's path can be clicked to go to that polity, and so can
  every segment of the pinned line on the ribbon.
- **Pinning a line.** A pinned card holds the line of succession, not just the polity. Scrub into a year when
  a predecessor or successor is on the map and the card moves to it, the path extends through to it with
  its name in white, and the polity first pinned keeps a dotted underline. When nothing of the line is on the
  map the card stays open and says why. The ribbon shows the pinned polity's years as a band in its colour,
  and the whole line as segments in their own shades, each labelled with the year it began. A selection
  stays lifted, white border and all, while the globe is dragged or spins and while the year runs.
- **Cards keep clear.** Every card sits wholly clear of its polity on screen, with a margin, and never over
  the timeline. A hover card waits until the pointer stops or slows right down, so sweeping across a map of
  many states does not flash a card for each; a click shows one at once.
- **Ocean names**, in spaced capitals, printed along their parallels so they curve with the globe.
- **Spin.** Off by default. When on, the space bar or a click on sea, sky or unheld land pauses and resumes it.
- **Cities over time.** A city appears from its founding or first record and, if it was abandoned or
  destroyed, disappears at that date: Carthage to 698, Pompeii to 79, Teotihuacan about 100 BCE to 550 CE.
  Extinct cities are drawn in a warm tint while they stand; from the year they were abandoned or destroyed
  they stay on as ruins, a darkened dot with an italic name ("Ruins of Carthage" on the card), under the
  Ruined cities layer. Mere ruins that were never towns (a villa, a temple complex, a fortress) are left out.
- **Ancient towns.** About 10,500 towns of the ancient and medieval world, down to small ones, appear as you
  zoom in: some 9,800 from the Pleiades gazetteer for the Greek, Roman and Near Eastern world, and about 640
  researched from Wikipedia for East and Central Asia, South and South-East Asia, the Americas, Africa and
  Arabia, and northern and eastern Europe (Tikal, Tiwanaku, Loulan, Mohenjo-daro, Great Zimbabwe, Kilwa,
  Hedeby, Sarai). They thin out by screen density, the larger first. A Pleiades town is shown for the
  periods it is attested, with dates marked "about"; it becomes a ruin only where Pleiades types it an
  archaeological site with no later record, since Pleiades records evidence rather than fate. Nor does a
  town vanish when its record ends: Pleiades' Roman period closes in 300 and its coverage in about 640, so a
  town recorded to 300 or later is held to 640, one whose record ends earlier is held to its last record, and
  either then fades out, the larger towns (cities, ports, places on many roads) held longer and fading more
  slowly, into the high Middle Ages.
- **Continuity by default.** An ancient town inside a modern city's footprint (within 6 km) that is not
  recorded as ruined or abandoned is taken as that city's predecessor, one per city, so a city such as
  Zaragoza runs on from Caesaraugusta rather than vanishing in late antiquity and reappearing in 1500.
- **Smaller modern places.** Natural Earth's 3,500 further places of 50,000 people or more join the modern
  cities, thinned by screen density like the towns, so the present is drawn at the same depth as the past.
  An ancient town becomes the earlier name of the modern city on its site only on evidence (the city's
  Wikidata item carries the town's Pleiades id or says it replaces it, or the names match within 10 km):
  Nemausus and Nîmes, Mogontiacum and Mainz, Durocortorum and Reims. Other near neighbours stay separate. A click on a city pins its card, as for a polity, with links to Wikipedia, Wikidata and, for
  ancient places, Pleiades; the card stays with the city as the year moves, and says so when the city is not
  yet founded or already gone. 259 cities carry the name or spelling widely used
  at the time (Londinium, Lugdunum, Byzantium and Constantinople, Chang'an, Edo, Batavia, Léopoldville,
  Peking and Bombay before the modern forms), and the card lists them, marking years that are only
  approximate. A modern city with no reliable date appears from 1500.
- **Search.** Find a polity by name; it sets the year to the middle of that polity's span and flies to it.
  Cities are searchable too, by any name they have borne; a city not standing in the year sets the scrubber
  into its time.
- **Layers.** Polities, borders, minor-polity muting, polity names, modern borders (off by default, as a
  faint reference), cities, city names, ruined cities, graticule, slow spin (off — a spinning globe fights the scrubber).

# What it does not do yet

Every border is crisp and every change is a cut. There are no soft or feathered edges for borders nobody
could have drawn at the time, no grades of precision or confidence, no peoples without states, no
migrations, no battles or other events, no city sizes that change with the period, no deep time and no
morphing between keyframes. These are planned for later stages.

# Rendering

The heavy layers are drawn on the graphics card with WebGL 2 (`lib/globe-gl.js`, shared with the other
globes as they move across); a 2D canvas on top keeps the light ones – atmosphere, graticule, highlight
outlines, shading, labels and cities. Where WebGL 2 is missing, or the browser takes the context away, the
page draws everything in 2D as before; `?gl=0` forces that, for comparison.

- **Polities** are filled without being cut into triangles: each outline is drawn as a fan of triangles into
  the stencil buffer, then painted where the count came out odd. Shapes wholly on the near side are placed on
  the sphere by the vertex shader, from buffers uploaded once per chunk; the few crossing the limb are clipped
  by d3 first. Borders are drawn together in one call.
- **The land beneath**, where no polity is recorded, is looked up per pixel in a 4096 by 2048 image of the
  world's land made at load, out to zoom 2; beyond that it is drawn from outlines. Profiling showed that
  clipping the detailed coastline at the limb was two thirds of every frame, in 2D and WebGL alike.
- At the world view a frame while scrubbing takes about 3 ms against about 10 ms in 2D (measured headless
  on the machine's own graphics card), and the two renderers differ in under 0.2 per cent of pixels.
  `HA.profile(years, scrub)` breaks a frame down by layer.

# The data

**Cliopatria**, from the Seshat Global History Databank, released under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):
https://github.com/Seshat-Global-History-Databank/cliopatria (release v0.2.0, `cliopatria.geojson.zip`),
described in https://www.nature.com/articles/s41597-025-04516-9. 13,765 dated polygon records over 1,633
named entities. A record is a period during which an entity's shape was constant, so each one is already a
keyframe with a cut at either end.

Succession comes from **Wikidata** properties P1365 (*replaces*) and P1366 (*replaced by*), fetched once in
a batched SPARQL query and cached in `build\raw\wd_succession.json`.

Coastlines, modern country borders and the city list come from **Natural Earth**, by way of the river
valleys atlas's own base file.

## Cities and their dates

`build\fetch_cities.py` matches each of the 732 modern cities to Natural Earth's full populated-places file,
which carries a Wikidata id, and fetches inception (P571), earliest record (P1249) and end (P576).
`build\build_cities.py` adds extinct cities: Wikidata places with a Pleiades id (P1584) that Pleiades counts
as a settlement or either source counts as a ruin, excluding anything Wikidata also classes as a living
town. Their start is Wikidata's, or the start of their first Pleiades period; their end is Wikidata's, or
the end of their last Pleiades period before 1500. A place with no known end is left out rather than drawn
standing to this day. Dot size for an extinct city comes from the number of Wikipedia editions that cover it.

Wikidata's inception is often a municipal date (Osaka 1889, Hong Kong 1997), so `build\city_overrides.json`
corrects dates and gives names over time by hand, each with its reason and the Wikipedia sentence it rests
on; `build\verify_city_dates.py` checks those sentences. Cities whose only date is administrative are left
undated.

Names over time: `build\fetch_renames.py` gathers candidates from Wikipedia's lists of renamed cities, its
lists of Latin and Greek place names, and Wikidata's dated official names. Each region's candidates were
then checked against English Wikipedia and dated, and names the lists miss were added; the rule is the name
or spelling widely used at the time, not only formal renamings. Every year carries its basis: a quoted
Wikipedia sentence, a stated convention for gradual changes (a Latin name in the west runs to the end of
Roman rule there, 410 in Britain and 476 elsewhere, unless the city's history gives a better date), a circa
date, or, flagged, general knowledge. `build\merge_city_names.py` checks the tables and writes
`build\city_names.json`, which `build_cities.py` applies before the hand corrections. Of the 732 modern
cities 575 are dated and 259 have names over time; 174 extinct cities are added.

## What is drawn, and what is not

Cliopatria holds three kinds of row, and drawing all of them would cover the same ground two and three
times over. The rule used here, decided by looking at the file rather than assuming:

- **`Type = POLITY` with a plain name — drawn.** 12,043 rows over 1,540 entities.
- **`Type = POLITY` with a parenthesised name — not drawn.** These are aggregates: `(British Empire)`,
  `(Carolingian Empire)`, `(Anglo-Saxon England)`. There are 43 of them over 1,337 rows. Every one declares
  its parts in `Components`, and every part names its aggregate in `MemberOf`, so the members cover the same
  land exactly once instead of twice; on a sample of aggregate rows, none was covered less than 80 per cent
  by its own members. The membership is not thrown away — the card says which aggregate a polity was within.
- **`Type = RELATION` — not drawn.** 385 rows over 50 names, all parenthesised, all of the form
  `(Allegiance of X to Y)`, `(Alliance between X and Y)`, `(Personal union…)`, `(Vassalage…)`. These are
  relationships rather than territory. They are the raw material for a planned layer showing the manner of
  holding – vassals and tributaries hatched in their overlord's colour.

Two further facts about the file, checked rather than assumed. Rows of one entity never overlap in time,
though 427 pairs leave a gap, so an entity can be absent from the map for a period and return. Polygons of
*different* entities do overlap in places, which is legitimate; the larger is drawn first and the smaller
over it, and the hit test takes the smallest polygon containing the point.

Cliopatria counts years as plain integers and does use 0. Historians do not, so year 0 is shown as 1 BCE.

## Coastlines

Cliopatria's boundaries are drawn by hand at a coarse scale, so along a coast a shape often stops short of the
shore or runs out over the sea, and a coastal city could fall outside every polity (Barcelona in 1300).
`build\fit_coast.py` (see `coast.py`) fits every shape to the coastline the page draws: where a shape reaches
within 13 km of the sea it is extended over that coastal strip and trimmed to the land, so the coast becomes
its border. Land borders between polities are untouched. A city card also looks up to about 15 km around a
city whose point misses every shape.

## Corrections to Cliopatria

Cliopatria is a large hand-built dataset and has errors, most of them of one kind: a colonial power or a
federation whose shape still covers a country after that country became sovereign, so the two are drawn one
over the other for decades. The build lists every pair of shapes that overlap substantially while both are
alive in `build\work\overlap_report.tsv`; most are legitimate (principalities within Kievan Rus', vassals
within empires, wartime occupations), and the rest are corrected in `build\data_overrides.json`.

- **`clip`** removes one polity's ground from another's shapes over a span of years. The span starts at the
  date of sovereignty, or when the sovereign country's own shape begins in Cliopatria if that is later, so no
  ground is left empty; and it ends where the overlap ends, so a restored state keeps its ground. The cut uses
  only the shapes the other polity held during that span.
- **`rename`** gives a polity a new name from a year, continuing the same line.

There are 47 clips and three renames, each with its reason and, for the dates, the Wikipedia sentence it rests
on: France losing Algeria from 1962 and Djibouti after 1977; Britain the Gulf states, Kuwait, Cyprus and a
dozen African, Caribbean and Pacific countries after their independence; the United States Japan, South Korea,
West Germany, Vietnam and Iraq once each was sovereign; the Kingdom of Sardinia losing Piedmont to France in
1802 and the Papal States annexed in 1809; the People's Republic of China without Taiwan; "Mali
Federation" renamed Mali from 1961, since the federation lasted only from 1959 to 1960; "Denmark-Norway"
renamed Denmark from 1815, the union having ended with the Treaty of Kiel in 1814; and a stray "Estado Novo"
shape over Cabinda from 1979 given to Angola. The dates were checked
against Wikipedia by `build\verify_dates.py`, which writes the sentences to `build\work\date_checks.tsv`.

Each label is also placed on ground its polity actually shows: overlapping shapes are drawn larger first and
smaller over it, so a label anchored on the whole shape could land on a smaller neighbour drawn on top.

## The lineage graph

Edges come from Wikidata first, then from a fallback rule: entity B's first row begins within 25 years of
entity A's last row ending, and their shapes overlap. Every edge, however it was found, must then pass a
handover test — the successor begins about when the predecessor ends, and the two share ground.

Each entity keeps at most one *main predecessor*, the one most of it came out of, measured against the
successor's own area. Each entity hands its line on to at most one *continuation*, the successor that took
over most of it, measured against the predecessor's area. Measuring each ratio in its own direction matters:
measured the other way, a small splinter lying wholly inside a collapsing empire inherits the line ahead of
its real heir, which is how an early run had the Roman Empire continuing into the Kingdom of Soissons's
neighbours and the Russian Empire into Armenia. The successors that are not the continuation start lines of
their own, and remember the polity they branched from — the card shows it, the colour does not inherit it.

That yields 1,129 lineages over 1,541 entities (1,540 in Cliopatria, and Mali split from the Mali Federation). Hand corrections live in `build\lineage_overrides.json` and always outrank an automatic edge,
keyed by entity name. An `add` there is taken as authority and skips the handover test, because the cases
that need correcting are exactly the ones where the shapes do not line up: Cliopatria has the Rashidun
Caliphate and the Umayyads holding separate ground through the First Fitna, and the Sui already reduced to
a rump before the Tang began, so neither succession can be found geometrically.

The fifty largest lineages, with their members in order, are written to `build\work\lineage_report.tsv`,
and the cases worth checking to `build\work\lineage_cases.txt`.

# Building the data

Requires Python with `shapely`, `requests` and `numpy`, and Node for mapshaper. From `build\`:

```
npm install
curl -sL -o raw/cliopatria.geojson.zip \
  https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/v0.2.0/cliopatria.geojson.zip
cd raw && unzip cliopatria.geojson.zip && cd ..
python fetch_wikidata.py        # once; caches raw/wd_succession.json
python fetch_cities.py          # once; caches raw/wd_cities.json (needs raw/ne_places/places_full.csv)
python fetch_renames.py         # once; candidate earlier names, work/city_renames.tsv
python merge_city_names.py      # the checked tables of names to city_names.json
python build_cities.py          # writes data/cities.js; caches raw/wd_ancient.json and Pleiades periods
python build_towns.py           # writes data/towns.js from Pleiades and towns_research.json
python verify_dates.py          # optional: the Wikipedia sentences behind the correction dates
python fit_coast.py             # about 3 minutes on 8 processes; writes raw/cliopatria_coast.geojson
python build_data.py            # about 6 minutes, needs roughly 4 GB of memory
```

The corrections in `data_overrides.json` and `lineage_overrides.json` are applied as the build reads the
source, so a rebuild always includes them.

`build_data.py` writes `data\base.js` (entities, lineages, hues, countries, cities) and two files per time
chunk. Chunks are 500 years before 0 CE, 250 years to 1500, and 100 years after, nineteen in all; a row
that spans a boundary appears in both chunks. Each chunk is simplified twice with mapshaper — about 8 km
for the world view and about 2 km for the cut that loads past zoom 3 — always with `keep-shapes` and never
dissolved, since overlapping polygons here are meaningful. The page loads the chunk under the scrubber and
its neighbours and keeps five in memory. Data comes to about 17 MB in all.

The files are plain script tags assigning into `window.HA_DATA`, so the page works from `file://` without
a server.

# Testing

`window.HA` exposes, among others, `year`, `setYear`, `setView`, `unitAt(lon, lat)`, `path(name)`, `live`,
`tipHtml`, `pinned`, `pinByName`, `goTo`, `chunksLoaded`, `play`, `opt`, `renderer`, `drawMs`,
`drawMsSync` (waits for the graphics card) and `profile(years, scrub)`, for driving the page headlessly.

Checked with Playwright, headless on the machine's own graphics card (`--use-angle=d3d11 --enable-gpu`;
without it Chromium draws WebGL in software): no console errors in WebGL or 2D; a scrubbing frame at the
world view about 3 ms in WebGL and 10 ms in 2D; the two renderers differ in under 0.2 per cent of pixels;
`unitAt` returns the Roman Empire at Rome in 100 CE, the Tang at Chang'an in 700, the Inca at Cusco in 1500,
the Mughals at Delhi in 1600 and the First French Empire at Paris in 1812. Pinning, cards, links, the
ribbon, spin and the hover delay each have their own scripted checks.

# Credits

Polity boundaries from [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria) (Seshat
Global History Databank), CC BY 4.0. Succession and city dates from [Wikidata](https://www.wikidata.org).
Ancient places and their periods from [Pleiades](https://pleiades.stoa.org), CC BY 3.0. Coastlines,
countries and cities from [Natural Earth](https://www.naturalearthdata.com). Built on the engine of the
river valleys atlas.

## Copyright

Code and page © 2026 Laurence F. White. The data credits above carry their own licences.
