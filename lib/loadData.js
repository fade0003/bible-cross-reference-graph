'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, '..', 'data');

function parseRef(ref) {
  // "1Chr.16.26" -> { bookId: "1Chr", chapter: 16, verse: 26 }
  const parts = ref.split('.');
  const verse = parseInt(parts.pop(), 10);
  const chapter = parseInt(parts.pop(), 10);
  const bookId = parts.join('.');
  return { bookId, chapter, verse };
}

function verseKey(bookId, chapter, verse) {
  return `${bookId}.${chapter}.${verse}`;
}

function loadBooksAndText() {
  const books = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'books.json'), 'utf8'));
  const kjva = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sources', 'KJVA.json'), 'utf8'));

  const booksById = new Map();
  const verseText = new Map();
  const chapterMeta = new Map(); // bookId -> [{chapter, verseCount}]

  books.forEach((book, i) => {
    booksById.set(book.id, book);
    const kjvaBook = kjva.books[i];
    const chapters = [];
    for (const ch of kjvaBook.chapters) {
      chapters.push({ chapter: ch.chapter, verseCount: ch.verses.length });
      for (const v of ch.verses) {
        verseText.set(verseKey(book.id, ch.chapter, v.verse), v.text);
      }
    }
    chapterMeta.set(book.id, chapters);
  });

  return { books, booksById, verseText, chapterMeta };
}

async function loadCrossReferences(booksById) {
  const filePath = path.join(DATA_DIR, 'sources', 'cross_references.txt');
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, 'utf8') });

  const edges = [];
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (lineNo === 1) continue; // header
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 3) continue;
    const [fromRaw, toRaw, votesRaw] = cols;
    const from = parseRef(fromRaw);
    if (!booksById.has(from.bookId)) continue;

    let toStartRaw = toRaw;
    let toEndRaw = null;
    if (toRaw.includes('-')) {
      const idx = toRaw.indexOf('-');
      toStartRaw = toRaw.slice(0, idx);
      toEndRaw = toRaw.slice(idx + 1);
    }
    const toStart = parseRef(toStartRaw);
    if (!booksById.has(toStart.bookId)) continue;
    const toEnd = toEndRaw ? parseRef(toEndRaw) : null;

    edges.push({
      id: edges.length,
      curated: false,
      votes: parseInt(votesRaw, 10) || 0,
      from,
      to: toStart,
      toEnd,
    });
  }
  return edges;
}

function loadCuratedApocrypha(booksById, startId) {
  const raw = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'curated-apocrypha-crossrefs.json'), 'utf8')
  );
  const edges = [];
  for (const link of raw.links) {
    const from = parseRef(link.from);
    const to = parseRef(link.to);
    const toEnd = link.toEnd ? parseRef(link.toEnd) : null;
    if (!booksById.has(from.bookId) || !booksById.has(to.bookId)) continue;
    edges.push({
      id: startId + edges.length,
      curated: true,
      note: link.note,
      votes: null,
      from,
      to,
      toEnd,
    });
  }
  return edges;
}

