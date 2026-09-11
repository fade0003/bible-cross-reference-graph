'use strict';

const express = require('express');
const path = require('path');
const { getData, verseKey } = require('./lib/loadData');
const { buildBookGraph, buildChapterGraph, buildVerseGraph, verseDetail } = require('./lib/graphBuilders');

const PORT = process.env.PORT || 3300;

function parseMinVotes(req) {
  if (req.query.minVotes === undefined || req.query.minVotes === '') return 0;
  const n = parseInt(req.query.minVotes, 10);
  return Number.isNaN(n) ? 0 : n;
}

function parsePerNode(req, fallback) {
  if (req.query.perNode === undefined || req.query.perNode === '') return fallback;
  const n = parseInt(req.query.perNode, 10);
  return Number.isNaN(n) ? fallback : n;
}

async function main() {
  console.log('Loading Bible data & cross-references...');
  const start = Date.now();
  const data = await getData();
  console.log(
    `Loaded ${data.stats.totalVerses} verses, ${data.stats.canonicalEdges} canonical cross-references, ` +
      `${data.stats.curatedEdges} curated apocrypha links in ${Date.now() - start}ms`
  );

  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/meta', (req, res) => {
    res.json({
      books: data.books,
      stats: data.stats,
    });
  });

  app.get('/api/graph/books', (req, res) => {
    res.json(buildBookGraph(data, parsePerNode(req, 6)));
  });

  app.get('/api/graph/book/:bookId', (req, res) => {
    const graph = buildChapterGraph(data, req.params.bookId, parsePerNode(req, 5));
    if (!graph) return res.status(404).json({ error: 'Unknown book' });
    res.json(graph);
  });

  app.get('/api/graph/chapter/:bookId/:chapter', (req, res) => {
    const chapter = parseInt(req.params.chapter, 10);
    const minVotes = parseMinVotes(req);
    const graph = buildVerseGraph(data, req.params.bookId, chapter, minVotes);
    if (!graph) return res.status(404).json({ error: 'Unknown book/chapter' });
    res.json(graph);
  });

  app.get('/api/verse/:bookId/:chapter/:verse', (req, res) => {
    const chapter = parseInt(req.params.chapter, 10);
    const verse = parseInt(req.params.verse, 10);
    const minVotes = parseMinVotes(req);
    const detail = verseDetail(data, req.params.bookId, chapter, verse, minVotes);
    if (!detail) return res.status(404).json({ error: 'Unknown verse' });
    res.json(detail);
  });

  app.get('/api/search', (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const qLower = q.toLowerCase();

    // Try "Book chapter:verse" or "Book chapter" style refs first.
    const refMatch = q.match(/^([1-3]?\s?[A-Za-z. ]+?)\s*(\d+)?(?::(\d+))?$/);
    const results = [];

    if (refMatch) {
      const namePart = refMatch[1].trim().toLowerCase();
      const chapter = refMatch[2] ? parseInt(refMatch[2], 10) : null;
      const verse = refMatch[3] ? parseInt(refMatch[3], 10) : null;
      const matchedBooks = data.books.filter(
        (b) =>
          b.name.toLowerCase().startsWith(namePart) ||
          b.id.toLowerCase() === namePart.replace(/\s/g, '')
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

    res.json({ results: results.slice(0, 20) });
  });

  app.listen(PORT, () => {
    console.log(`Bible Cross-Reference Graph running at http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
