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

// Turns data/ontology.json into a real OWL/RDF Turtle file - the JSON's
// `classes`/`properties` become the TBox, and every node in `tree` becomes
// an owl:Individual (typed by its `type` field, related to its parent via
// a `partOf` triple and to its verses via `bible:verse` literals).
function ttlEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function buildOntologyTurtle(ont) {
  const lines = [];
  lines.push('@prefix : <https://bible-cross-reference-graph.local/ontology#> .');
  lines.push('@prefix owl: <http://www.w3.org/2002/07/owl#> .');
  lines.push('@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .');
  lines.push('@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .');
  lines.push('@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .');
  lines.push('');
  lines.push(`# ${ont.title} - ${ont.subtitle}`);
  lines.push('# Sources: ' + ont.sources.join('; '));
  lines.push('# ' + ont.disclaimer.replace(/\n/g, ' '));
  lines.push('');
  lines.push(': a owl:Ontology ;');
  lines.push(`  rdfs:label "${ttlEscape(ont.title)}" ;`);
  lines.push(`  rdfs:comment "${ttlEscape(ont.disclaimer)}" .`);
  lines.push('');

  for (const c of ont.classes) {
    lines.push(`:${c.id} a owl:Class ;`);
    lines.push(`  rdfs:label "${ttlEscape(c.label)}" ;`);
    if (c.subClassOf) lines.push(`  rdfs:subClassOf :${c.subClassOf} ;`);
    lines.push(`  rdfs:comment "${ttlEscape(c.comment || '')}" .`);
    lines.push('');
  }

  for (const p of ont.properties) {
    lines.push(`:${p.id} a owl:ObjectProperty ;`);
    lines.push(`  rdfs:label "${ttlEscape(p.label)}" ;`);
    if (p.domain) lines.push(`  rdfs:domain :${p.domain} ;`);
    if (p.range) lines.push(`  rdfs:range :${p.range} ;`);
    lines.push(`  rdfs:comment "${ttlEscape(p.comment || '')}" .`);
    lines.push('');
  }

  lines.push(':lens a owl:DatatypeProperty ;');
  lines.push('  rdfs:label "highlight lens" ;');
  lines.push('  rdfs:comment "Van Dorn theme lens: two-powers, angel-of-the-lord, nephilim, or masoretic." .');
  lines.push('');
  lines.push(':veil a owl:DatatypeProperty ;');
  lines.push('  rdfs:label "veil kind" ;');
  lines.push('  rdfs:comment "text (a consonantal/text-form difference), interpretation (wording survived, the sense was flattened later), or counterexample." .');
  lines.push('');
  lines.push(':variantId a owl:DatatypeProperty ;');
  lines.push('  rdfs:label "textual-variants entry" .');
  lines.push('');
  lines.push(':seeAlso a owl:ObjectProperty ;');
  lines.push('  rdfs:label "see also" .');
  lines.push('');

  function walk(node, parentId) {
    // A node typed "Class" is itself an owl:Class (e.g. "The Divine Council"
    // as a category); anything else is an owl:NamedIndividual of that class
    // (e.g. Melchizedek the Individual, Babel the Event).
    const rdfType = node.type === 'Class' ? 'owl:Class' : `owl:NamedIndividual, :${node.type || 'Individual'}`;
    lines.push(`:${node.id} a ${rdfType} ;`);
    lines.push(`  rdfs:label "${ttlEscape(node.label)}" ;`);
    if (node.summary) lines.push(`  rdfs:comment "${ttlEscape(node.summary)}" ;`);
    if (parentId) lines.push(`  :partOf :${parentId} ;`);
    (node.themes || []).forEach((t) => lines.push(`  :lens "${ttlEscape(t)}" ;`));
    if (node.veil) lines.push(`  :veil "${ttlEscape(node.veil)}" ;`);
    if (node.variantId) lines.push(`  :variantId "${ttlEscape(node.variantId)}" ;`);
    (node.seeAlso || []).forEach((id) => lines.push(`  :seeAlso :${id} ;`));
    const verses = (node.verses || []).concat(node.fulfillment || []);
    verses.forEach((v, i) => {
      const last = i === verses.length - 1;
      lines.push(`  :verse "${ttlEscape(v)}"${last ? ' .' : ' ;'}`);
    });
    if (verses.length === 0) {
      // close the statement even when there are no :verse triples
      const prevIdx = lines.length - 1;
      lines[prevIdx] = lines[prevIdx].replace(/ ;$/, ' .');
    }
    lines.push('');
    (node.children || []).forEach((child) => walk(child, node.id));
  }
  ont.tree.forEach((node) => walk(node, null));

  return lines.join('\n');
}

