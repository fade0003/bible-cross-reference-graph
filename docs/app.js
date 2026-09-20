(() => {
  'use strict';

  const canvas = document.getElementById('graphCanvas');
  const ctx = canvas.getContext('2d');
  const hint = document.getElementById('hint');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const panel = document.getElementById('panel');
  const panelContent = document.getElementById('panelContent');
  const panelClose = document.getElementById('panelClose');
  const minVotesInput = document.getElementById('minVotes');
  const minVotesVal = document.getElementById('minVotesVal');
  const minVotesLabel = document.getElementById('minVotesLabel');
  const controls = document.getElementById('controls');
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const topVersesBtn = document.getElementById('topVersesBtn');

  const CAT_COLOR = {
    ot: '#5f8fd9',
    nt: '#6fce8f',
    apocrypha: '#e0473e',
  };

  let width, height;
  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener('resize', resize);

  // ---- Data (loaded once at boot, see boot() at the bottom - this replaces
  // the per-request Express API this app used to call) ----
  let bibleData = null;
  let textualVariants = [];

  function parseSimpleRef(ref) {
    const parts = ref.split('.');
    const verse = parseInt(parts.pop(), 10);
    const chapter = parseInt(parts.pop(), 10);
    const bookId = parts.join('.');
    return { bookId, chapter, verse };
  }
  // Does a curated MT/LXX/DSS variant (see textual-criticism.html) touch this
  // verse? Ranges are same-book only here (matches how they're authored).
  function findVariantForVerse(bookId, chapter, verse) {
    for (const v of textualVariants) {
      const idx = v.ref.indexOf('-');
      if (idx === -1) {
        const a = parseSimpleRef(v.ref);
        if (a.bookId === bookId && a.chapter === chapter && a.verse === verse) return v;
      } else {
        const a = parseSimpleRef(v.ref.slice(0, idx));
        const b = parseSimpleRef(v.ref.slice(idx + 1));
        if (a.bookId !== bookId || b.bookId !== bookId) continue;
        const pos = chapter * 1000 + verse;
        if (pos >= a.chapter * 1000 + a.verse && pos <= b.chapter * 1000 + b.verse) return v;
      }
    }
    return null;
  }

  // ---- View state ----
  let view = { level: 'books' }; // { level: 'books' } | { level: 'book', bookId } | { level: 'chapter', bookId, chapter }
  let minVotes = 15;
  let perNode = { books: 6, book: 5 };
  const SLIDER_CFG = {
    books: { min: 1, max: 15, step: 1, label: 'Links per book shown' },
    book: { min: 1, max: 12, step: 1, label: 'Links per chapter shown' },
    chapter: { min: 0, max: 80, step: 5, label: 'Min. link strength' },
  };
  let nodes = [];
  let links = [];
  let nodeById = new Map();
  let camera = { x: 0, y: 0, scale: 1 };
  let autoFit = true;

  function sizeScale(nodes) {
    const max = Math.max(1, ...nodes.map((n) => n.size));
    return (size) => 5 + 26 * Math.sqrt(size / max);
  }

  function layoutInit(nodeList) {
    const r = Math.min(width, height) * 0.38;
    nodeList.forEach((n, i) => {
      const angle = (i / nodeList.length) * Math.PI * 2;
      n.x = Math.cos(angle) * r + (Math.random() - 0.5) * 20;
      n.y = Math.sin(angle) * r + (Math.random() - 0.5) * 20;
      n.vx = 0;
      n.vy = 0;
    });
  }

  async function loadView() {
    hint.textContent = 'Loading…';
    hint.style.display = 'block';
    closePanel();
    autoFit = true;

    controls.style.display = 'flex';
    syncControlsToLevel();

    if (view.level === 'books') {
      const data = GraphCore.buildBookGraph(bibleData, perNode.books);
      nodes = data.nodes.map((n) => ({ ...n, kind: 'book' }));
      links = data.links;
    } else if (view.level === 'book') {
      const data = GraphCore.buildChapterGraph(bibleData, view.bookId, perNode.book);
      if (!data) throw new Error(`Unknown book: ${view.bookId}`);
      nodes = data.nodes.map((n) => ({ ...n, kind: n.external ? 'externalBook' : 'chapter', bookId: n.external ? n.bookId : view.bookId }));
      links = data.links;
      view.bookMeta = data.book;
    } else if (view.level === 'chapter') {
      const data = GraphCore.buildVerseGraph(bibleData, view.bookId, view.chapter, minVotes);
      if (!data) throw new Error(`Unknown book/chapter: ${view.bookId} ${view.chapter}`);
      nodes = data.nodes.map((n) => ({ ...n, kind: 'verse' }));
      links = data.links;
      view.bookMeta = data.book;
      view.verseCount = data.verseCount;
    }

    nodeById = new Map(nodes.map((n) => [n.id, n]));
    layoutInit(nodes);
    hint.style.display = 'none';
    renderBreadcrumb();
  }

  function syncControlsToLevel() {
    const cfg = SLIDER_CFG[view.level];
    minVotesLabel.textContent = cfg.label;
    minVotesInput.min = cfg.min;
    minVotesInput.max = cfg.max;
    minVotesInput.step = cfg.step;
    const current = view.level === 'chapter' ? minVotes : perNode[view.level];
    minVotesInput.value = current;
    minVotesVal.textContent = current;
  }

  function renderBreadcrumb() {
    breadcrumbEl.innerHTML = '';
    const crumbs = [{ label: 'Books', onClick: () => goToBooks() }];
    if (view.level === 'book' || view.level === 'chapter') {
      crumbs.push({
        label: view.bookMeta ? view.bookMeta.name : view.bookId,
        onClick: () => goToBook(view.bookId),
        current: view.level === 'book',
      });
    }
    if (view.level === 'chapter') {
      crumbs.push({ label: `Chapter ${view.chapter}`, current: true });
    }
    crumbs.forEach((c, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = ' › ';
        breadcrumbEl.appendChild(sep);
      }
      const span = document.createElement('span');
      span.textContent = c.label;
      if (c.current) span.className = 'current';
      else span.onclick = c.onClick;
      breadcrumbEl.appendChild(span);
    });
  }

  function goToBooks() {
    view = { level: 'books' };
    return loadView();
  }
  function goToBook(bookId) {
    view = { level: 'book', bookId };
    return loadView();
  }
  function goToChapter(bookId, chapter) {
    view = { level: 'chapter', bookId, chapter };
    return loadView();
  }

  // ---- Physics ----
  function physTick(getRadius) {
    const REPEL = 2600;
    const SPRING = 0.02;
    const SPRING_LEN = 90;
    const GRAVITY = 0.0025;
    const DAMPING = 0.86;
    // Explicit-Euler with a fixed step can blow up (velocity growing every
    // frame instead of settling) once the graph is sparse enough that spring
    // forces no longer counteract the repulsion; a hard speed cap keeps the
    // integration stable regardless of how many edges survive filtering.
    const MAX_SPEED = 40;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (a.fixed) continue;
      let fx = -a.x * GRAVITY;
      let fy = -a.y * GRAVITY;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const b = nodes[j];
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
    for (const l of links) {
      const a = nodeById.get(l.source);
      const b = nodeById.get(typeof l.target === 'object' ? l.target.id : l.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const diff = dist - SPRING_LEN;
      const fx = (dx / dist) * diff * SPRING;
      const fy = (dy / dist) * diff * SPRING;
      if (!a.fixed) { a.vx += fx; a.vy += fy; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    }
    for (const n of nodes) {
      if (n.fixed) continue;
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > MAX_SPEED) {
        n.vx = (n.vx / speed) * MAX_SPEED;
        n.vy = (n.vy / speed) * MAX_SPEED;
      }
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  // The force layout has no cooling/containment of its own - depending on
  // how connected the current graph is, nodes settle at wildly different
  // distances from the origin. Rather than tune physics constants per view,
  // keep the camera fitted to wherever the nodes actually end up until the
  // user manually pans/zooms.
  function fitCameraToNodes(getRadius) {
    if (nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
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

    for (const l of links) {
      const a = nodeById.get(l.source);
      const b = nodeById.get(typeof l.target === 'object' ? l.target.id : l.target);
      if (!a || !b) continue;
      const w = l.weight ? Math.min(4, 0.4 + Math.log2(l.weight + 1) * 0.35) : l.curated ? 1.6 : 0.6 + Math.min(2, (l.votes || 0) / 60);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = l.curated ? 'rgba(224, 71, 62, 0.55)' : 'rgba(160, 170, 210, 0.22)';
      ctx.lineWidth = w / camera.scale;
      ctx.stroke();
    }

    for (const n of nodes) {
      const r = getRadius(n.size);
      const color = colorFor(n);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = n.dimmed ? 0.35 : 1;
      ctx.fill();
      if (n.apocryphal) {
        ctx.lineWidth = 2 / camera.scale;
        ctx.strokeStyle = '#ffb3ac';
        ctx.stroke();
      }
      if (n.inFocus) {
        ctx.lineWidth = 2 / camera.scale;
        ctx.strokeStyle = '#d4af60';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (r > 9 || n.hover) {
        ctx.fillStyle = '#e8e4d8';
        ctx.font = `${Math.max(10, Math.min(14, r * 0.55))}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y - r - 6);

        if (n.hover && n.text) {
          const preview = topicalPreview(n.text);
          if (preview) {
            ctx.fillStyle = '#b7c1e0';
            ctx.font = `italic ${Math.max(9, Math.min(12, r * 0.45))}px Georgia, serif`;
            ctx.fillText(preview, n.x, n.y - r - 20);
          }
        }
      }
    }
    ctx.restore();
  }

  function colorFor(n) {
    if (n.apocryphal) return CAT_COLOR.apocrypha;
    return CAT_COLOR[n.category] || '#9aa0b4';
  }

  // Short hover hint for verse dots - not a real topic model, just the verse's
  // first few content words (leading conjunctions stripped) so a reader can
  // guess what a verse is about before opening its full text.
  const PREVIEW_LEAD_WORDS = new Set([
    'and', 'for', 'but', 'now', 'then', 'that', 'behold', 'verily', 'so', 'yet', 'when', 'if', 'because', 'o',
  ]);
  function topicalPreview(text) {
    if (!text) return '';
    const words = text.replace(/[.,;:!?"“”]/g, '').split(/\s+/).filter(Boolean);
    while (words.length > 4 && PREVIEW_LEAD_WORDS.has(words[0].toLowerCase())) words.shift();
    const preview = words.slice(0, 4).join(' ');
    return words.length > 4 ? `${preview}…` : preview;
  }

  // ---- Interaction ----
  let dragNode = null;
  let isDragging = false;
  let dragStart = null;
  let panStart = null;
  let getRadiusFn = () => 8;

  function toWorld(px, py) {
    return {
      x: (px - width / 2 - camera.x) / camera.scale,
      y: (py - height / 2 - camera.y) / camera.scale,
    };
  }

  function nodeAt(px, py) {
    const p = toWorld(px, py);
    let best = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const r = getRadiusFn(n.size) + 3;
      const dx = n.x - p.x;
      const dy = n.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < r && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const n = nodeAt(px, py);
    dragStart = { px, py };
    isDragging = false;
    if (n) {
      dragNode = n;
    } else {
      panStart = { camX: camera.x, camY: camera.y, px, py };
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (Math.abs(px - dragStart.px) > 3 || Math.abs(py - dragStart.py) > 3) {
      isDragging = true;
    }
    if (dragNode && isDragging) {
      const p = toWorld(px, py);
      dragNode.x = p.x;
      dragNode.y = p.y;
      dragNode.vx = 0;
      dragNode.vy = 0;
    } else if (panStart) {
      autoFit = false;
      camera.x = panStart.camX + (px - panStart.px);
      camera.y = panStart.camY + (py - panStart.py);
    }
  });

  window.addEventListener('mouseup', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (dragNode && !isDragging) {
      handleNodeClick(dragNode);
    }
    dragNode = null;
    panStart = null;
    dragStart = null;
    isDragging = false;
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
    for (const nd of nodes) nd.hover = false;
    if (n) n.hover = true;
  });

  function handleNodeClick(n) {
    if (view.level === 'books') {
      goToBook(n.id);
    } else if (view.level === 'book') {
      if (n.external) {
        goToBook(n.bookId);
      } else {
        goToChapter(view.bookId, n.chapter);
      }
    } else if (view.level === 'chapter') {
      openVersePanel(n.bookId, n.chapter, n.verse);
    }
  }

  // ---- Panel ----
  function closePanel() {
    panel.classList.add('hidden');
  }
  panelClose.onclick = closePanel;

  async function openVersePanel(bookId, chapter, verse) {
    const detail = GraphCore.verseDetail(bibleData, bookId, chapter, verse, minVotes);
    if (!detail) throw new Error(`Unknown verse: ${bookId} ${chapter}:${verse}`);
    const badgeClass = detail.book.apocryphal ? 'apocrypha' : detail.book.category;
    const badgeLabel = detail.book.apocryphal ? 'Apocrypha' : detail.book.category.toUpperCase();
    const inCurrentChapter = view.level === 'chapter' && view.bookId === bookId && view.chapter === chapter;

    const variant = findVariantForVerse(bookId, chapter, verse);
    let html = `
      <span class="badge ${badgeClass}">${badgeLabel}</span>
      <h2>${detail.book.name} ${detail.chapter}:${detail.verse}</h2>
      <div class="verse-text">${escapeHtml(detail.text)}</div>
      ${
        variant
          ? `<div class="variant-note"><a href="textual-criticism.html#tv-${variant.id}" target="_blank" rel="noopener">&#9888; Textual variant (MT/LXX${variant.dss ? '/DSS' : ''}): ${escapeHtml(variant.title)} &rsaquo;</a></div>`
          : ''
      }
      <div class="stat-line">${detail.degree} total linkage${detail.degree === 1 ? '' : 's'} to this verse</div>
    `;
    if (!inCurrentChapter) {
      html += `<button class="action-btn" id="goToChapterBtn">View ${detail.book.name} ${detail.chapter} &rsaquo;</button>`;
    }
    html += `<h3>Cross-references (${detail.connections.length})</h3>`;
    if (detail.connections.length === 0) {
      html += `<div class="stat-line">No links at the current strength threshold.</div>`;
    }
    for (const c of detail.connections) {
      const refLabel = c.rangeEnd ? `${c.ref}&ndash;${c.rangeEnd.split(' ').slice(-1)[0]}` : c.ref;
      html += `
        <div class="conn-item" data-book="${c.bookId}" data-chapter="${c.chapter}" data-verse="${c.verse}">
          <div><span class="conn-ref ${c.apocryphal ? 'apocrypha' : ''}">${refLabel}</span>${
            c.curated ? '<span class="conn-votes">curated</span>' : `<span class="conn-votes">${c.votes} votes</span>`
          }</div>
          ${c.text ? `<div class="conn-text">${escapeHtml(truncate(c.text, 160))}</div>` : ''}
          ${c.note ? `<div class="conn-note">${escapeHtml(c.note)}</div>` : ''}
        </div>
      `;
    }
    panelContent.innerHTML = html;
    panel.classList.remove('hidden');

    if (!inCurrentChapter) {
      document.getElementById('goToChapterBtn').onclick = () => goToChapter(bookId, chapter);
    }
    panelContent.querySelectorAll('.conn-item').forEach((el) => {
      el.onclick = () => {
        const b = el.dataset.book;
        const ch = parseInt(el.dataset.chapter, 10);
        const v = parseInt(el.dataset.verse, 10);
        if (view.level === 'chapter' && view.bookId === b && view.chapter === ch) {
          openVersePanel(b, ch, v);
        } else {
          goToChapter(b, ch).then(() => openVersePanel(b, ch, v));
        }
      };
    });
  }

  // ---- Top cross-referenced verses ----
  async function openTopVersesPanel() {
    const results = GraphCore.topVerses(bibleData, { limit: 50 });
    let html = `
      <h2>Most cross-referenced verses</h2>
      <div class="stat-line">Ranked by total linkage count, across the whole Bible.</div>
    `;
    results.forEach((v, i) => {
      html += `
        <div class="conn-item" data-book="${v.bookId}" data-chapter="${v.chapter}" data-verse="${v.verse}">
          <div><span class="conn-ref ${v.apocryphal ? 'apocrypha' : ''}">${i + 1}. ${v.label}</span><span class="conn-votes">${v.degree} linkages</span></div>
          ${v.text ? `<div class="conn-text">${escapeHtml(truncate(v.text, 160))}</div>` : ''}
        </div>
      `;
    });
    panelContent.innerHTML = html;
    panel.classList.remove('hidden');
    panelContent.querySelectorAll('.conn-item').forEach((el) => {
      el.onclick = () => {
        const b = el.dataset.book;
        const ch = parseInt(el.dataset.chapter, 10);
        const v = parseInt(el.dataset.verse, 10);
        goToChapter(b, ch).then(() => openVersePanel(b, ch, v));
      };
    });
  }
  topVersesBtn.addEventListener('click', openTopVersesPanel);

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
  function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // ---- Link-strength / link-count slider ----
  minVotesInput.addEventListener('input', () => {
    const val = parseInt(minVotesInput.value, 10);
    minVotesVal.textContent = val;
    if (view.level === 'chapter') minVotes = val;
    else perNode[view.level] = val;
  });
  minVotesInput.addEventListener('change', () => {
    loadView();
  });

  // ---- Search ----
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      searchResults.classList.remove('open');
      return;
    }
    searchTimer = setTimeout(() => {
      renderSearchResults(GraphCore.search(bibleData, q));
    }, 200);
  });
  document.addEventListener('click', (e) => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
      searchResults.classList.remove('open');
    }
  });

  function renderSearchResults(results) {
    if (results.length === 0) {
      searchResults.classList.remove('open');
      return;
    }
    searchResults.innerHTML = results
      .map(
        (r, i) =>
          `<div class="item" data-i="${i}">${r.label}<span class="tag">${r.type}</span></div>`
      )
      .join('');
    searchResults.classList.add('open');
    searchResults.querySelectorAll('.item').forEach((el, i) => {
      el.onclick = () => {
        const r = results[i];
        searchResults.classList.remove('open');
        searchInput.value = '';
        if (r.type === 'book') goToBook(r.bookId);
        else if (r.type === 'chapter') goToChapter(r.bookId, r.chapter);
        else if (r.type === 'verse') {
          goToChapter(r.bookId, r.chapter).then(() => openVersePanel(r.bookId, r.chapter, r.verse));
        }
      };
    });
  }

  // ---- Main loop ----
  function loop() {
    const getRadius = sizeScale(nodes);
    getRadiusFn = getRadius;
    physTick(getRadius);
    if (autoFit) fitCameraToNodes(getRadius);
    draw(getRadius);
    requestAnimationFrame(loop);
  }

  window.__nav = { goToBooks, goToBook, goToChapter, openVersePanel, getState: () => ({ view, nodes, links, minVotes }) };

  async function boot() {
    resize();
    hint.textContent = 'Loading Bible data…';
    hint.style.display = 'block';
    try {
      bibleData = await GraphCore.getData((msg) => {
        hint.textContent = msg;
      });
    } catch (err) {
      hint.textContent = 'Failed to load Bible data. Check the console and try reloading.';
      console.error(err);
      return;
    }
    try {
      const tv = await fetch('data/textual-variants.json').then((r) => r.json());
      textualVariants = tv.variants;
    } catch (err) {
      console.error('Textual variants unavailable (non-fatal):', err);
    }
    await loadView();
    requestAnimationFrame(loop);
  }
  boot();
})();
