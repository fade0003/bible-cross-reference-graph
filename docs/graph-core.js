// Client-side port of lib/loadData.js + lib/graphBuilders.js + the /api/search
// handler from server.js, for the static (GitHub Pages) build. The algorithms
// are unchanged from the Express version - only the I/O layer differs: data
// comes from fetch() against static files in docs/data/ instead of fs reads
// against data/, and everything runs once in-memory in the browser instead of
// per-request on a server.
(function (global) {
  'use strict';

  function parseRef(ref) {
    const parts = ref.split('.');
    const verse = parseInt(parts.pop(), 10);
    const chapter = parseInt(parts.pop(), 10);
    const bookId = parts.join('.');
    return { bookId, chapter, verse };
  }

  function verseKey(bookId, chapter, verse) {
    return `${bookId}.${chapter}.${verse}`;
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.text();
  }

  function loadBooksAndText(books, bibleText) {
    const booksById = new Map();
    const verseText = new Map();
    const chapterMeta = new Map();

    books.forEach((book) => {
      booksById.set(book.id, book);
      const chapters = bibleText[book.id] || [];
      const meta = [];
      chapters.forEach((verses, chIdx) => {
        const chapter = chIdx + 1;
        meta.push({ chapter, verseCount: verses.length });
        verses.forEach((text, vIdx) => {
          verseText.set(verseKey(book.id, chapter, vIdx + 1), text);
        });
      });
      chapterMeta.set(book.id, meta);
    });

    return { booksById, verseText, chapterMeta };
  }

  function loadCrossReferences(text, booksById) {
    const lines = text.split('\n');
    const edges = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
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

  function loadCuratedApocrypha(raw, booksById, startId) {
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
    const adjacency = new Map();
    const bookPairCounts = new Map();
    const bookDegree = new Map();
    const chapterPairCounts = new Map();
    const chapterDegree = new Map();
    const crossBookChapterLinks = new Map();
    const chapterExternalLinks = new Map();

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

  // Lets the browser paint the just-set progress message before a
  // synchronous, CPU-bound step (parsing/indexing ~345k cross-references)
  // blocks the main thread - without this, report()'s DOM update never
  // makes it to screen until the blocking work is already done.
  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function getData(onProgress) {
    if (cached) return cached;
    const report = onProgress || (() => {});

    report('Fetching Bible text…');
    await nextFrame();
    const [books, bibleText] = await Promise.all([
      fetchJSON('data/books.json'),
      fetchJSON('data/bible-text.json'),
    ]);
    const { booksById, verseText, chapterMeta } = loadBooksAndText(books, bibleText);

    report('Fetching cross-references…');
    await nextFrame();
    const [crossRefText, curatedRaw] = await Promise.all([
      fetchText('data/cross_references.txt'),
      fetchJSON('data/curated-apocrypha-crossrefs.json'),
    ]);

    report('Indexing cross-references…');
    await nextFrame();
    const canonicalEdges = loadCrossReferences(crossRefText, booksById);
    const curatedEdges = loadCuratedApocrypha(curatedRaw, booksById, canonicalEdges.length);
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

  // ---- graph builders (ported unchanged from lib/graphBuilders.js) ----

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
        const otherKey =
          e.dir === 'out'
            ? verseKey(other.to.bookId, other.to.chapter, other.to.verse)
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

  // ---- search (ported from server.js's /api/search handler) ----

  function search(data, q) {
    q = (q || '').trim();
    if (q.length < 2) return [];
    const qLower = q.toLowerCase();

    const refMatch = q.match(/^([1-3]?\s?[A-Za-z. ]+?)\s*(\d+)?(?::(\d+))?$/);
    const results = [];

    if (refMatch) {
      const namePart = refMatch[1].trim().toLowerCase();
      const chapter = refMatch[2] ? parseInt(refMatch[2], 10) : null;
      const verse = refMatch[3] ? parseInt(refMatch[3], 10) : null;
      const matchedBooks = data.books.filter(
        (b) => b.name.toLowerCase().startsWith(namePart) || b.id.toLowerCase() === namePart.replace(/\s/g, '')
      );
      for (const b of matchedBooks.slice(0, 5)) {
        if (chapter && verse) {
          const key = verseKey(b.id, chapter, verse);
          if (data.verseText.has(key)) {
            results.push({ type: 'verse', bookId: b.id, chapter, verse, label: `${b.name} ${chapter}:${verse}` });
          }
        } else if (chapter) {
          const chapters = data.chapterMeta.get(b.id) || [];
          if (chapters.some((c) => c.chapter === chapter)) {
            results.push({ type: 'chapter', bookId: b.id, chapter, label: `${b.name} ${chapter}` });
          }
        } else {
          results.push({ type: 'book', bookId: b.id, label: b.name });
        }
      }
    }

    if (results.length === 0) {
      for (const b of data.books) {
        if (b.name.toLowerCase().includes(qLower)) {
          results.push({ type: 'book', bookId: b.id, label: b.name });
        }
      }
    }

    return results.slice(0, 20);
  }

  global.GraphCore = {
    getData,
    verseKey,
    parseRef,
    buildBookGraph,
    buildChapterGraph,
    buildVerseGraph,
    verseDetail,
    topVerses,
    search,
  };
})(window);
