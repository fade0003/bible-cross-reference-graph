(() => {
  'use strict';

  const treeEl = document.getElementById('tree');
  const filterInput = document.getElementById('treeFilter');
  const expandAllBtn = document.getElementById('expandAllBtn');
  const collapseAllBtn = document.getElementById('collapseAllBtn');
  const disclaimerEl = document.getElementById('ontDisclaimer');
  const sourcesEl = document.getElementById('ontSources');

  // ---- Minimal verse lookup. The graph draws from ontology.json and
  // books.json. Verse wording is a small generated subset
  // (data/ontology-verses.json), fetched after the first frame so the
  // canvas is not blocked on the full Bible text. ----
  let booksById = new Map();
  let bibleText = {};
  let bibleTextLoaded = false;
  let bibleTextPromise = null;
  let themeById = new Map();
  let activeTheme = null;

  function loadBibleText() {
    if (bibleTextLoaded) return Promise.resolve(bibleText);
    if (bibleTextPromise) return bibleTextPromise;
    bibleTextPromise = fetch('data/ontology-verses.json')
      .then((r) => {
        if (!r.ok) throw new Error('ontology-verses.json ' + r.status);
        return r.json();
      })
      .then((text) => {
        bibleText = text || {};
        bibleTextLoaded = true;
        return bibleText;
      })
      .catch((err) => {
        console.error(err);
        bibleTextLoaded = true;
        return bibleText;
      });
    return bibleTextPromise;
  }

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

  function typeBadgeText(type) {
    if (type === 'TextualVeil') return 'Textual veil';
    if (type === 'TwoPowers') return 'Two powers';
    return type || 'Individual';
  }

  // ---- Verse chip click -> inline expand ----
  function onVerseChipClick(chip, ref) {
    const existing = chip.nextElementSibling;
    if (existing && existing.classList.contains('ont-verse-text-wrap')) {
      if (existing.dataset.loading === '1') return;
      existing.remove();
      return;
    }
    if (!bibleTextLoaded) {
      const wrap = document.createElement('div');
      wrap.className = 'ont-verse-text-wrap';
      wrap.dataset.loading = '1';
      wrap.innerHTML = '<div class="ont-verse-text"><em>Loading verse text…</em></div>';
      chip.insertAdjacentElement('afterend', wrap);
      loadBibleText().then(() => {
        if (wrap.isConnected) wrap.remove();
        onVerseChipClick(chip, ref);
      });
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
    const themeIds = node.themes || [];
    const themeWords = themeIds.map((id) => (themeById.get(id) ? themeById.get(id).label : id)).join(' ');
    details.dataset.id = node.id;
    details.dataset.themes = themeIds.join(' ');
    details.dataset.searchBlob = (node.label + ' ' + (node.summary || '') + ' ' + themeWords + ' ' + (node.veil || '')).toLowerCase();

    const summary = document.createElement('summary');
    const themeChips = themeIds
      .map((id) => {
        const t = themeById.get(id);
        if (!t) return '';
        return `<span class="theme-chip" style="color:${t.color};border-color:${t.color}">${escapeHtml(t.label)}</span>`;
      })
      .join('');
    const veilChip =
      node.veil === 'text'
        ? '<span class="theme-chip veil-text">Text-form</span>'
        : node.veil === 'interpretation'
          ? '<span class="theme-chip veil-interpretation">Interpretation</span>'
          : node.veil === 'counterexample'
            ? '<span class="theme-chip veil-counterexample">Counterexample</span>'
            : '';
    summary.innerHTML = `<span class="ont-badge ${node.type || 'Individual'}">${escapeHtml(typeBadgeText(node.type))}</span><span class="ont-label">${escapeHtml(node.label)}</span>${themeChips}${veilChip}`;
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
    themeById = new Map((ont.themes || []).map((t) => [t.id, t]));
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

  function branchMatchesTheme(el) {
    if (!activeTheme) return true;
    const own = (el.dataset.themes || '').split(' ').includes(activeTheme);
    if (own) return true;
    return Array.from(el.querySelectorAll('.ont-node')).some((c) =>
      (c.dataset.themes || '').split(' ').includes(activeTheme)
    );
  }

  function applyFilter() {
    const q = filterInput.value.trim().toLowerCase();
    const allNodes = Array.from(treeEl.querySelectorAll('.ont-node'));
    if (!q && !activeTheme) {
      allNodes.forEach((d) => {
        d.style.display = '';
        d.classList.remove('lens-hit');
        d.open = d.parentElement === treeEl;
      });
      return;
    }
    const matched = new Set();
    allNodes.forEach((d) => {
      const textOk = !q || d.dataset.searchBlob.includes(q);
      if (textOk && (!activeTheme || (d.dataset.themes || '').split(' ').includes(activeTheme))) matched.add(d);
    });
    allNodes.forEach((d) => {
      const containsMatch = Array.from(d.querySelectorAll('.ont-node')).some((c) => matched.has(c));
      const visible = (matched.has(d) || containsMatch) && branchMatchesTheme(d);
      d.style.display = visible ? '' : 'none';
      d.classList.toggle('lens-hit', matched.has(d) && !!activeTheme);
      if (visible && (q || activeTheme)) d.open = true;
    });
  }


  // =====================================================================
  // 3D node graph. Same tree as the outline, laid out with 3D forces.
  // Drag orbits, right-drag pans, the scroll wheel zooms. A lens keeps
  // only the Van Dorn cluster (and the ancestors that connect it).
  // =====================================================================

  const ontBody = document.getElementById('ontBody');
  const pageContent = document.getElementById('pageContent');
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('ontCanvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const ontHint = document.getElementById('hint');
  const viewTreeBtn = document.getElementById('viewTreeBtn');
  const viewGraphBtn = document.getElementById('viewGraphBtn');
  const panel = document.getElementById('panel');
  const panelContent = document.getElementById('panelContent');
  const panelClose = document.getElementById('panelClose');
  const themeBar = document.getElementById('themeBar');
  const graphThemeBar = document.getElementById('graphThemeBar');
  const lensBlurb = document.getElementById('lensBlurb');
  const spinBtn = document.getElementById('spinBtn');
  const resetViewBtn = document.getElementById('resetViewBtn');

  const TYPE_COLOR = {
    Class: '#d4af60',
    Event: '#9dc0f2',
    Individual: '#a6e6bc',
    Person: '#a6e6bc',
    Prophecy: '#ff8b83',
    Type: '#e0a798',
    Covenant: '#c9a6f7',
    Nephilim: '#f2a65f',
    TextualVeil: '#e07a9a',
    TwoPowers: '#f2d36b',
  };

  const VEIL_LABEL = {
    text: ['Text-form', 'veil-text'],
    interpretation: ['Interpretation', 'veil-interpretation'],
    counterexample: ['Counterexample', 'veil-counterexample'],
  };

  let byId = new Map();
  let collapsed = new Set();
  let graphNodes = [];
  let graphLinks = [];
  let nodeById = new Map();
  let currentView = 'graph';
  let selectedId = null;
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let spinning = !motionQuery.matches;
  let spinningPaused = false;
  let userGesturing = false;
  let renderScheduled = false;
  let graphBooted = false;
  const noHover = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  let awake = 0;
  let frameAfter = 0;
  let focusId = null;
  let ease = null;
  let width = 1;
  let height = 1;

  const cam = { yaw: 0.62, pitch: 0.4, dist: 760, tx: 0, ty: 8, tz: 0, fov: 540 };

  const stars = Array.from({ length: 140 }, () => {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const rad = 1100 + Math.random() * 700;
    return {
      x: rad * Math.sin(phi) * Math.cos(theta),
      y: rad * Math.cos(phi) * 0.55,
      z: rad * Math.sin(phi) * Math.sin(theta),
      a: 0.12 + Math.random() * 0.4,
      s: Math.random() < 0.15 ? 1.6 : 1,
    };
  });

  function indexTree(ont) {
    byId = new Map();
    function walk(node, parentId) {
      byId.set(node.id, {
        ...node,
        parentId,
        childIds: (node.children || []).map((c) => c.id),
      });
      (node.children || []).forEach((c) => walk(c, node.id));
    }
    ont.tree.forEach((n) => walk(n, 'ROOT'));
    byId.set('ROOT', {
      id: 'ROOT',
      label: 'Divine Council Worldview',
      type: 'Class',
      parentId: null,
      childIds: ont.tree.map((n) => n.id),
      summary:
        'The whole map. The four lenses along the bottom gather Douglas Van Dorn\'s clusters: two powers, the Angel of the LORD, the Nephilim, and what a later text or a later interpretation quieted.',
      themes: [],
      seeAlso: [],
    });
    expandForTheme();
  }

  function descendantCount(id) {
    const n = byId.get(id);
    if (!n || n.childIds.length === 0) return 0;
    return n.childIds.reduce((sum, c) => sum + 1 + descendantCount(c), 0);
  }

  function hasTheme(id) {
    const n = byId.get(id);
    if (!n || !activeTheme) return false;
    if ((n.themes || []).includes(activeTheme)) return true;
    return n.childIds.some(hasTheme);
  }

  function expandForTheme() {
    collapsed = new Set(byId.keys());
    collapsed.delete('ROOT');
    if (!activeTheme) return;
    for (const n of byId.values()) {
      if (!(n.themes || []).includes(activeTheme)) continue;
      let p = n.parentId;
      while (p) {
        collapsed.delete(p);
        p = byId.get(p) ? byId.get(p).parentId : null;
      }
    }
  }

  function themeColor(id) {
    const t = themeById.get(id);
    return t ? t.color : '#d4af60';
  }

  function syncThemeButtons() {
    document.querySelectorAll('.theme-btn[data-theme]').forEach((btn) => {
      const on = btn.dataset.theme === (activeTheme || '');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on && activeTheme) {
        const color = themeColor(activeTheme);
        btn.style.borderColor = color;
        btn.style.color = color;
      } else {
        btn.style.borderColor = '';
        btn.style.color = '';
      }
    });
  }

  function updateBlurb() {
    if (!lensBlurb) return;
    const t = activeTheme ? themeById.get(activeTheme) : null;
    lensBlurb.textContent = t
      ? t.blurb
      : 'Drag to orbit the divine-council map. Choose a lens to bring Van Dorn\'s clusters forward.';
  }

  function writeHash() {
    const next =
      currentView === 'graph'
        ? activeTheme
          ? '#3d/' + activeTheme
          : '#3d'
        : activeTheme
          ? '#lens/' + activeTheme
          : '#tree';
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  function setTheme(id, opts) {
    opts = opts || {};
    if (id && opts.toggle !== false && activeTheme === id) activeTheme = null;
    else activeTheme = id || null;
    syncThemeButtons();
    updateBlurb();
    expandForTheme();
    applyFilter();
    if (currentView === 'graph' && graphBooted) {
      rebuildGraphElements();
      frameAfter = 70;
      awake = 200;
      scheduleDraw();
    }
    if (!opts.silentHash) writeHash();
  }

  function buildThemeBars() {
    [themeBar, graphThemeBar].forEach((bar) => {
      if (!bar) return;
      bar.innerHTML = '';
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'theme-btn';
      all.dataset.theme = '';
      all.textContent = 'All';
      all.addEventListener('click', () => setTheme(null, { toggle: false }));
      bar.appendChild(all);
      for (const theme of themeById.values()) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-btn';
        btn.dataset.theme = theme.id;
        btn.innerHTML =
          '<span class="swatch" style="background:' +
          theme.color +
          ';color:' +
          theme.color +
          '"></span>' +
          escapeHtml(theme.label);
        btn.addEventListener('click', () => setTheme(theme.id));
        bar.appendChild(btn);
      }
    });
    syncThemeButtons();
    updateBlurb();
  }

  function setView(view) {
    currentView = view;
    viewTreeBtn.classList.toggle('active', view === 'tree');
    viewGraphBtn.classList.toggle('active', view === 'graph');
    if (view === 'tree') {
      ontBody.classList.add('content-page');
      pageContent.hidden = false;
      stage.hidden = true;
      panel.classList.add('hidden');
    } else {
      ontBody.classList.remove('content-page');
      pageContent.hidden = true;
      stage.hidden = false;
      if (!graphBooted) bootGraph();
      else {
        resize();
        rebuildGraphElements();
        frameAfter = 28;
        awake = 180;
        scheduleDraw();
      }
    }
  }
  viewTreeBtn.addEventListener('click', () => {
    setView('tree');
    writeHash();
  });
  viewGraphBtn.addEventListener('click', () => {
    setView('graph');
    writeHash();
  });

  function resize() {
    if (!canvas) return;
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => {
    if (currentView === 'graph') {
      resize();
      scheduleDraw();
    }
  });

  function visibleIds() {
    const out = ['ROOT'];
    function walk(id) {
      if (collapsed.has(id)) return;
      const n = byId.get(id);
      if (!n) return;
      for (const c of n.childIds) {
        if (activeTheme && !hasTheme(c)) continue;
        out.push(c);
        walk(c);
      }
    }
    walk('ROOT');
    return out;
  }

  function spawnPosition(meta, parent) {
    const parentMeta = meta.parentId ? byId.get(meta.parentId) : null;
    const siblings = parentMeta ? parentMeta.childIds : [];
    const index = Math.max(0, siblings.indexOf(meta.id));
    const count = Math.max(1, siblings.length);
    // Horizontal rings stay readable at a mild camera pitch. A ring
    // perpendicular to "out from the root" turns edge-on and stacks the labels.
    const a = (index / count) * Math.PI * 2 - Math.PI / 2;
    if (!parent || meta.parentId === 'ROOT') {
      return {
        x: Math.cos(a) * 320,
        y: (index % 2 === 0 ? 1 : -1) * 28,
        z: Math.sin(a) * 320,
      };
    }
    const radius = 120 + Math.min(count, 14) * 14;
    return {
      x: parent.x + Math.cos(a) * radius,
      y: parent.y + (index % 3 - 1) * 36,
      z: parent.z + Math.sin(a) * radius,
    };
  }

  function rebuildGraphElements() {
    const ids = visibleIds();
    const prevById = new Map(graphNodes.map((n) => [n.id, n]));
    const next = new Map();
    graphNodes = ids.map((id) => {
      const prev = prevById.get(id);
      if (prev) {
        next.set(id, prev);
        return prev;
      }
      const meta = byId.get(id);
      const parent = meta.parentId ? next.get(meta.parentId) : null;
      const pos = spawnPosition(meta, parent);
      const node = {
        id,
        label: meta.label,
        type: meta.type,
        hasChildren: meta.childIds.length > 0,
        size: 1 + descendantCount(id),
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: 0,
        vy: 0,
        vz: 0,
      };
      next.set(id, node);
      return node;
    });
    nodeById = next;

    const seeSeen = new Set();
    graphLinks = [];
    for (const id of ids) {
      if (id === 'ROOT') continue;
      const parentId = byId.get(id).parentId;
      if (nodeById.has(parentId)) graphLinks.push({ source: parentId, target: id, kind: 'tree' });
    }
    for (const id of ids) {
      const meta = byId.get(id);
      for (const other of meta.seeAlso || []) {
        if (!nodeById.has(other)) continue;
        const key = [id, other].sort().join('|');
        if (seeSeen.has(key)) continue;
        seeSeen.add(key);
        if (meta.parentId === other || byId.get(other).parentId === id) continue;
        graphLinks.push({ source: id, target: other, kind: 'see' });
      }
    }
    if (selectedId && !nodeById.has(selectedId)) {
      selectedId = null;
      panel.classList.add('hidden');
    }
    recomputeRadii();
  }

  function physTick() {
    if (awake <= 0 || graphNodes.length === 0) return;
    awake -= 1;
    const REPEL = 28000;
    const SPRING = 0.03;
    const LEN = 230;
    const SEE = 0.003;
    const SEE_LEN = 340;
    const GRAV = 0.01;
    const DAMP = 0.82;
    const MAX = 16;

    for (const n of graphNodes) {
      n.fx = -n.x * GRAV;
      n.fy = -n.y * GRAV;
      n.fz = -n.z * GRAV;
    }
    for (let i = 0; i < graphNodes.length; i++) {
      const a = graphNodes[i];
      for (let j = i + 1; j < graphNodes.length; j++) {
        const b = graphNodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 16) d2 = 16;
        const d = Math.sqrt(d2);
        const f = REPEL / d2;
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        const uz = (dz / d) * f;
        a.fx += ux;
        a.fy += uy;
        a.fz += uz;
        b.fx -= ux;
        b.fy -= uy;
        b.fz -= uz;
      }
    }
    for (const l of graphLinks) {
      const a = nodeById.get(l.source);
      const b = nodeById.get(l.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const rest = l.kind === 'see' ? SEE_LEN : LEN;
      const k = l.kind === 'see' ? SEE : SPRING;
      const mag = (dist - rest) * k;
      const fx = (dx / dist) * mag;
      const fy = (dy / dist) * mag;
      const fz = (dz / dist) * mag;
      a.fx += fx;
      a.fy += fy;
      a.fz += fz;
      b.fx -= fx;
      b.fy -= fy;
      b.fz -= fz;
    }
    for (const n of graphNodes) {
      n.vx = (n.vx + n.fx) * DAMP;
      n.vy = (n.vy + n.fy) * DAMP;
      n.vz = (n.vz + n.fz) * DAMP;
      const speed = Math.hypot(n.vx, n.vy, n.vz);
      if (speed > MAX) {
        const s = MAX / speed;
        n.vx *= s;
        n.vy *= s;
        n.vz *= s;
      }
      n.x += n.vx;
      n.y += n.vy;
      n.z += n.vz;
      if (n.id === 'ROOT') {
        n.x = 0;
        n.y = 0;
        n.z = 0;
        n.vx = 0;
        n.vy = 0;
        n.vz = 0;
      }
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z)) {
        n.x = 0;
        n.y = 0;
        n.z = 0;
        n.vx = n.vy = n.vz = 0;
      }
    }
  }

  function cameraSpace(x, y, z) {
    x -= cam.tx;
    y -= cam.ty;
    z -= cam.tz;
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    return { x: x1, y: y2, z: cam.dist - z2 };
  }

  function project(x, y, z) {
    const c = cameraSpace(x, y, z);
    if (c.z < 30) return null;
    const s = cam.fov / c.z;
    return { x: c.x * s, y: -c.y * s, z: c.z, s };
  }

  function frameSet(nodes) {
    if (!nodes.length) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    nodes.forEach((n) => {
      cx += n.x;
      cy += n.y;
      cz += n.z;
    });
    cx /= nodes.length;
    cy /= nodes.length;
    cz /= nodes.length;
    let r = 70;
    nodes.forEach((n) => {
      r = Math.max(r, Math.hypot(n.x - cx, n.y - cy, n.z - cz));
    });
    ease = {
      tx: cx,
      ty: cy,
      tz: cz,
      dist: Math.max(480, Math.min(1900, r * 2.15 + 360)),
      pitch: cam.pitch,
    };
  }

  function frameVisible() {
    let set = graphNodes;
    if (focusId && nodeById.has(focusId)) set = [nodeById.get(focusId)];
    else if (activeTheme) {
      const tagged = graphNodes.filter((n) => (byId.get(n.id).themes || []).includes(activeTheme));
      if (tagged.length) set = tagged;
    }
    frameSet(set);
    focusId = null;
  }

  function applyEase() {
    if (!ease) return;
    const k = 0.08;
    cam.tx += (ease.tx - cam.tx) * k;
    cam.ty += (ease.ty - cam.ty) * k;
    cam.tz += (ease.tz - cam.tz) * k;
    cam.dist += (ease.dist - cam.dist) * k;
    cam.pitch += (ease.pitch - cam.pitch) * k;
    if (
      Math.abs(ease.tx - cam.tx) < 0.4 &&
      Math.abs(ease.ty - cam.ty) < 0.4 &&
      Math.abs(ease.tz - cam.tz) < 0.4 &&
      Math.abs(ease.dist - cam.dist) < 0.6
    ) {
      ease = null;
    }
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgba(hex, a) {
    const c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }
  function mix(hex, toward, t) {
    const a = hexToRgb(hex);
    const b = hexToRgb(toward);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  let cachedRadii = new Map();

  function recomputeRadii() {
    let max = 1;
    for (const n of graphNodes) if (n.size > max) max = n.size;
    cachedRadii = new Map();
    for (const n of graphNodes) {
      let r = 8 + 15 * Math.sqrt(n.size / max);
      if (n.id === 'ROOT') r += 4;
      cachedRadii.set(n.id, r);
    }
  }

  function worldRadius(node) {
    const hit = cachedRadii.get(node.id);
    if (hit != null) return hit;
    recomputeRadii();
    return cachedRadii.get(node.id) || 8;
  }

  function drawSphere(sx, sy, r, color, alpha) {
    const g = ctx.createRadialGradient(sx - r * 0.38, sy - r * 0.42, r * 0.1, sx, sy, r);
    g.addColorStop(0, mix(color, '#ffffff', 0.72));
    g.addColorStop(0.45, color);
    g.addColorStop(1, mix(color, '#07090f', 0.55));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createRadialGradient(width / 2, height * 0.45, 40, width / 2, height / 2, Math.max(width, height) * 0.72);
    bg.addColorStop(0, '#161b2e');
    bg.addColorStop(1, '#07090f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;

    for (const star of stars) {
      const p = project(star.x, star.y, star.z);
      if (!p) continue;
      ctx.globalAlpha = star.a * Math.min(1, 900 / p.z);
      ctx.fillStyle = '#d5d8ea';
      ctx.fillRect(cx + p.x, cy + p.y, star.s, star.s);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(212, 175, 96, 0.08)';
    ctx.lineWidth = 1;
    for (const radius of [200, 360]) {
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const p = project(Math.cos(a) * radius, -20, Math.sin(a) * radius);
        if (!p) continue;
        if (i === 0) ctx.moveTo(cx + p.x, cy + p.y);
        else ctx.lineTo(cx + p.x, cy + p.y);
      }
      ctx.stroke();
    }

    const projected = [];
    for (const n of graphNodes) {
      const p = project(n.x, n.y, n.z);
      n.sx = null;
      if (!p) continue;
      const themes = (byId.get(n.id) && byId.get(n.id).themes) || [];
      const tagged = !!(activeTheme && themes.includes(activeTheme));
      const pulse = tagged && spinning && !motionQuery.matches ? 1 + 0.07 * Math.sin(performance.now() / 260 + n.x * 0.01) : 1;
      const sr = Math.max(3.5, worldRadius(n) * p.s * pulse);
      n.sx = cx + p.x;
      n.sy = cy + p.y;
      n.sr = sr;
      n.sz = p.z;
      projected.push({ n, p, themes, tagged, sr });
    }
    projected.sort((a, b) => b.p.z - a.p.z);

    for (const l of graphLinks) {
      const a = nodeById.get(l.source);
      const b = nodeById.get(l.target);
      if (!a || !b || a.sx == null || b.sx == null) continue;
      const depth = (a.sz + b.sz) / 2;
      const fade = Math.max(0.08, Math.min(0.85, 520 / depth));
      ctx.beginPath();
      if (l.kind === 'see') {
        const mx = (a.sx + b.sx) / 2;
        const my = (a.sy + b.sy) / 2;
        const dx = b.sx - a.sx;
        const dy = b.sy - a.sy;
        const len = Math.hypot(dx, dy) || 1;
        const bend = Math.min(46, len * 0.18);
        const cpx = mx + (-dy / len) * bend;
        const cpy = my + (dx / len) * bend;
        ctx.moveTo(a.sx, a.sy);
        ctx.quadraticCurveTo(cpx, cpy, b.sx, b.sy);
        const shared = ((byId.get(a.id).themes || []).find((t) => (byId.get(b.id).themes || []).includes(t))) || null;
        ctx.strokeStyle = rgba(shared ? themeColor(shared) : '#d4af60', fade * 0.9);
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.25;
      } else {
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.strokeStyle = 'rgba(176, 184, 214,' + (0.28 * fade) + ')';
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const item of projected) {
      const n = item.n;
      const onPath = activeTheme ? hasTheme(n.id) || n.id === 'ROOT' : true;
      let alpha = 1;
      if (activeTheme) alpha = item.tagged || n.id === 'ROOT' ? 1 : onPath ? 0.62 : 0.3;
      const color = TYPE_COLOR[n.type] || '#9aa0b4';
      if (item.themes.length) {
        ctx.globalAlpha = (item.tagged ? 0.55 : 0.28) * alpha;
        const glow = ctx.createRadialGradient(n.sx, n.sy, item.sr * 0.4, n.sx, n.sy, item.sr * 2.3);
        const halo = item.tagged ? themeColor(activeTheme) : themeColor(item.themes[0]);
        glow.addColorStop(0, rgba(halo, 0.85));
        glow.addColorStop(1, rgba(halo, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, item.sr * 2.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      drawSphere(n.sx, n.sy, item.sr, color, alpha);

      item.themes.forEach((theme, i) => {
        const show = !activeTheme || theme === activeTheme;
        if (!show) return;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, item.sr + 4 + i * 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(themeColor(theme), item.tagged ? 0.95 : 0.75);
        ctx.lineWidth = item.tagged ? 2 : 1.25;
        ctx.stroke();
      });

      if (n.hasChildren) {
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, item.sr + 1.5, 0, Math.PI * 2);
        ctx.setLineDash(collapsed.has(n.id) ? [3, 3] : []);
        ctx.strokeStyle = collapsed.has(n.id) ? 'rgba(255,255,255,0.45)' : 'rgba(232, 228, 216, 0.8)';
        ctx.lineWidth = 1.25;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (n.id === selectedId) {
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, item.sr + 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    for (const n of graphNodes) n.labelBox = null;
    const labels = projected
      .map((item) => {
        const n = item.n;
        let score = item.sr;
        if (n.id === selectedId) score += 200;
        if (n.hover) score += 160;
        if (item.tagged) score += 80;
        if (n.id === 'ROOT') score += 40;
        const meta = byId.get(n.id);
        const pinLabel = noHover && !!(meta && meta.parentId === 'ROOT');
        if (pinLabel) score += 220;
        const force =
          n.id === selectedId || n.hover || item.tagged || n.id === 'ROOT' || item.sr > 15 || pinLabel;
        return { item, score, force, pinLabel };
      })
      .filter((row) => row.force)
      .sort((a, b) => b.score - a.score);

    const placed = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '12px Georgia, "Palatino Linotype", serif';
    let budget = 26;
    for (const row of labels) {
      const n = row.item.n;
      if (!row.force) continue;
      const pinLabel = row.pinLabel;
      if (!n.hover && n.id !== selectedId && !pinLabel) {
        if (budget <= 0) continue;
      }
      let text = n.label;
      const limit = graphNodes.length > 14 ? 32 : 42;
      if (text.length > limit) text = text.slice(0, limit - 1) + '…';
      const tw = ctx.measureText(text).width;
      const boxW = tw + 12;
      const boxH = 18;
      const minX = 4;
      const maxX = Math.max(minX, width - boxW - 4);
      const candidates = [
        n.sy - row.item.sr - 20,
        n.sy + row.item.sr + 6,
        n.sy - row.item.sr - 44,
        n.sy + row.item.sr + 28,
      ];
      const pad = 6;
      let box = null;
      for (const y0 of candidates) {
        let x = n.sx - boxW / 2;
        let y = y0;
        if (x < minX) x = minX;
        if (x > maxX) x = maxX;
        if (y < 4) y = 4;
        if (y + boxH > height - 4) y = Math.max(4, height - boxH - 4);
        const trial = { x, y, w: boxW, h: boxH };
        const hit = placed.some(
          (p) => trial.x - pad < p.x + p.w && trial.x + trial.w + pad > p.x && trial.y - pad < p.y + p.h && trial.y + trial.h + pad > p.y
        );
        if (!hit || n.id === selectedId || n.hover) {
          box = trial;
          break;
        }
      }
      if (!box && pinLabel) {
        let x = n.sx - boxW / 2;
        let y = candidates[0];
        if (x < minX) x = minX;
        if (x > maxX) x = maxX;
        if (y < 4) y = 4;
        if (y + boxH > height - 4) y = Math.max(4, height - boxH - 4);
        box = { x, y, w: boxW, h: boxH };
      }
      if (!box) {
        n.labelBox = null;
        continue;
      }
      placed.push(box);
      n.labelBox = box;
      if (n.id !== selectedId && !n.hover && !pinLabel) budget -= 1;
      ctx.fillStyle = 'rgba(8, 10, 16, 0.72)';
      roundRect(box.x, box.y, box.w, box.h, 4);
      ctx.fill();
      ctx.fillStyle = row.item.tagged ? themeColor(activeTheme) : '#e8e4d8';
      ctx.fillText(text, box.x + boxW / 2, box.y + boxH - 3);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function nodeAt(px, py) {
    let best = null;
    let bestZ = Infinity;
    for (const n of graphNodes) {
      if (n.sx == null) continue;
      const onSphere = Math.hypot(n.sx - px, n.sy - py) <= n.sr + 8;
      const box = n.labelBox;
      const onLabel = !!(box && px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h);
      if ((onSphere || onLabel) && n.sz < bestZ) {
        best = n;
        bestZ = n.sz;
      }
    }
    return best;
  }

  function expandPath(id) {
    let cur = byId.get(id);
    while (cur && cur.parentId) {
      collapsed.delete(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }

  function expandSubtree(id) {
    collapsed.delete(id);
    const n = byId.get(id);
    if (!n) return;
    n.childIds.forEach(expandSubtree);
  }

  function focusConcept(id) {
    if (!byId.has(id) || id === 'ROOT') return;
    const themes = byId.get(id).themes || [];
    if (activeTheme && !themes.includes(activeTheme) && !hasTheme(id)) {
      activeTheme = null;
      syncThemeButtons();
      updateBlurb();
      expandForTheme();
      applyFilter();
    }
    if (currentView === 'tree') {
      revealInTree(id);
    } else {
      expandPath(id);
      selectedId = id;
      rebuildGraphElements();
      focusId = id;
      frameAfter = 24;
      awake = 160;
      scheduleDraw();
    }
    showNodePanel(byId.get(id));
  }

  function revealInTree(id) {
    const sel = window.CSS && CSS.escape ? CSS.escape(id) : id;
    const el = treeEl.querySelector('.ont-node[data-id="' + sel + '"]');
    if (!el) return;
    let p = el;
    while (p) {
      if (p.tagName === 'DETAILS') p.open = true;
      p = p.parentElement ? p.parentElement.closest('.ont-node') : null;
    }
    el.classList.add('lens-hit');
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  function showNodePanel(ontNode) {
    if (!ontNode) return;
    const themes = ontNode.themes || [];
    const themeChips = themes
      .map((id) => {
        const t = themeById.get(id);
        if (!t) return '';
        return '<span class="theme-chip" style="color:' + t.color + ';border-color:' + t.color + '">' + escapeHtml(t.label) + '</span>';
      })
      .join('');
    const veil = VEIL_LABEL[ontNode.veil];
    let html = '<span class="ont-badge ' + (ontNode.type || 'Individual') + '">' + escapeHtml(typeBadgeText(ontNode.type)) + '</span>';
    if (themeChips) html += '<div class="theme-bar" style="margin:8px 0">' + themeChips + '</div>';
    if (veil) html += '<div class="theme-bar" style="margin-bottom:8px"><span class="theme-chip ' + veil[1] + '">' + veil[0] + '</span></div>';
    html += '<h2>' + escapeHtml(ontNode.label) + '</h2>';
    if (ontNode.summary) html += '<div class="ont-summary" style="max-width:none">' + escapeHtml(ontNode.summary) + '</div>';
    const verses = ontNode.verses || [];
    const fulfillment = ontNode.fulfillment || [];
    if (verses.length || fulfillment.length) {
      html += '<div class="ont-verses" style="margin-top:10px">';
      verses.forEach((ref) => {
        html += '<span class="ont-verse-chip" data-ref="' + ref + '">' + refLabel(ref) + '</span>';
      });
      if (fulfillment.length) {
        html += '<span class="ont-arrow">&rarr; fulfilled in</span>';
        fulfillment.forEach((ref) => {
          html += '<span class="ont-verse-chip fulfillment" data-ref="' + ref + '">' + refLabel(ref) + '</span>';
        });
      }
      html += '</div>';
    }
    if (ontNode.variantId) {
      html +=
        '<a class="ttl-link" href="textual-criticism.html#tv-' +
        encodeURIComponent(ontNode.variantId) +
        '">Open the textual-variants entry</a>';
    }
    const see = (ontNode.seeAlso || []).filter((id) => byId.has(id));
    if (see.length) {
      html += '<h3>Connected</h3><div class="theme-bar" id="seeAlsoBtns"></div>';
    }
    if (ontNode.childIds && ontNode.childIds.length) {
      const open = !collapsed.has(ontNode.id);
      html +=
        '<div class="stat-line" style="margin-top:12px">' +
        ontNode.childIds.length +
        ' sub-concept' +
        (ontNode.childIds.length === 1 ? '' : 's') +
        '. Click to ' +
        (open ? 'collapse' : 'expand') +
        '. Shift-click expands the whole branch.</div>';
    }
    if (ontNode.id !== 'ROOT') {
      html +=
        '<div class="graph-control-row" style="margin-top:12px"><button type="button" class="action-btn" id="openOtherView">' +
        (currentView === 'graph' ? 'Show in the tree' : 'Show in the 3D graph') +
        '</button></div>';
    }
    panelContent.innerHTML = html;
    panel.classList.remove('hidden');
    panelContent.querySelectorAll('.ont-verse-chip').forEach((chip) => {
      chip.onclick = () => onVerseChipClick(chip, chip.dataset.ref);
    });
    const seeWrap = document.getElementById('seeAlsoBtns');
    if (seeWrap) {
      see.forEach((id) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-btn';
        btn.textContent = byId.get(id).label;
        btn.onclick = () => focusConcept(id);
        seeWrap.appendChild(btn);
      });
    }
    const other = document.getElementById('openOtherView');
    if (other) {
      other.onclick = () => {
        if (currentView === 'graph') {
          setView('tree');
          revealInTree(ontNode.id);
          writeHash();
          showNodePanel(ontNode);
        } else {
          setView('graph');
          expandPath(ontNode.id);
          selectedId = ontNode.id;
          rebuildGraphElements();
          focusId = ontNode.id;
          frameAfter = 24;
          awake = 160;
          scheduleDraw();
          writeHash();
          showNodePanel(ontNode);
        }
      };
    }
  }
  panelClose.onclick = () => panel.classList.add('hidden');

  function onNodeClick(n, shiftKey, opts) {
    opts = opts || {};
    const meta = byId.get(n.id);
    selectedId = n.id;
    if (!opts.panelOnly && meta.childIds.length > 0) {
      if (shiftKey) expandSubtree(n.id);
      else if (collapsed.has(n.id)) collapsed.delete(n.id);
      else collapsed.add(n.id);
      rebuildGraphElements();
      awake = 180;
      scheduleDraw();
    }
    showNodePanel(meta);
  }

  function wireCanvasEvents() {
    const pointers = new Map();
    let gesture = null;
    let pinch = null;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      spinningPaused = true;
      userGesturing = true;
      scheduleDraw();
      if (pointers.size >= 2) {
        const pts = [...pointers.values()];
        pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, cam: cam.dist };
        gesture = null;
        return;
      }
      gesture = {
        x: e.clientX,
        y: e.clientY,
        ox: e.clientX,
        oy: e.clientY,
        button: e.button,
        shift: e.shiftKey,
        moved: false,
        pan: e.button === 2 || e.button === 1 || e.shiftKey,
      };
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (prev) {
        prev.x = e.clientX;
        prev.y = e.clientY;
      }
      if (pointers.size >= 2 && pinch) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        cam.dist = Math.max(180, Math.min(2000, pinch.cam * (pinch.dist / dist)));
        ease = null;
        return;
      }
      if (!gesture) {
        const rect = canvas.getBoundingClientRect();
        const hit = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
        canvas.style.cursor = hit ? 'pointer' : 'grab';
        for (const n of graphNodes) n.hover = false;
        if (hit) hit.hover = true;
        scheduleDraw();
        return;
      }
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (Math.hypot(e.clientX - gesture.ox, e.clientY - gesture.oy) > 5) gesture.moved = true;
      gesture.x = e.clientX;
      gesture.y = e.clientY;
      ease = null;
      if (gesture.pan) {
        const scale = cam.dist / cam.fov;
        const cyaw = Math.cos(cam.yaw);
        const syaw = Math.sin(cam.yaw);
        cam.tx -= dx * scale * cyaw;
        cam.tz -= dx * scale * syaw;
        cam.ty += dy * scale;
      } else {
        cam.yaw -= dx * 0.005;
        cam.pitch = Math.max(-1.15, Math.min(1.15, cam.pitch + dy * 0.0045));
      }
      canvas.classList.add('dragging');
    });
    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (gesture && pointers.size === 0) {
        if (!gesture.moved && gesture.button === 0) {
          const rect = canvas.getBoundingClientRect();
          const hit = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
          if (hit) onNodeClick(hit, gesture.shift);
          else panel.classList.add('hidden');
        }
        gesture = null;
        canvas.classList.remove('dragging');
      }
      if (pointers.size === 0) {
        spinningPaused = false;
        userGesturing = false;
        scheduleDraw();
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        ease = null;
        const factor = e.deltaY < 0 ? 0.9 : 1.1;
        cam.dist = Math.max(180, Math.min(2000, cam.dist * factor));
        scheduleDraw();
      },
      { passive: false }
    );
  }

  function syncSpinButton() {
    if (!spinBtn) return;
    spinBtn.classList.toggle('active', spinning);
    spinBtn.setAttribute('aria-pressed', spinning ? 'true' : 'false');
  }
  syncSpinButton();
  if (motionQuery.addEventListener) {
    motionQuery.addEventListener('change', (e) => {
      if (!e.matches) return;
      spinning = false;
      syncSpinButton();
    });
  }
  if (spinBtn) {
    spinBtn.addEventListener('click', () => {
      spinning = !spinning;
      syncSpinButton();
      scheduleDraw();
    });
  }
  if (resetViewBtn) {
    resetViewBtn.addEventListener('click', () => {
      cam.yaw = 0.62;
      cam.pitch = 0.4;
      ease = { tx: 0, ty: 8, tz: 0, dist: 760, pitch: 0.4 };
      frameAfter = activeTheme ? 20 : 0;
      focusId = null;
      scheduleDraw();
    });
  }

  function nearestNode() {
    let best = null;
    let bestD = Infinity;
    const cx = width / 2;
    const cy = height / 2;
    for (const n of graphNodes) {
      if (n.sx == null) continue;
      const d = Math.hypot(n.sx - cx, n.sy - cy);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  if (canvas) {
    canvas.addEventListener('keydown', (e) => {
      if (currentView !== 'graph') return;
      const step = e.shiftKey ? 0.1 : 0.06;
      let handled = true;
      if (e.key === 'ArrowLeft') cam.yaw -= step;
      else if (e.key === 'ArrowRight') cam.yaw += step;
      else if (e.key === 'ArrowUp') cam.pitch = Math.max(-1.15, Math.min(1.15, cam.pitch - step * 0.55));
      else if (e.key === 'ArrowDown') cam.pitch = Math.max(-1.15, Math.min(1.15, cam.pitch + step * 0.55));
      else if (e.key === '+' || e.key === '=' ) cam.dist = Math.max(180, cam.dist * 0.9);
      else if (e.key === '-' || e.key === '_') cam.dist = Math.min(2000, cam.dist * 1.1);
      else if (e.key === 'Enter') {
        const hit = nearestNode();
        if (hit) onNodeClick(hit, e.shiftKey, { panelOnly: true });
      } else handled = false;
      if (!handled) return;
      e.preventDefault();
      ease = null;
      scheduleDraw();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') panel.classList.add('hidden');
  });

  function shouldContinue() {
    if (currentView !== 'graph' || !graphNodes.length || !ctx) return false;
    if (userGesturing) return true;
    if (spinning && !spinningPaused) return true;
    if (awake > 0 || ease || frameAfter > 0) return true;
    return false;
  }

  function scheduleDraw() {
    if (renderScheduled || currentView !== 'graph') return;
    renderScheduled = true;
    requestAnimationFrame(loop);
  }

  function loop() {
    renderScheduled = false;
    if (currentView !== 'graph' || !graphNodes.length || !ctx) return;
    if (width < 2 || height < 2) resize();
    if (spinning && !spinningPaused && !ease) cam.yaw += 0.0016;
    physTick();
    applyEase();
    if (frameAfter > 0) {
      frameAfter -= 1;
      if (frameAfter === 0) frameVisible();
    }
    draw();
    if (shouldContinue()) scheduleDraw();
  }

  function bootGraph() {
    graphBooted = true;
    resize();
    wireCanvasEvents();
    rebuildGraphElements();
    frameAfter = 90;
    awake = 280;
    scheduleDraw();
  }

  function applyLocation() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!raw || raw === '3d') {
      setView('graph');
      return;
    }
    if (raw === 'tree') {
      setView('tree');
      return;
    }
    if (raw.startsWith('3d/')) {
      const theme = raw.slice(3);
      setView('graph');
      if (themeById.has(theme)) setTheme(theme, { toggle: false, silentHash: true });
      return;
    }
    if (raw.startsWith('lens/')) {
      const theme = raw.slice(5);
      setView('tree');
      if (themeById.has(theme)) setTheme(theme, { toggle: false, silentHash: true });
      return;
    }
    if (byId.has(raw)) {
      activeTheme = null;
      syncThemeButtons();
      updateBlurb();
      expandForTheme();
      expandPath(raw);
      selectedId = raw;
      focusId = raw;
      setView('graph');
      showNodePanel(byId.get(raw));
      return;
    }
    setView('graph');
  }

  window.addEventListener('hashchange', () => {
    if (!byId.size) return;
    applyLocation();
  });

  async function boot() {
    try {
      const [ont, books] = await Promise.all([
        fetch('data/ontology.json').then((r) => r.json()),
        fetch('data/books.json').then((r) => r.json()),
      ]);
      booksById = new Map(books.map((b) => [b.id, b]));
      render(ont);
      indexTree(ont);
      buildThemeBars();
      if (ontHint) ontHint.style.display = 'none';
      applyLocation();
      // The graph's first frame is already queued. Start the verse file on
      // the next frame so drawing is not gated on that download.
      requestAnimationFrame(() => loadBibleText());
    } catch (err) {
      if (treeEl) treeEl.textContent = 'Failed to load the ontology data. Check the console and try reloading.';
      if (ontHint) ontHint.textContent = 'Failed to load the ontology data.';
      console.error(err);
    }
  }
  boot();
})();
