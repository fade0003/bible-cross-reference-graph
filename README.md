# Bible Cross-Reference Graph

A standalone Node.js/Express app that renders the Bible's cross-references as an
interactive force-directed graph on an HTML5 canvas, drilling down from
Books → Chapters → Verses. Node size reflects how many cross-reference
linkages touch that node.

## Run it

```bash
cd bible-graph
npm install
npm start
```

Then open http://localhost:3300 (override with `PORT=xxxx npm start`).

## Static build (GitHub Pages)

`docs/` is a fully static, client-side build of this same app - no server -
served by GitHub Pages (repo Settings → Pages → Deploy from branch → `main` /
`/docs`). `docs/graph-core.js` is a client-side port of `lib/loadData.js` +
`lib/graphBuilders.js` + the `/api/search` handler (same algorithms, fetch()
instead of fs reads, everything built once in-browser at load time instead of
per-request). `docs/app.js` is `public/app.js` with its `fetch('/api/...')`
calls swapped for direct calls into `graph-core.js`.

`docs/data/` holds the static data those calls run against:
`books.json` and `cross_references.txt` are copied straight from `data/`;
`bible-text.json` is a leaner re-encoding of `data/sources/KJVA.json` (nested
`book → chapter → verse text` arrays, dropping the redundant per-verse
`"Book chapter:verse"` name string that doubles KJVA.json's size). Regenerate
it after any data change with:

```bash
node scripts/build-static.js
```

Keep `docs/app.js`/`docs/graph-core.js` in sync by hand if you change
`public/app.js`, `lib/loadData.js`, `lib/graphBuilders.js`, or the `/api/search`
logic in `server.js` - the static build isn't code-generated from them.

## Data & licensing notes

- **Verse text**: King James Version, including the Apocrypha (public domain).
  ESV was the version originally requested, but the ESV API's terms cap
  displayed/cached text at 500 verses and forbid building a bulk offline
  database — incompatible with a graph spanning the whole Bible. KJV(A) was
  used instead by explicit choice.
- **Canonical cross-references** (~344,800 links across the 66-book Protestant
  canon): originally compiled by [openbible.info](https://www.openbible.info/labs/cross-references/)
  (CC BY 4.0), sourced here via the
  [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases)
  mirror (`data/sources/cross_references.txt`).
- **Apocrypha cross-references**: no open verse-level cross-reference dataset
  exists for the Apocrypha. `data/curated-apocrypha-crossrefs.json` is a small,
  hand-curated set (~24 links) of well-known textual/narrative relationships
  between apocryphal and canonical books — not exhaustive, and clearly marked
  as editorial in the UI and in the data file itself.
- **Book text source**: `data/sources/KJVA.json`, also via
  scrollmapper/bible_databases (`data/sources/LICENSE-bible_databases.txt`).

## Architecture

- `lib/loadData.js` — loads books/verse text/cross-references into memory once
  at startup and builds adjacency + aggregate indices.
- `lib/graphBuilders.js` — turns those indices into book-level, chapter-level,
  and verse-level graph payloads on demand.
- `server.js` — Express API (`/api/graph/books`, `/api/graph/book/:bookId`,
  `/api/graph/chapter/:bookId/:chapter`, `/api/verse/:bookId/:chapter/:verse`,
  `/api/search`) plus static hosting of `public/`.
- `public/app.js` — vanilla-JS canvas force-directed graph (drag, pan, zoom),
  side panel with verse text and cross-reference list, breadcrumb drill-down,
  and a "minimum link strength" slider (chapter/verse views can otherwise get
  dense, since a single popular verse can have 90+ real linkages).

Range-type cross-references (e.g. `Prov.8.22-Prov.8.30`) are graphed as a
single edge to the start verse of the range; the full range is shown in the
UI text.
