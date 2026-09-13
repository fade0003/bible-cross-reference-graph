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

  // =====================================================================
  // Node-graph view: the same tree, laid out as a collapsible force-directed
  // graph (same physics pattern as the main graph page's app.js). Starts
  // with just the root + top-level branches visible; clicking a node with
  // children expands/collapses it.
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

  const TYPE_COLOR = {
    Class: '#d4af60',
    Event: '#9dc0f2',
    Individual: '#a6e6bc',
    Person: '#a6e6bc',
    Prophecy: '#ff8b83',
    Type: '#e0a798',
    Covenant: '#c9a6f7',
    Nephilim: '#f2a65f',
  };

  let byId = new Map(); // nodeId -> ontology node (with .parentId, .childIds added)
  let rootIds = [];
  let collapsed = new Set();
  let graphNodes = [];
  let graphLinks = [];
  let nodeById = new Map();
  let currentView = 'tree';

  function indexTree(ont) {
    byId = new Map();
    rootIds = ont.tree.map((n) => n.id);
    function walk(node, parentId) {
      byId.set(node.id, { ...node, parentId, childIds: (node.children || []).map((c) => c.id) });
      (node.children || []).forEach((c) => walk(c, node.id));
    }
    ont.tree.forEach((n) => walk(n, 'ROOT'));
    byId.set('ROOT', { id: 'ROOT', label: 'Divine Council Worldview', type: 'Class', parentId: null, childIds: rootIds, summary: '' });
    collapsed = new Set([...byId.keys()].filter((id) => id !== 'ROOT'));
  }

  function descendantCount(id) {
    const n = byId.get(id);
    if (!n || n.childIds.length === 0) return 0;
    return n.childIds.reduce((sum, c) => sum + 1 + descendantCount(c), 0);
  }

  // ---- View toggle ----
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
      resize();
    }
  }
  viewTreeBtn.addEventListener('click', () => setView('tree'));
  viewGraphBtn.addEventListener('click', () => setView('graph'));

  let graphBooted = false;
  let width, height;
  function resize() {
    if (!canvas) return;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener('resize', () => {
    if (currentView === 'graph') resize();
  });

  let camera = { x: 0, y: 0, scale: 1 };
  let autoFit = true;

  function visibleIds() {
    const out = ['ROOT'];
    function walk(id) {
      const n = byId.get(id);
      if (collapsed.has(id)) return;
      for (const c of n.childIds) {
        out.push(c);
        walk(c);
      }
    }
    walk('ROOT');
    return out;
  }

  function rebuildGraphElements() {
    const ids = new Set(visibleIds());
    const prevById = new Map(graphNodes.map((n) => [n.id, n]));

    graphNodes = [...ids].map((id) => {
      const n = byId.get(id);
      const prev = prevById.get(id);
      if (prev) return prev;
      const parent = prevById.get(n.parentId);
      return {
        id,
        label: n.label,
        type: n.type,
        hasChildren: n.childIds.length > 0,
        size: 1 + descendantCount(id),
        x: parent ? parent.x + (Math.random() - 0.5) * 40 : (Math.random() - 0.5) * 60,
        y: parent ? parent.y + (Math.random() - 0.5) * 40 : (Math.random() - 0.5) * 60,
        vx: 0,
        vy: 0,
      };
    });
    nodeById = new Map(graphNodes.map((n) => [n.id, n]));
    graphLinks = [...ids]
      .filter((id) => id !== 'ROOT')
      .map((id) => ({ source: byId.get(id).parentId, target: id }))
      .filter((l) => nodeById.has(l.source) && nodeById.has(l.target));
    autoFit = true;
  }

  function sizeScale(nodes) {
    const max = Math.max(1, ...nodes.map((n) => n.size));
    return (size) => 6 + 22 * Math.sqrt(size / max);
  }

  function physTick(getRadius) {
    const REPEL = 2200;
    const SPRING = 0.03;
    const SPRING_LEN = 70;
    const GRAVITY = 0.006;
    const DAMPING = 0.85;
    const MAX_SPEED = 40;

    for (let i = 0; i < graphNodes.length; i++) {
      const a = graphNodes[i];
      let fx = -a.x * GRAVITY;
      let fy = -a.y * GRAVITY;
      for (let j = 0; j < graphNodes.length; j++) {
        if (i === j) continue;
        const b = graphNodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const f = REPEL / d2;
        const d = Math.sqrt(d2);
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      a.vx = (a.vx + fx) * DAMPING;
      a.vy = (a.vy + fy) * DAMPING;
    }
    for (const l of graphLinks) {
      const a = nodeById.get(l.source);
      const b = nodeById.get(l.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const diff = dist - SPRING_LEN;
      const fx = (dx / dist) * diff * SPRING;
      const fy = (dy / dist) * diff * SPRING;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const n of graphNodes) {
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > MAX_SPEED) {
        n.vx = (n.vx / speed) * MAX_SPEED;
        n.vy = (n.vy / speed) * MAX_SPEED;
      }
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  function fitCameraToNodes(getRadius) {
    if (graphNodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graphNodes) {
      const r = getRadius(n.size);
      minX = Math.min(minX, n.x - r);
      maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r);
      maxY = Math.max(maxY, n.y + r);
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const targetScale = Math.max(0.15, Math.min(4, Math.min(width / (bw * 1.25), height / (bh * 1.25))));
    const targetX = -cx * targetScale;
    const targetY = -cy * targetScale;
    camera.scale += (targetScale - camera.scale) * 0.08;
    camera.x += (targetX - camera.x) * 0.08;
    camera.y += (targetY - camera.y) * 0.08;
  }

  function draw(getRadius) {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2 + camera.x, height / 2 + camera.y);
    ctx.scale(camera.scale, camera.scale);

    for (const l of graphLinks) {
      const a = nodeById.get(l.source);
      const b = nodeById.get(l.target);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(160, 170, 210, 0.3)';
      ctx.lineWidth = 1 / camera.scale;
      ctx.stroke();
    }

    for (const n of graphNodes) {
      const r = getRadius(n.size);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = TYPE_COLOR[n.type] || '#9aa0b4';
      ctx.fill();
      if (n.hasChildren) {
        ctx.lineWidth = 2 / camera.scale;
        ctx.strokeStyle = collapsed.has(n.id) ? 'rgba(255,255,255,0.5)' : 'rgba(212, 175, 96, 0.8)';
        ctx.stroke();
      }
      if (r > 8 || n.hover) {
        ctx.fillStyle = '#e8e4d8';
        ctx.font = `${Math.max(10, Math.min(14, r * 0.5))}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y - r - 6);
      }
    }
    ctx.restore();
  }

  // ---- Interaction ----
  let dragNode = null, isDragging = false, dragStart = null, panStart = null;
  let getRadiusFn = () => 8;

  function toWorld(px, py) {
    return { x: (px - width / 2 - camera.x) / camera.scale, y: (py - height / 2 - camera.y) / camera.scale };
  }
  function nodeAt(px, py) {
    const p = toWorld(px, py);
    let best = null, bestD = Infinity;
    for (const n of graphNodes) {
      const r = getRadiusFn(n.size) + 3;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  function wireCanvasEvents() {
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const n = nodeAt(px, py);
      dragStart = { px, py };
      isDragging = false;
      if (n) dragNode = n;
      else panStart = { camX: camera.x, camY: camera.y, px, py };
    });
    window.addEventListener('mousemove', (e) => {
      if (currentView !== 'graph' || !dragStart) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (Math.abs(px - dragStart.px) > 3 || Math.abs(py - dragStart.py) > 3) isDragging = true;
      if (dragNode && isDragging) {
        const p = toWorld(px, py);
        dragNode.x = p.x; dragNode.y = p.y; dragNode.vx = 0; dragNode.vy = 0;
      } else if (panStart) {
        autoFit = false;
        camera.x = panStart.camX + (px - panStart.px);
        camera.y = panStart.camY + (py - panStart.py);
      }
    });
    window.addEventListener('mouseup', () => {
      if (currentView !== 'graph') return;
      if (dragNode && !isDragging) handleNodeClick(dragNode);
      dragNode = null; panStart = null; dragStart = null; isDragging = false;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      autoFit = false;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      camera.scale = Math.max(0.15, Math.min(4, camera.scale * factor));
    }, { passive: false });
    canvas.addEventListener('mousemove', (e) => {
      if (dragNode) return;
      const rect = canvas.getBoundingClientRect();
      const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
      canvas.style.cursor = n ? 'pointer' : 'grab';
      for (const nd of graphNodes) nd.hover = false;
      if (n) n.hover = true;
    });
  }

  function handleNodeClick(n) {
    const ontNode = byId.get(n.id);
    if (ontNode.childIds.length > 0) {
      if (collapsed.has(n.id)) collapsed.delete(n.id);
      else collapsed.add(n.id);
      rebuildGraphElements();
    }
    showNodePanel(ontNode);
  }

  function showNodePanel(ontNode) {
    let html = `
      <span class="ont-badge ${ontNode.type || 'Individual'}">${ontNode.type || 'Individual'}</span>
      <h2>${escapeHtml(ontNode.label)}</h2>
    `;
    if (ontNode.summary) html += `<div class="ont-summary" style="max-width:none">${escapeHtml(ontNode.summary)}</div>`;
    const verses = ontNode.verses || [];
    const fulfillment = ontNode.fulfillment || [];
    if (verses.length || fulfillment.length) {
      html += `<div class="ont-verses" style="margin-top:10px">`;
      verses.forEach((ref) => {
        html += `<span class="ont-verse-chip" data-ref="${ref}">${refLabel(ref)}</span>`;
      });
      if (fulfillment.length) {
        html += `<span class="ont-arrow">&rarr; fulfilled in</span>`;
        fulfillment.forEach((ref) => {
          html += `<span class="ont-verse-chip fulfillment" data-ref="${ref}">${refLabel(ref)}</span>`;
        });
      }
      html += `</div>`;
    }
    if (ontNode.childIds && ontNode.childIds.length) {
      html += `<div class="stat-line" style="margin-top:12px">${ontNode.childIds.length} sub-concept${ontNode.childIds.length === 1 ? '' : 's'} - click the node again to ${collapsed.has(ontNode.id) ? 'expand' : 'collapse'}.</div>`;
    }
    panelContent.innerHTML = html;
    panel.classList.remove('hidden');
    panelContent.querySelectorAll('.ont-verse-chip').forEach((chip) => {
      chip.onclick = () => onVerseChipClick(chip, chip.dataset.ref);
    });
  }
  panelClose.onclick = () => panel.classList.add('hidden');

  function loop() {
    if (currentView === 'graph' && graphNodes.length) {
      const getRadius = sizeScale(graphNodes);
      getRadiusFn = getRadius;
      physTick(getRadius);
      if (autoFit) fitCameraToNodes(getRadius);
      draw(getRadius);
    }
    requestAnimationFrame(loop);
  }

  function bootGraph() {
    graphBooted = true;
    resize();
    wireCanvasEvents();
    rebuildGraphElements();
    requestAnimationFrame(loop);
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
      indexTree(ont);
      ontHint.style.display = 'none';
    } catch (err) {
      treeEl.textContent = 'Failed to load the ontology data. Check the console and try reloading.';
      console.error(err);
    }
  }
  boot();
})();
