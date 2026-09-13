(() => {
  'use strict';

  const pickerEl = document.getElementById('chiasmPicker');
  const viewEl = document.getElementById('chiasmView');
  const disclaimerEl = document.getElementById('chiasmDisclaimer');

  const PALETTE = ['#5f8fd9', '#6fce8f', '#e0a798', '#c9a6f7', '#f2a65f', '#9dc0f2', '#ff8b83'];

  // ---- Minimal verse lookup (same pattern as ontology.js) ----
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
  function expandRef(ref, cap = 8) {
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

  // ---- Rendering ----
  let allChiasms = [];
  let activeId = null;

  function pairKey(label) {
    return label.replace(/'/g, '');
  }

  function renderPicker() {
    pickerEl.innerHTML = allChiasms
      .map(
        (c) =>
          `<button class="tree-btn chiasm-pick ${c.id === activeId ? 'active' : ''}" data-id="${c.id}">${escapeHtml(c.title)}</button>`
      )
      .join(' ');
    pickerEl.querySelectorAll('.chiasm-pick').forEach((btn) => {
      btn.onclick = () => {
        activeId = btn.dataset.id;
        renderPicker();
        renderChiasm();
      };
    });
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
      more.innerHTML = `<span class="more">…${total - verses.length} more verse${total - verses.length === 1 ? '' : 's'} in this section</span>`;
      wrap.appendChild(more);
    }
    chip.insertAdjacentElement('afterend', wrap);
  }

  function renderChiasm() {
    const c = allChiasms.find((x) => x.id === activeId);
    if (!c) return;
    const n = c.sections.length;

    // Assign each section a "depth" (0 = outermost pair, growing toward the
    // center) so indentation forms the classic hourglass/funnel shape, and a
    // palette color shared by both halves of a pair so the eye can match
    // A with A' even without a literal connecting line.
    const depths = c.sections.map((_, i) => Math.min(i, n - 1 - i));
    const colorByKey = new Map();
    let nextColor = 0;
    c.sections.forEach((s) => {
      const k = pairKey(s.label);
      if (!colorByKey.has(k)) colorByKey.set(k, PALETTE[nextColor++ % PALETTE.length]);
    });

    let html = `
      <h2>${escapeHtml(c.title)}</h2>
      <div class="stat-line">${refLabel(c.refRange)}</div>
      <div class="ont-summary" style="max-width:70ch">${escapeHtml(c.description)}</div>
      <div class="chiasm-scholar-note">${escapeHtml(c.scholarNote)}</div>
      <div class="chiasm-rows">
    `;
    c.sections.forEach((s, i) => {
      const color = colorByKey.get(pairKey(s.label));
      const indent = depths[i] * 26;
      html += `
        <div class="chiasm-row${s.center ? ' center' : ''}" style="margin-left:${indent}px; border-color:${color}">
          <span class="chiasm-label" style="color:${color}">${escapeHtml(s.label)}</span>
          <span class="chiasm-title">${escapeHtml(s.title)}${s.center ? ' <span class="chiasm-center-badge">TURNING POINT</span>' : ''}</span>
          <span class="ont-verse-chip chiasm-ref-chip" data-ref="${s.ref}">${refLabel(s.ref)}</span>
        </div>
      `;
    });
    html += '</div>';
    viewEl.innerHTML = html;

    viewEl.querySelectorAll('.chiasm-ref-chip').forEach((chip) => {
      chip.onclick = () => onVerseChipClick(chip, chip.dataset.ref);
    });
  }

  async function boot() {
    try {
      const [chiasmsData, books, text] = await Promise.all([
        fetch('data/chiasms.json').then((r) => r.json()),
        fetch('data/books.json').then((r) => r.json()),
        fetch('data/bible-text.json').then((r) => r.json()),
      ]);
      booksById = new Map(books.map((b) => [b.id, b]));
      bibleText = text;
      allChiasms = chiasmsData.chiasms;
      disclaimerEl.textContent = chiasmsData.disclaimer;
      activeId = allChiasms[0].id;
      renderPicker();
      renderChiasm();
    } catch (err) {
      viewEl.textContent = 'Failed to load chiasm data. Check the console and try reloading.';
      console.error(err);
    }
  }
  boot();
})();
