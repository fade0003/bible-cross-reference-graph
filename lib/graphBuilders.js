'use strict';

const { verseKey } = require('./loadData');

function buildBookGraph(data) {
  const nodes = data.books.map((b) => ({
    id: b.id,
    label: b.name,
    category: b.category,
    apocryphal: b.apocryphal,
    size: data.bookDegree.get(b.id) || 0,
  }));

  const links = [];
  for (const [pairKey, weight] of data.bookPairCounts.entries()) {
    const [a, b] = pairKey.split('|');
    links.push({ source: a, target: b, weight });
  }

  return { nodes, links };
}

function buildChapterGraph(data, bookId) {
  const book = data.booksById.get(bookId);
  if (!book) return null;
  const chapters = data.chapterMeta.get(bookId) || [];
  const chDegree = data.chapterDegree.get(bookId) || new Map();

  const nodes = chapters.map((c) => ({
    id: `${bookId}.${c.chapter}`,
    label: `${book.name} ${c.chapter}`,
    chapter: c.chapter,
    verseCount: c.verseCount,
    external: false,
    size: chDegree.get(c.chapter) || 0,
  }));

  const links = [];
  const pairs = data.chapterPairCounts.get(bookId) || new Map();
  for (const [pairKey, weight] of pairs.entries()) {
    const [a, b] = pairKey.split('|');
    links.push({ source: `${bookId}.${a}`, target: `${bookId}.${b}`, weight });
  }

  // External book aggregate nodes + per-chapter edges into them
  const externalTotals = data.crossBookChapterLinks.get(bookId) || new Map();
  for (const [otherBookId, total] of externalTotals.entries()) {
    const otherBook = data.booksById.get(otherBookId);
    nodes.push({
      id: `ext:${otherBookId}`,
      label: otherBook.name,
      external: true,
      bookId: otherBookId,
      category: otherBook.category,
      apocryphal: otherBook.apocryphal,
      size: total,
    });
  }

  const chapterExternal = data.chapterExternalLinks.get(bookId) || new Map();
  for (const [chapter, otherMap] of chapterExternal.entries()) {
    for (const [otherBookId, weight] of otherMap.entries()) {
      links.push({ source: `${bookId}.${chapter}`, target: `ext:${otherBookId}`, weight });
    }
  }

  return { nodes, links, book };
}

function verseDegree(data, key, minVotes) {
  const adj = data.adjacency.get(key);
  if (!adj) return 0;
  if (minVotes === undefined || minVotes === null) return adj.length;
  return adj.filter((e) => e.curated || e.votes >= minVotes).length;
}

function buildVerseGraph(data, bookId, chapter, minVotes) {
  const book = data.booksById.get(bookId);
  if (!book) return null;
  const chapters = data.chapterMeta.get(bookId) || [];
  const chMeta = chapters.find((c) => c.chapter === chapter);
  if (!chMeta) return null;

  const nodeMap = new Map();
  const links = [];

  function ensureNode(bId, ch, v) {
    const key = verseKey(bId, ch, v);
    if (!nodeMap.has(key)) {
      const b = data.booksById.get(bId);
      nodeMap.set(key, {
        id: key,
        bookId: bId,
        chapter: ch,
        verse: v,
        label: `${b.name} ${ch}:${v}`,
        category: b.category,
        apocryphal: b.apocryphal,
        inFocus: bId === bookId && ch === chapter,
        size: verseDegree(data, key, minVotes),
        text: data.verseText.get(key) || null,
      });
    }
    return key;
  }

  const seenEdges = new Set();
  for (let v = 1; v <= chMeta.verseCount; v++) {
    const key = ensureNode(bookId, chapter, v);
    const adj = data.adjacency.get(key) || [];
    for (const e of adj) {
      if (!e.curated && minVotes !== undefined && minVotes !== null && e.votes < minVotes) continue;
      if (seenEdges.has(e.edgeId)) continue;
      seenEdges.add(e.edgeId);
      const other = data.edges[e.edgeId];
      const otherKey = e.dir === 'out' ? verseKey(other.to.bookId, other.to.chapter, other.to.verse)
        : verseKey(other.from.bookId, other.from.chapter, other.from.verse);
      const otherRef = e.dir === 'out' ? other.to : other.from;
      ensureNode(otherRef.bookId, otherRef.chapter, otherRef.verse);
      links.push({
        source: key,
        target: otherKey,
        votes: other.votes,
        curated: other.curated,
        note: other.note || null,
        rangeEnd: other.toEnd
          ? `${data.booksById.get(other.toEnd.bookId).name} ${other.toEnd.chapter}:${other.toEnd.verse}`
          : null,
      });
    }
  }

  return {
    book,
    chapter,
    verseCount: chMeta.verseCount,
    nodes: Array.from(nodeMap.values()),
    links,
  };
}

function verseDetail(data, bookId, chapter, verse, minVotes) {
  const book = data.booksById.get(bookId);
  if (!book) return null;
  const key = verseKey(bookId, chapter, verse);
  const text = data.verseText.get(key);
  if (text === undefined) return null;

  const adj = data.adjacency.get(key) || [];
  const connections = adj
    .filter((e) => e.curated || minVotes === undefined || minVotes === null || e.votes >= minVotes)
    .map((e) => {
      const edge = data.edges[e.edgeId];
      const other = e.dir === 'out' ? edge.to : edge.from;
      const otherBook = data.booksById.get(other.bookId);
      const otherKey = verseKey(other.bookId, other.chapter, other.verse);
      return {
        ref: `${otherBook.name} ${other.chapter}:${other.verse}`,
        key: otherKey,
        bookId: other.bookId,
        chapter: other.chapter,
        verse: other.verse,
        apocryphal: otherBook.apocryphal,
        votes: edge.votes,
        curated: edge.curated,
        note: edge.note || null,
        rangeEnd: edge.toEnd
          ? `${data.booksById.get(edge.toEnd.bookId).name} ${edge.toEnd.chapter}:${edge.toEnd.verse}`
          : null,
        text: data.verseText.get(otherKey) || null,
      };
    })
    .sort((a, b) => (b.votes || 0) - (a.votes || 0));

  return {
    key,
    book,
    chapter,
    verse,
    text,
    degree: adj.length,
    connections,
  };
}

module.exports = { buildBookGraph, buildChapterGraph, buildVerseGraph, verseDetail };
