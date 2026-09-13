(() => {
  'use strict';

  const treeEl = document.getElementById('tree');
  const filterInput = document.getElementById('treeFilter');
  const expandAllBtn = document.getElementById('expandAllBtn');
  const collapseAllBtn = document.getElementById('collapseAllBtn');
  const disclaimerEl = document.getElementById('ontDisclaimer');
  const sourcesEl = document.getElementById('ontSources');

  // ---- Minimal verse lookup (books.json + bible-text.json only - this page
  // doesn't need the ~8MB cross-reference index the graph page loads) ----
  let booksById = new Map();
  let bibleText = {};

  function parseRef(ref) {
    const parts = ref.split('.');
    const verse = parseInt(parts.pop(), 10);
    const chapter = parseInt(parts.pop(), 10);
    const bookId = parts.join('.');
    return { bookId, chapter, verse };
  }

  function verseText(bookId, chapter, verse) {
    const chapters = bibleText[bookId];
    if (!chapters) return null;
    const verses = chapters[chapter - 1];
    if (!verses) return null;
    return verses[verse - 1] || null;
  }

  function bookName(bookId) {
    const b = booksById.get(bookId);
    return b ? b.name : bookId;
  }

  // Expands a single ref ("Gen.16.7") or range ("Gen.16.7-Gen.16.13") into
  // every individual verse within it, capped so a huge range (e.g. a whole
  // chapter of Isaiah) doesn't dump dozens of verses into the page at once.
  function expandRef(ref, cap = 6) {
    let a, b;
    if (ref.includes('-')) {
      const idx = ref.indexOf('-');
      a = parseRef(ref.slice(0, idx));
      b = parseRef(ref.slice(idx + 1));
    } else {
      a = parseRef(ref);
      b = a;
    }
    const out = [];
    if (a.bookId !== b.bookId) {
      // cross-book range (rare) - just show the two endpoints
      out.push(a, b);
      return { verses: out, truncated: false, total: 2 };
    }
    let total = 0;
    for (let ch = a.chapter; ch <= b.chapter; ch++) {
      const vStart = ch === a.chapter ? a.verse : 1;
      const chapters = bibleText[a.bookId] || [];
      const vEnd = ch === b.chapter ? b.verse : (chapters[ch - 1] || []).length;
      for (let v = vStart; v <= vEnd; v++) {
        total++;
        if (out.length < cap) out.push({ bookId: a.bookId, chapter: ch, verse: v });
      }
    }
    return { verses: out, truncated: total > out.length, total };
  }

  function refLabel(ref) {
    if (ref.includes('-')) {
      const idx = ref.indexOf('-');
      const a = parseRef(ref.slice(0, idx));
      const b = parseRef(ref.slice(idx + 1));
      if (a.bookId === b.bookId && a.chapter === b.chapter) {
        return `${bookName(a.bookId)} ${a.chapter}:${a.verse}-${b.verse}`;
      }
      if (a.bookId === b.bookId) {
        return `${bookName(a.bookId)} ${a.chapter}:${a.verse}-${b.chapter}:${b.verse}`;
      }
      return `${bookName(a.bookId)} ${a.chapter}:${a.verse} - ${bookName(b.bookId)} ${b.chapter}:${b.verse}`;
    }
    const a = parseRef(ref);
    return `${bookName(a.bookId)} ${a.chapter}:${a.verse}`;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ---- Verse chip click -> inline expand ----
  function onVerseChipClick(chip, ref) {
    const existing = chip.nextElementSibling;
    if (existing && existing.classList.contains('ont-verse-text-wrap')) {
      existing.remove();
      return;
    }
    const { verses, truncated, total } = expandRef(ref);
    const wrap = document.createElement('div');
    wrap.className = 'ont-verse-text-wrap';
    wrap.innerHTML = verses
      .map((v) => {
        const text = verseText(v.bookId, v.chapter, v.verse);
        return `<div class="ont-verse-text"><span class="ref">${bookName(v.bookId)} ${v.chapter}:${v.verse}</span>${
          text ? escapeHtml(text) : '<em>(text unavailable)</em>'
        }</div>`;
      })
      .join('');
    if (truncated) {
      const more = document.createElement('div');
      more.className = 'ont-verse-text';
      more.innerHTML = `<span class="more">…${total - verses.length} more verse${total - verses.length === 1 ? '' : 's'} in this range</span>`;
      wrap.appendChild(more);
    }
    chip.insertAdjacentElement('afterend', wrap);
  }

  // ---- Tree rendering ----
  function renderNode(node) {
    const isLeaf = !node.children || node.children.length === 0;
    const details = document.createElement('details');
    details.className = 'ont-node' + (isLeaf ? ' leaf' : '');
    details.dataset.id = node.id;
    details.dataset.searchBlob = (node.label + ' ' + (node.summary || '')).toLowerCase();

    const summary = document.createElement('summary');
    summary.innerHTML = `<span class="ont-badge ${node.type || 'Individual'}">${node.type || 'Individual'}</span><span class="ont-label">${escapeHtml(node.label)}</span>`;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'ont-body';

    if (node.summary) {
      const p = document.createElement('div');
      p.className = 'ont-summary';
      p.textContent = node.summary;
      body.appendChild(p);
    }

    const verses = node.verses || [];
    const fulfillment = node.fulfillment || [];
    if (verses.length || fulfillment.length) {
      const versesWrap = document.createElement('div');
      versesWrap.className = 'ont-verses';
      verses.forEach((ref) => {
        const chip = document.createElement('span');
        chip.className = 'ont-verse-chip';
        chip.textContent = refLabel(ref);
        chip.onclick = () => onVerseChipClick(chip, ref);
        versesWrap.appendChild(chip);
      });
      if (fulfillment.length) {
        const arrow = document.createElement('span');
        arrow.className = 'ont-arrow';
        arrow.textContent = '→ fulfilled in';
        versesWrap.appendChild(arrow);
        fulfillment.forEach((ref) => {
          const chip = document.createElement('span');
          chip.className = 'ont-verse-chip fulfillment';
          chip.textContent = refLabel(ref);
          chip.onclick = () => onVerseChipClick(chip, ref);
          versesWrap.appendChild(chip);
        });
      }
      body.appendChild(versesWrap);
    }

    (node.children || []).forEach((child) => {
      body.appendChild(renderNode(child));
    });

    details.appendChild(body);
    return details;
  }

  function render(ont) {
    disclaimerEl.textContent = ont.disclaimer;
    sourcesEl.textContent = 'Sources: ' + ont.sources.join('; ');

    treeEl.innerHTML = '';
    ont.tree.forEach((node) => {
      const el = renderNode(node);
      el.open = true; // top-level branches start open
      treeEl.appendChild(el);
    });
  }

  // ---- Controls ----
  expandAllBtn.addEventListener('click', () => {
    treeEl.querySelectorAll('details').forEach((d) => (d.open = true));
  });
  collapseAllBtn.addEventListener('click', () => {
    treeEl.querySelectorAll('.ont-node').forEach((d) => (d.open = false));
    treeEl.querySelectorAll(':scope > .ont-node').forEach((d) => (d.open = true));
  });

  let filterTimer = null;
  filterInput.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilter, 120);
  });

  function applyFilter() {
    const q = filterInput.value.trim().toLowerCase();
    const allNodes = Array.from(treeEl.querySelectorAll('.ont-node'));
    if (!q) {
      allNodes.forEach((d) => {
        d.style.display = '';
        d.open = d.parentElement === treeEl;
      });
      return;
    }
    const matched = new Set();
    allNodes.forEach((d) => {
      if (d.dataset.searchBlob.includes(q)) matched.add(d);
    });
    // A node stays visible if it matches or contains a match.
    allNodes.forEach((d) => {
      const containsMatch = Array.from(d.querySelectorAll('.ont-node')).some((c) => matched.has(c));
      const visible = matched.has(d) || containsMatch;
      d.style.display = visible ? '' : 'none';
      if (visible) d.open = true;
    });
  }

  async function boot() {
    try {
      const [ont, books, text] = await Promise.all([
        fetch('data/ontology.json').then((r) => r.json()),
        fetch('data/books.json').then((r) => r.json()),
        fetch('data/bible-text.json').then((r) => r.json()),
      ]);
      booksById = new Map(books.map((b) => [b.id, b]));
      bibleText = text;
      render(ont);
    } catch (err) {
      treeEl.textContent = 'Failed to load the ontology data. Check the console and try reloading.';
      console.error(err);
    }
  }
  boot();
})();
