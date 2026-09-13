'use strict';

// Generates the static data files consumed by docs/ (the GitHub Pages
// build). Only the verse text gets reshaped - KJVA.json repeats a
// "Book chapter:verse" name string on every single verse, which roughly
// doubles its size for data the client already knows from array position.
// Everything else (cross-references, books, curated links) is compact
// enough to ship as-is.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_DIR = path.join(__dirname, '..', 'docs', 'data');

function buildBibleText() {
  const books = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'books.json'), 'utf8'));
  const kjva = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sources', 'KJVA.json'), 'utf8'));

  const out = {};
  books.forEach((book, i) => {
    const kjvaBook = kjva.books[i];
    out[book.id] = kjvaBook.chapters.map((ch) =>
      ch.verses.map((v) => v.text)
    );
  });
  return out;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  fs.copyFileSync(path.join(DATA_DIR, 'books.json'), path.join(OUT_DIR, 'books.json'));
  fs.copyFileSync(
    path.join(DATA_DIR, 'curated-apocrypha-crossrefs.json'),
    path.join(OUT_DIR, 'curated-apocrypha-crossrefs.json')
  );
  fs.copyFileSync(
    path.join(DATA_DIR, 'sources', 'cross_references.txt'),
    path.join(OUT_DIR, 'cross_references.txt')
  );

  const bibleText = buildBibleText();
  fs.writeFileSync(path.join(OUT_DIR, 'bible-text.json'), JSON.stringify(bibleText));

  console.log('Wrote', OUT_DIR);
  for (const f of fs.readdirSync(OUT_DIR)) {
    const { size } = fs.statSync(path.join(OUT_DIR, f));
    console.log(' ', f, (size / 1024 / 1024).toFixed(2), 'MB');
  }
}

main();