function buildIndices(edges) {
  // adjacency: verseKey -> [{ edgeId, otherKey, votes, curated, direction }]
  const adjacency = new Map();
  const bookPairCounts = new Map(); // "bookA|bookB" (sorted) -> count, excludes self-pairs
  const bookDegree = new Map(); // bookId -> endpoint count
  const chapterPairCounts = new Map(); // bookId -> "chA|chB" -> count (same-book only)
  const chapterDegree = new Map(); // bookId -> Map(chapter -> endpoint count)
  const crossBookChapterLinks = new Map(); // bookId -> Map(otherBookId -> count)
  const chapterExternalLinks = new Map(); // bookId -> Map(chapter -> Map(otherBookId -> count))

  function addAdj(key, entry) {
    if (!adjacency.has(key)) adjacency.set(key, []);
    adjacency.get(key).push(entry);
  }

  function bump(map, key, n = 1) {
    map.set(key, (map.get(key) || 0) + n);
  }

  for (const e of edges) {
    const fromKey = verseKey(e.from.bookId, e.from.chapter, e.from.verse);
    const toKey = verseKey(e.to.bookId, e.to.chapter, e.to.verse);

    addAdj(fromKey, { edgeId: e.id, otherKey: toKey, votes: e.votes, curated: e.curated, dir: 'out' });
    addAdj(toKey, { edgeId: e.id, otherKey: fromKey, votes: e.votes, curated: e.curated, dir: 'in' });

    bump(bookDegree, e.from.bookId);
    bump(bookDegree, e.to.bookId);

    if (!chapterDegree.has(e.from.bookId)) chapterDegree.set(e.from.bookId, new Map());
    if (!chapterDegree.has(e.to.bookId)) chapterDegree.set(e.to.bookId, new Map());
    bump(chapterDegree.get(e.from.bookId), e.from.chapter);
    bump(chapterDegree.get(e.to.bookId), e.to.chapter);

    if (e.from.bookId === e.to.bookId) {
      const a = Math.min(e.from.chapter, e.to.chapter);
      const b = Math.max(e.from.chapter, e.to.chapter);
      if (!chapterPairCounts.has(e.from.bookId)) chapterPairCounts.set(e.from.bookId, new Map());
      bump(chapterPairCounts.get(e.from.bookId), `${a}|${b}`);
    } else {
      const [a, b] = [e.from.bookId, e.to.bookId].sort();
      bump(bookPairCounts, `${a}|${b}`);

      if (!crossBookChapterLinks.has(e.from.bookId)) crossBookChapterLinks.set(e.from.bookId, new Map());
      if (!crossBookChapterLinks.has(e.to.bookId)) crossBookChapterLinks.set(e.to.bookId, new Map());
      bump(crossBookChapterLinks.get(e.from.bookId), e.to.bookId);
      bump(crossBookChapterLinks.get(e.to.bookId), e.from.bookId);

      if (!chapterExternalLinks.has(e.from.bookId)) chapterExternalLinks.set(e.from.bookId, new Map());
      if (!chapterExternalLinks.get(e.from.bookId).has(e.from.chapter)) {
        chapterExternalLinks.get(e.from.bookId).set(e.from.chapter, new Map());
      }
      bump(chapterExternalLinks.get(e.from.bookId).get(e.from.chapter), e.to.bookId);

      if (!chapterExternalLinks.has(e.to.bookId)) chapterExternalLinks.set(e.to.bookId, new Map());
      if (!chapterExternalLinks.get(e.to.bookId).has(e.to.chapter)) {
        chapterExternalLinks.get(e.to.bookId).set(e.to.chapter, new Map());
      }
      bump(chapterExternalLinks.get(e.to.bookId).get(e.to.chapter), e.from.bookId);
    }
  }

  return {
    adjacency,
    bookPairCounts,
    bookDegree,
    chapterPairCounts,
    chapterDegree,
    crossBookChapterLinks,
    chapterExternalLinks,
  };
}

let cached = null;

async function getData() {
  if (cached) return cached;
  const { books, booksById, verseText, chapterMeta } = loadBooksAndText();
  const canonicalEdges = await loadCrossReferences(booksById);
  const curatedEdges = loadCuratedApocrypha(booksById, canonicalEdges.length);
  const edges = canonicalEdges.concat(curatedEdges);
  const indices = buildIndices(edges);

  cached = {
    books,
    booksById,
    verseText,
    chapterMeta,
    edges,
    stats: {
      totalEdges: edges.length,
      canonicalEdges: canonicalEdges.length,
      curatedEdges: curatedEdges.length,
      totalVerses: verseText.size,
    },
    ...indices,
  };
  return cached;
}

module.exports = { getData, parseRef, verseKey };
