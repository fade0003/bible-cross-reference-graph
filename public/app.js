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
  const controls = document.getElementById('controls');
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');

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

  // ---- View state ----
  let view = { level: 'books' }; // { level: 'books' } | { level: 'book', bookId } | { level: 'chapter', bookId, chapter }
  let minVotes = 5;
  let nodes = [];
  let links = [];
  let nodeById = new Map();
  let camera = { x: 0, y: 0, scale: 1 };

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

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  async function loadView() {
    hint.textContent = 'Loading…';
    hint.style.display = 'block';
    closePanel();

    if (view.level === 'books') {
      controls.style.display = 'none';
      const data = await fetchJSON('/api/graph/books');
      nodes = data.nodes.map((n) => ({ ...n, kind: 'book' }));
      links = data.links;
    } else if (view.level === 'book') {
      controls.style.display = 'none';
      const data = await fetchJSON(`/api/graph/book/${encodeURIComponent(view.bookId)}`);
      nodes = data.nodes.map((n) => ({ ...n, kind: n.external ? 'externalBook' : 'chapter', bookId: n.external ? n.bookId : view.bookId }));
      links = data.links;
      view.bookMeta = data.book;
    } else if (view.level === 'chapter') {
      controls.style.display = 'flex';
      const data = await fetchJSON(
        `/api/graph/chapter/${encodeURIComponent(view.bookId)}/${view.chapter}?minVotes=${minVotes}`
      );
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
    loadView();
  }
  function goToBook(bookId) {
    view = { level: 'book', bookId };
    loadView();
  }
  function goToChapter(bookId, chapter) {
    view = { level: 'chapter', bookId, chapter };
    loadView();
  }

  // ---- Physics ----
  function physTick(getRadius) {
    const REPEL = 2600;
    const SPRING = 0.02;
    const SPRING_LEN = 90;
    const GRAVITY = 0.0025;
    const DAMPING = 0.86;

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
      n.x += n.vx;
      n.y += n.vy;
    }
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

      if (n.text && r >= 11) {
        const word = themeWord(n.text);
        if (word) {
          ctx.fillStyle = '#12151f';
          drawFittedWord(word, n.x, n.y, r * 1.6, Math.max(7, Math.min(13, r * 0.5)));
        }
      }

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

  // Single always-visible "theme word" drawn inside a verse dot - the first
  // real content word once articles/pronouns/prepositions/auxiliaries are
  // skipped, so a glance at the dot hints at its topic without hovering.
  const THEME_STOP_WORDS = new Set([
    ...PREVIEW_LEAD_WORDS,
    'the', 'a', 'an', 'unto', 'he', 'she', 'it', 'they', 'we', 'i', 'thou', 'ye',
    'him', 'her', 'them', 'us', 'me', 'my', 'thy', 'his', 'their', 'our', 'your',
    'of', 'in', 'on', 'at', 'to', 'from', 'with', 'by', 'as', 'is', 'was', 'were',
    'are', 'be', 'been', 'being', 'shall', 'will', 'would', 'should', 'hath',
    'have', 'has', 'had', 'not', 'no', 'nor', 'all', 'also', 'which', 'who',
    'whom', 'whose', 'this', 'these', 'those', 'there', 'here', 'upon', 'into',
    'before', 'after', 'among', 'between',
  ]);
  function themeWord(text) {
    if (!text) return '';
    const words = text.replace(/[.,;:!?"“”]/g, '').split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length - 1 && THEME_STOP_WORDS.has(words[i].toLowerCase())) i++;
    const word = words[i];
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  // Shrinks the font until `word` fits within maxWidth, drawn centered at (cx, cy).
  function drawFittedWord(word, cx, cy, maxWidth, maxSize) {
    let size = maxSize;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${size}px Georgia, serif`;
    while (size > 6 && ctx.measureText(word).width > maxWidth) {
      size -= 1;
      ctx.font = `bold ${size}px Georgia, serif`;
    }
    if (size >= 6) ctx.fillText(word, cx, cy);
    ctx.textBaseline = 'alphabetic';
  }

  // ---- Interaction ----
  let dragNode = null;
  let isDragging = false;
  let dragStart = null;
  let panStart = null;
  let pinch = null; // { startDist, startScale } while two touches are down
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

  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { px: clientX - rect.left, py: clientY - rect.top };
  }

  // Shared by mouse and touch input so drag/pan/tap behave identically.
  function pointerDown(px, py) {
    const n = nodeAt(px, py);
    dragStart = { px, py };
    isDragging = false;
    if (n) {
      dragNode = n;
    } else {
      panStart = { camX: camera.x, camY: camera.y, px, py };
    }
  }

  function pointerMove(px, py) {
    if (!dragStart) return;
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
      camera.x = panStart.camX + (px - panStart.px);
      camera.y = panStart.camY + (py - panStart.py);
    }
  }

  function pointerUp() {
    if (dragNode && !isDragging) {
      handleNodeClick(dragNode);
    }
    dragNode = null;
    panStart = null;
    dragStart = null;
    isDragging = false;
  }

  canvas.addEventListener('mousedown', (e) => {
    const { px, py } = canvasPoint(e.clientX, e.clientY);
    pointerDown(px, py);
  });

  window.addEventListener('mousemove', (e) => {
    const { px, py } = canvasPoint(e.clientX, e.clientY);
    pointerMove(px, py);
  });

  window.addEventListener('mouseup', () => pointerUp());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    camera.scale = Math.max(0.15, Math.min(4, camera.scale * factor));
  }, { passive: false });

  canvas.addEventListener('mousemove', (e) => {
    if (dragNode) return;
    const { px, py } = canvasPoint(e.clientX, e.clientY);
    const n = nodeAt(px, py);
    canvas.style.cursor = n ? 'pointer' : 'grab';
    for (const nd of nodes) nd.hover = false;
    if (n) n.hover = true;
  });

  // ---- Touch (phones/tablets): one finger drags/pans/taps like the mouse;
  // two fingers pinch-zoom. preventDefault keeps the page itself from
  // scrolling/zooming while a gesture is happening on the canvas.
  function touchDist(t0, t1) {
    return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  }

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      pinch = null;
      const { px, py } = canvasPoint(e.touches[0].clientX, e.touches[0].clientY);
      pointerDown(px, py);
    } else if (e.touches.length === 2) {
      dragNode = null;
      panStart = null;
      dragStart = null;
      pinch = { startDist: touchDist(e.touches[0], e.touches[1]), startScale: camera.scale };
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      const dist = touchDist(e.touches[0], e.touches[1]);
      camera.scale = Math.max(0.15, Math.min(4, pinch.startScale * (dist / pinch.startDist)));
    } else if (e.touches.length === 1) {
      const { px, py } = canvasPoint(e.touches[0].clientX, e.touches[0].clientY);
      pointerMove(px, py);
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      pointerUp();
      pinch = null;
    } else if (e.touches.length === 1) {
      // Lifting one finger out of a pinch resumes as a pan, not a fresh tap.
      pinch = null;
      const { px, py } = canvasPoint(e.touches[0].clientX, e.touches[0].clientY);
      dragNode = null;
      dragStart = { px, py };
      isDragging = true;
      panStart = { camX: camera.x, camY: camera.y, px, py };
    }
  });
  canvas.addEventListener('touchcancel', () => {
    pointerUp();
    pinch = null;
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
    const detail = await fetchJSON(
      `/api/verse/${encodeURIComponent(bookId)}/${chapter}/${verse}?minVotes=${minVotes}`
    );
    const badgeClass = detail.book.apocryphal ? 'apocrypha' : detail.book.category;
    const badgeLabel = detail.book.apocryphal ? 'Apocrypha' : detail.book.category.toUpperCase();
    const inCurrentChapter = view.level === 'chapter' && view.bookId === bookId && view.chapter === chapter;

    let html = `
      <span class="badge ${badgeClass}">${badgeLabel}</span>
      <h2>${detail.book.name} ${detail.chapter}:${detail.verse}</h2>
      <div class="verse-text">${escapeHtml(detail.text)}</div>
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

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
  function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // ---- Vote slider ----
  minVotesInput.addEventListener('input', () => {
    minVotes = parseInt(minVotesInput.value, 10);
    minVotesVal.textContent = minVotes;
  });
  minVotesInput.addEventListener('change', () => {
    if (view.level === 'chapter') loadView();
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
    searchTimer = setTimeout(async () => {
      const data = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}`);
      renderSearchResults(data.results);
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
    draw(getRadius);
    requestAnimationFrame(loop);
  }

  window.__nav = { goToBooks, goToBook, goToChapter, openVersePanel, getState: () => ({ view, nodes, links, minVotes }) };

  resize();
  loadView();
  requestAnimationFrame(loop);
})();
