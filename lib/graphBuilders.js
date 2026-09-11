'use strict';

const { verseKey, parseRef } = require('./loadData');

// Keep only each node's strongest edges so the force layout renders a
// readable graph instead of a near-complete mesh (raw book/chapter pair data
// is dense enough that drawing every edge produces an unreadable hairball).
// A global top-K cap would strand low-degree nodes with zero edges, which
// the physics then flings off-screen (nothing left to spring them back in) -
// keeping each node's own top-K neighbors instead guarantees every connected
// node keeps at least one edge.
function topEdgesPerNode(links, perNodeCap) {
  if (!perNodeCap) return links;
  const byNode = new Map();
  links.forEach((l, idx) => {
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    for (const id of [l.source, t]) {
      if (!byNode.has(id)) byNode.set(id, []);
      byNode.get(id).push({ idx, weight: l.weight });
    }
  });
  const keep = new Set();
  for (const arr of byNode.values()) {
    arr.sort((a, b) => b.weight - a.weight);
    for (let i = 0; i < Math.min(perNodeCap, arr.length); i++) keep.add(arr[i].idx);
  }
  return links.filter((_, idx) => keep.has(idx));
}

function buildBookGraph(data, perNodeCap = 6) {
  const nodes = data.books.map((b) => ({
    id: b.id,
    label: b.name,
    category: b.category,
    apocryphal: b.apocryphal,
    size: data.bookDegree.get(b.id) || 0,
  }));

  let links = [];
  for (const [pairKey, weight] of data.bookPairCounts.entries()) {
    const [a, b] = pairKey.split('|');
    links.push({ source: a, target: b, weight });
  }
  links = topEdgesPerNode(links, perNodeCap);

  return { nodes, links };
}

function buildChapterGraph(data, bookId, perNodeCap = 5) {
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

  let links = [];
  const pairs = data.chapterPairCounts.get(bookId) || new Map();
  for (const [pairKey, weight] of pairs.entries()) {
    const [a, b] = pairKey.split('|');
    links.push({ source: `${bookId}.${a}`, target: `${bookId}.${b}`, weight });
  }

  const chapterExternal = data.chapterExternalLinks.get(bookId) || new Map();
  for (const [chapter, otherMap] of chapterExternal.entries()) {
    for (const [otherBookId, weight] of otherMap.entries()) {
      links.push({ source: `${bookId}.${chapter}`, target: `ext:${otherBookId}`, weight });
    }
  }

  links = topEdgesPerNode(links, perNodeCap);

  // Only add external book aggregate nodes that survived the edge cap, so we
  // don't scatter disconnected labels around the layout.
  const survivingExternalIds = new Set(
    links
      .map((l) => l.target)
      .filter((t) => typeof t === 'string' && t.startsWith('ext:'))
      .map((t) => t.slice(4))
  );
  const externalTotals = data.crossBookChapterLinks.get(bookId) || new Map();
  for (const [otherBookId, total] of externalTotals.entries()) {
    if (!survivingExternalIds.has(otherBookId)) continue;
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

function topVerses(data, { limit = 50, minVotes = 0, bookId = null } = {}) {
  const ranked = [];
  for (const [key, adj] of data.adjacency.entries()) {
    if (bookId && !key.startsWith(`${bookId}.`)) continue;
    const degree = minVotes > 0 ? adj.filter((e) => e.curated || e.votes >= minVotes).length : adj.length;
    if (degree === 0) continue;
    ranked.push({ key, degree });
  }
  ranked.sort((a, b) => b.degree - a.degree);

  return ranked.slice(0, limit).map(({ key, degree }) => {
    const { bookId: bId, chapter, verse } = parseRef(key);
    const book = data.booksById.get(bId);
    return {
      bookId: bId,
      chapter,
      verse,
      label: `${book.name} ${chapter}:${verse}`,
      text: data.verseText.get(key) || null,
      category: book.category,
      apocryphal: book.apocryphal,
      degree,
    };
  });
}

module.exports = { buildBookGraph, buildChapterGraph, buildVerseGraph, verseDetail, topVerses };
