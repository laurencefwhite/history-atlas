---
title: History Atlas
subtitle: A globe of world history on a time scrubber
---

**Live:** https://laurencefwhite.github.io/history-atlas/ (v0.2, prototype)

One globe, one timeline. Drag the ribbon along the bottom to choose a year and the globe shows who held
what, from 3400 BCE to 2024 CE. Each political lineage has its own hue and each polity within it a shade,
so a line of succession holds its colour across the whole scrub. Hover a polity and the card names it,
gives its succession path, and lifts the rest of its lineage out of the map.

This is the prototype stage of the design sketched in `..\history-atlas\world-history-atlas-sketch_20260921.md`.
It answers one question — whether scrubbing through history on this globe is compelling — and deliberately
leaves out everything in the sketch that is not needed to answer it.

# What it does

- **The scrubber.** A ribbon of five unequal eras (Bronze Age, Classical, Medieval, Early modern, Modern),
  linear within each, so the last five centuries get the room their detail needs. Drag it, wheel over it,
  step with the arrow keys by the era's own unit, or press space to play. The year reads out in the masthead.
  Behind the ribbon, a faint curve shows how many polities were about in each period.
- **The globe.** Canvas orthographic globe with drag, momentum, pinch and wheel zoom, fly-to, and the
  near-side fast path carried over from the river valleys atlas, which is what makes a redraw on every
  scrub tick affordable.
- **Colour.** A hue per lineage, assigned greedily over a graph of which lineages were ever neighbours in
  space while alive at the same time, weighted by the length of the shared border times the years it was
  shared. Lineages that never met may share a hue. Blue is kept for water. Within a lineage, lightness
  steps gently from earliest to latest, so a lineage reads as one colour that ages.
- **Minor polities.** Anything standing too small on the screen to read keeps its hue but loses almost all
  its chroma, and takes no label. Zoom in and the threshold falls, so the muted patchwork of the Holy
  Roman Empire resolves into its own colours once it fills the window.
- **The card.** Short name, then the succession path — `Roman Kingdom > Roman Republic > Roman Empire /
  Eastern Roman Empire`, where `>` is the same polity under a new form and `/` a branch — then the dates
  of the row under the pointer, the entity's whole span, its area, and a Wikipedia link. Click to pin the
  card (which makes the link usable), click elsewhere or press Escape to release. A pinned card follows
  its polity as the scrubber moves.
- **Pinning a line.** A pinned card holds the line of succession, not just the polity. Scrub into a year when
  a predecessor or successor is on the map and the card moves to it, the path extends through to it with
  its name in white, and the polity first pinned keeps a dotted underline. When nothing of the line is on the
  map the card stays open and says why. The ribbon shows the pinned polity's years as a band in its colour,
  and the whole line as segments in their own shades, each labelled with the year it began.
- **Cards keep clear.** Every card sits wholly clear of its polity on screen, with a margin, and never over
  the timeline. A hover card waits until the pointer stops or slows right down, so sweeping across a map of
  many states does not flash a card for each; a click shows one at once.
- **Ocean names**, in spaced capitals, printed along their parallels so they curve with the globe.
- **Spin.** Off by default. When on, the space bar or a click on sea, sky or unheld land pauses and resumes it.
- **Search.** Find a polity by name; it sets the year to the middle of that polity's span and flies to it.
  Cities are searchable too.
- **Layers.** Polities, borders, minor-polity muting, polity names, modern borders (off by default, as a
  faint reference), cities, city names, graticule, slow spin (off — a spinning globe fights the scrubber).

# What it does not do

Every border is crisp and every change is a cut. There are no soft or feathered edges, no precision
grades, no peoples without states, no deep time, no core sample, no events, no period cities, no WebGL
and no morphing between keyframes. Those belong to the later stages in the sketch.

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
  relationships rather than territory. They are the raw material for the "manner of holding" layer in the
  sketch, which is a later stage.

Two further facts about the file, checked rather than assumed. Rows of one entity never overlap in time,
though 427 pairs leave a gap, so an entity can be absent from the map for a period and return. Polygons of
*different* entities do overlap in places, which is legitimate; the larger is drawn first and the smaller
over it, and the hit test takes the smallest polygon containing the point.

Cliopatria counts years as plain integers and does use 0. Historians do not, so year 0 is shown as 1 BCE.

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

That yields 1,129 lineages over 1,540 entities. Hand corrections live in `build\lineage_overrides.json`,
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
python build_data.py            # about 2.5 minutes, needs roughly 4 GB of memory
```

`build_data.py` writes `data\base.js` (entities, lineages, hues, countries, cities) and two files per time
chunk. Chunks are 500 years before 0 CE, 250 years to 1500, and 100 years after, nineteen in all; a row
that spans a boundary appears in both chunks. Each chunk is simplified twice with mapshaper — about 8 km
for the world view and about 2 km for the cut that loads past zoom 3 — always with `keep-shapes` and never
dissolved, since overlapping polygons here are meaningful. The page loads the chunk under the scrubber and
its neighbours and keeps five in memory. Data comes to about 17 MB in all.

The files are plain script tags assigning into `window.HA_DATA`, so the page works from `file://` without
a server.

# Testing

`window.HA` exposes `year`, `setYear`, `setView`, `unitAt(lon, lat)`, `path(name)`, `live`, `tipHtml`,
`drawMs`, `chunksLoaded`, `play` and `opt`, for driving the page headlessly.

Checked with Playwright at 1600 × 1000: no console errors; the worst frame over a 200-year scrub at the
world view is about 33 ms and the worst settled frame about 29 ms; `unitAt` returns the Roman Empire at
Rome in 100 CE, the Tang at Chang'an in 700, the Inca at Cusco in 1500, the Mughals at Delhi in 1600 and
the First French Empire at Paris in 1812.

# Credits

Polity boundaries from [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria) (Seshat
Global History Databank), CC BY 4.0. Succession from [Wikidata](https://www.wikidata.org). Coastlines,
countries and cities from [Natural Earth](https://www.naturalearthdata.com). Built on the engine of the
river valleys atlas.

## Copyright

Code and page © 2026 Laurence F. White. The data credits above carry their own licences.
