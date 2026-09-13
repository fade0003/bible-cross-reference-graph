// Tiny shared top-nav injected into every page's #siteNav placeholder, so
// the four visualizations (graph, timeline, chiasm, ontology) read as one
// app suite without duplicating a hand-written nav in each HTML file.
(function () {
  'use strict';
  const PAGES = [
    { href: 'index.html', label: 'Graph' },
    { href: 'timeline.html', label: 'Timeline' },
    { href: 'chiasm.html', label: 'Chiasms' },
    { href: 'ontology.html', label: 'Ontology' },
  ];

  function currentFile() {
    const path = window.location.pathname;
    let last = path.substring(path.lastIndexOf('/') + 1);
    if (last === '') last = 'index.html';
    if (!last.endsWith('.html')) last += '.html'; // some static hosts serve clean URLs
    return last;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('siteNav');
    if (!el) return;
    const here = currentFile();
    el.innerHTML = PAGES.map(
      (p) => `<a href="${p.href}" class="${p.href === here ? 'active' : ''}">${p.label}</a>`
    ).join('');
  });
})();