function parseVerseRef(ref) {
  const parts = ref.split('.');
  const verse = parseInt(parts.pop(), 10);
  const chapter = parseInt(parts.pop(), 10);
  const bookId = parts.join('.');
  return { bookId, chapter, verse };
}

function chaptersTouched(ref) {
  let a;
  let b;
  if (ref.includes('-')) {
    const idx = ref.indexOf('-');
    a = parseVerseRef(ref.slice(0, idx));
    b = parseVerseRef(ref.slice(idx + 1));
  } else {
    a = parseVerseRef(ref);
    b = a;
  }
  const keys = [];
  if (a.bookId !== b.bookId) {
    keys.push([a.bookId, a.chapter], [b.bookId, b.chapter]);
    return keys;
  }
  const start = Math.min(a.chapter, b.chapter);
  const end = Math.max(a.chapter, b.chapter);
  for (let ch = start; ch <= end; ch++) keys.push([a.bookId, ch]);
  return keys;
}

function collectOntologyRefs(node, refs) {
  (node.verses || []).forEach((r) => refs.push(r));
  (node.fulfillment || []).forEach((r) => refs.push(r));
  (node.children || []).forEach((child) => collectOntologyRefs(child, refs));
}

// A small slice of bible-text.json: every chapter the ontology actually
// cites, in the same book -> chapters -> verses shape the page already uses.
// The ontology page draws from ontology.json first and fetches this in the
// background, instead of blocking on the full ~5MB text.
function buildOntologyVerses(ont, bibleText) {
  const refs = [];
  (ont.tree || []).forEach((node) => collectOntologyRefs(node, refs));
  const out = {};
  const seen = new Set();
  for (const ref of refs) {
    for (const [bookId, chapter] of chaptersTouched(ref)) {
      const key = bookId + ':' + chapter;
      if (seen.has(key)) continue;
      seen.add(key);
      const chapters = bibleText[bookId];
      const verses = chapters && chapters[chapter - 1];
      if (!verses) {
        console.warn('No verse text for', bookId, chapter, 'cited as', ref);
        continue;
      }
      if (!out[bookId]) out[bookId] = [];
      out[bookId][chapter - 1] = verses;
    }
  }
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

  const ontologyPath = path.join(DATA_DIR, 'ontology.json');
  if (fs.existsSync(ontologyPath)) {
    const ontology = JSON.parse(fs.readFileSync(ontologyPath, 'utf8'));
    fs.copyFileSync(ontologyPath, path.join(OUT_DIR, 'ontology.json'));
    fs.writeFileSync(path.join(OUT_DIR, 'bible-theology-ontology.ttl'), buildOntologyTurtle(ontology));
    fs.writeFileSync(
      path.join(OUT_DIR, 'ontology-verses.json'),
      JSON.stringify(buildOntologyVerses(ontology, bibleText))
    );
  }

  const chiasmsPath = path.join(DATA_DIR, 'chiasms.json');
  if (fs.existsSync(chiasmsPath)) {
    fs.copyFileSync(chiasmsPath, path.join(OUT_DIR, 'chiasms.json'));
  }

  const chronologyPath = path.join(DATA_DIR, 'chronology.json');
  if (fs.existsSync(chronologyPath)) {
    fs.copyFileSync(chronologyPath, path.join(OUT_DIR, 'chronology.json'));
  }

  const textualVariantsPath = path.join(DATA_DIR, 'textual-variants.json');
  if (fs.existsSync(textualVariantsPath)) {
    fs.copyFileSync(textualVariantsPath, path.join(OUT_DIR, 'textual-variants.json'));
  }

  console.log('Wrote', OUT_DIR);
  for (const f of fs.readdirSync(OUT_DIR)) {
    const { size } = fs.statSync(path.join(OUT_DIR, f));
    console.log(' ', f, (size / 1024 / 1024).toFixed(2), 'MB');
  }
}

main();
