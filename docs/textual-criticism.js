(() => {
  'use strict';

  const listEl = document.getElementById('tvList');
  const filterInput = document.getElementById('tvFilter');
  const categorySelect = document.getElementById('tvCategoryFilter');
  const disclaimerEl = document.getElementById('tvDisclaimer');

  // ---- Minimal verse lookup (same pattern as ontology.js/chiasm.js) ----
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
  function refLabel(ref) {
    const idx = ref.indexOf('-');
    if (idx === -1) {
      const a = parseRef(ref);
      return `${bookName(a.bookId)} ${a.chapter}:${a.verse}`;
    }
    const a = parseRef(ref.slice(0, idx));
    const b = parseRef(ref.slice(idx + 1));
    if (a.bookId === b.bookId && a.chapter === b.chapter) return `${bookName(a.bookId)} ${a.chapter}:${a.verse}-${b.verse}`;
    if (a.bookId === b.bookId) return `${bookName(a.bookId)} ${a.chapter}:${a.verse}-${b.chapter}:${b.verse}`;
    return `${bookName(a.bookId)} ${a.chapter}:${a.verse} - ${bookName(b.bookId)} ${b.chapter}:${b.verse}`;
  }
  function expandRef(ref, cap = 6) {
    let a, b;
    const idx = ref.indexOf('-');
    if (idx === -1) {
      a = parseRef(ref);
      b = a;
    } else {
      a = parseRef(ref.slice(0, idx));
      b = parseRef(ref.slice(idx + 1));
    }
    const out = [];
    let total = 0;
    if (a.bookId !== b.bookId) return { verses: [a, b], truncated: false, total: 2 };
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
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
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
      more.innerHTML = `<span class="more">…${total - verses.length} more verse${total - verses.length === 1 ? '' : 's'}</span>`;
      wrap.appendChild(more);
    }
    chip.insertAdjacentElement('afterend', wrap);
  }

  let allVariants = [];

  function renderCard(v) {
    const el = document.createElement('div');
    el.className = 'tv-card';
    el.id = `tv-${v.id}`;
    el.dataset.searchBlob = [v.title, v.category, v.mt, v.lxx, v.dss, v.significance].filter(Boolean).join(' ').toLowerCase();
    el.dataset.category = v.category;

    let witnesses = '';
    if (v.mt) witnesses += `<div class="tv-witness"><span class="tv-witness-label mt">MT</span>${escapeHtml(v.mt)}</div>`;
    if (v.lxx) witnesses += `<div class="tv-witness"><span class="tv-witness-label lxx">LXX</span>${escapeHtml(v.lxx)}</div>`;
    if (v.dss) witnesses += `<div class="tv-witness"><span class="tv-witness-label dss">DSS</span>${escapeHtml(v.dss)}</div>`;

    el.innerHTML = `
      <div class="tv-card-head">
        <span class="tv-category">${escapeHtml(v.category)}</span>
        <span class="ont-verse-chip" data-ref="${v.ref}">${refLabel(v.ref)}</span>
      </div>
      <h3>${escapeHtml(v.title)}</h3>
      <div class="tv-witnesses">${witnesses}</div>
      <div class="tv-significance">${escapeHtml(v.significance)}</div>
      ${v.relatedOntology ? `<a class="ttl-link" href="ontology.html">&rarr; See this in the Divine Council Ontology</a>` : ''}
    `;
    el.querySelector('.ont-verse-chip').onclick = function () {
      onVerseChipClick(this, v.ref);
    };
    return el;
  }

  function render() {
    listEl.innerHTML = '';
    allVariants.forEach((v) => listEl.appendChild(renderCard(v)));
  }

  function applyFilter() {
    const q = filterInput.value.trim().toLowerCase();
    const cat = categorySelect.value;
    listEl.querySelectorAll('.tv-card').forEach((card) => {
      const matchesText = !q || card.dataset.searchBlob.includes(q);
      const matchesCat = !cat || card.dataset.category === cat;
      card.style.display = matchesText && matchesCat ? '' : 'none';
    });
  }
  let filterTimer = null;
  filterInput.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilter, 120);
  });
  categorySelect.addEventListener('change', applyFilter);

  async function boot() {
    try {
      const [tv, books, text] = await Promise.all([
        fetch('data/textual-variants.json').then((r) => r.json()),
        fetch('data/books.json').then((r) => r.json()),
        fetch('data/bible-text.json').then((r) => r.json()),
      ]);
      booksById = new Map(books.map((b) => [b.id, b]));
      bibleText = text;
      allVariants = tv.variants;
      disclaimerEl.textContent = tv.disclaimer;

      const categories = [...new Set(allVariants.map((v) => v.category))];
      categorySelect.innerHTML =
        '<option value="">All categories</option>' + categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

      render();

      if (location.hash) {
        const target = document.querySelector(location.hash);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.style.borderColor = '#d4af60';
          setTimeout(() => (target.style.borderColor = ''), 2500);
        }
      }
    } catch (err) {
      listEl.textContent = 'Failed to load textual variant data. Check the console and try reloading.';
      console.error(err);
    }
  }
  boot();
})();
