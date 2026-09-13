(() => {
  'use strict';

  const canvas = document.getElementById('tlCanvas');
  const ctx = canvas.getContext('2d');
  const hint = document.getElementById('hint');
  const minVotesInput = document.getElementById('minVotes');
  const minVotesVal = document.getElementById('minVotesVal');
  const tooltip = document.getElementById('tlTooltip');
  const modeCanonicalBtn = document.getElementById('modeCanonicalBtn');
  const modeYearBtn = document.getElementById('modeYearBtn');
  const bookFilter = document.getElementById('bookFilter');
  const legendNote = document.getElementById('tlLegendNote');
  const footerNote = document.getElementById('tlFooterNote');
  const panel = document.getElementById('panel');
  const panelContent = document.getElementById('panelContent');
  const panelClose = document.getElementById('panelClose');

  const CAT_COLOR = { ot: '#5f8fd9', nt: '#6fce8f', apocrypha: '#e0473e' };
  const NICE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

  let width, height;
  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    draw();
  }
  window.addEventListener('resize', resize);

  let bibleData = null;
  let positions = null; // { index, bookRanges, total }
  let chronIndex = null; // { anchors, minYear, maxYear }
  let allEdges = []; // filtered by minVotes + book, raw edge objects (mode-independent)
  let allArcs = []; // { x1, x2, ...edge } - recomputed per mode
  let visibleArcs = [];
  let minVotes = 35;
  let mode = 'canonical'; // 'canonical' | 'year'
  let filterBookId = '';

  const BASELINE_MARGIN = 60;
  let camera = { x: 0, scale: 1 };

  function baselineY() {
    return height - BASELINE_MARGIN;
  }
  function screenX(worldX) {
    return worldX * camera.scale + camera.x;
  }
  function worldXOf(screenXVal) {
    return (screenXVal - camera.x) / camera.scale;
  }

  function worldMin() {
    return mode === 'year' ? chronIndex.minYear : 0;
  }
  function worldMax() {
    return mode === 'year' ? chronIndex.maxYear : positions.total;
  }

  function pointWorldX(ref) {
    const pos = positions.index.get(GraphCore.verseKey(ref.bookId, ref.chapter, ref.verse));
    if (pos === undefined) return null;
    return mode === 'year' ? GraphCore.yearForPosition(chronIndex, pos) : pos;
  }

  function buildEdges() {
    allEdges = bibleData.edges.filter((e) => {
      if (!e.curated && e.votes < minVotes) return false;
      if (filterBookId && e.from.bookId !== filterBookId && e.to.bookId !== filterBookId) return false;
      return true;
    });
  }

  function buildArcs() {
    const arcs = [];
    for (const e of allEdges) {
      const x1 = pointWorldX(e.from);
      const x2 = pointWorldX(e.to);
      if (x1 === null || x2 === null) continue;
      arcs.push({
        x1: Math.min(x1, x2),
        x2: Math.max(x1, x2),
        curated: e.curated,
        votes: e.votes,
        from: e.from,
        to: e.to,
      });
    }
    allArcs = arcs;
  }

  function fitToWholeBible() {
    const wMin = worldMin();
    const wMax = worldMax();
    camera.scale = width / (wMax - wMin);
    camera.x = -wMin * camera.scale;
  }

  function niceStep(raw) {
    for (const s of NICE_STEPS) if (s >= raw) return s;
    return NICE_STEPS[NICE_STEPS.length - 1];
  }

  function yearLabel(y) {
    const r = Math.round(y);
    return r < 0 ? `${-r} BC` : `AD ${r}`;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    if (!positions) return;
    const by = baselineY();

    if (mode === 'canonical') {
      for (const b of positions.bookRanges) {
        const sx1 = screenX(b.start);
        const sx2 = screenX(b.end);
        if (sx2 < 0 || sx1 > width) continue;
        const highlighted = filterBookId && filterBookId === b.bookId;
        ctx.fillStyle = highlighted
          ? 'rgba(212, 175, 96, 0.14)'
          : b.apocryphal
          ? 'rgba(224, 71, 62, 0.05)'
          : b.category === 'ot'
          ? 'rgba(95, 143, 217, 0.04)'
          : 'rgba(111, 206, 143, 0.04)';
        ctx.fillRect(sx1, 20, sx2 - sx1, by - 20);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.moveTo(sx1, 20);
        ctx.lineTo(sx1, by);
        ctx.stroke();

        const segWidth = sx2 - sx1;
        if (segWidth > 34) {
          ctx.save();
          ctx.fillStyle = highlighted ? '#d4af60' : '#8a8ea8';
          ctx.font = '10px Georgia, serif';
          ctx.translate((sx1 + sx2) / 2, by + 14);
          ctx.rotate(segWidth < 60 ? -Math.PI / 3 : 0);
          ctx.textAlign = segWidth < 60 ? 'right' : 'center';
          ctx.fillText(b.name, 0, 0);
          ctx.restore();
        }
      }
    } else {
      const wLeft = worldXOf(0);
      const wRight = worldXOf(width);
      const targetPx = 90;
      const step = niceStep((targetPx / camera.scale) || 1);
      const start = Math.floor(wLeft / step) * step;
      ctx.font = '10px Georgia, serif';
      ctx.textAlign = 'center';
      for (let y = start; y <= wRight; y += step) {
        const sx = screenX(y);
        if (sx < -20 || sx > width + 20) continue;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.moveTo(sx, 20);
        ctx.lineTo(sx, by);
        ctx.stroke();
        ctx.fillStyle = '#8a8ea8';
        ctx.fillText(yearLabel(y), sx, by + 14);
      }
    }

    ctx.strokeStyle = 'rgba(212, 175, 96, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, by);
    ctx.lineTo(width, by);
    ctx.stroke();

    const wLeft = worldXOf(0);
    const wRight = worldXOf(width);
    visibleArcs = allArcs.filter((a) => a.x2 >= wLeft && a.x1 <= wRight);

    for (const a of visibleArcs) {
      const sx1 = screenX(a.x1);
      const sx2 = screenX(a.x2);
      const span = sx2 - sx1;
      const arcHeight = Math.min(by - 30, span * 0.5);
      ctx.beginPath();
      ctx.moveTo(sx1, by);
      ctx.quadraticCurveTo((sx1 + sx2) / 2, by - arcHeight, sx2, by);
      ctx.strokeStyle = a.curated ? 'rgba(224, 71, 62, 0.5)' : 'rgba(160, 170, 210, 0.35)';
      ctx.lineWidth = a.curated ? 1.3 : Math.min(2.2, 0.5 + Math.log2((a.votes || 1) + 1) * 0.25);
      ctx.stroke();
    }
  }

  // ---- Interaction: drag pan, wheel zoom, click select, hover tooltip ----
  let dragStart = null;
  let isDragging = false;
  canvas.addEventListener('mousedown', (e) => {
    dragStart = { x: e.clientX, camX: camera.x };
    isDragging = false;
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mouseup', (e) => {
    if (dragStart && !isDragging) {
      handleClick(e);
    }
    dragStart = null;
    isDragging = false;
    canvas.style.cursor = 'grab';
  });
  window.addEventListener('mousemove', (e) => {
    if (dragStart) {
      if (Math.abs(e.clientX - dragStart.x) > 3) isDragging = true;
      camera.x = dragStart.camX + (e.clientX - dragStart.x);
      draw();
      tooltip.classList.add('hidden');
      return;
    }
    handleHover(e);
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const before = worldXOf(px);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const minScale = width / (worldMax() - worldMin());
      camera.scale = Math.max(minScale, Math.min(8000, camera.scale * factor));
      const after = worldXOf(px);
      camera.x += (after - before) * camera.scale;
      draw();
    },
    { passive: false }
  );

  function nearestArc(px, py) {
    const by = baselineY();
    if (py > by || py < 15) return null;
    let best = null;
    let bestD = 8;
    for (const a of visibleArcs) {
      const sx1 = screenX(a.x1);
      const sx2 = screenX(a.x2);
      const span = sx2 - sx1;
      const arcHeight = Math.min(by - 30, span * 0.5);
      for (let t = 0; t <= 1; t += 0.08) {
        const x = (1 - t) * (1 - t) * sx1 + 2 * (1 - t) * t * (sx1 + sx2) / 2 + t * t * sx2;
        const y = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * (by - arcHeight) + t * t * by;
        const d = Math.hypot(x - px, y - py);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
    }
    return best;
  }

  function handleHover(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const best = nearestArc(px, py);
    if (best) {
      const fromName = bibleData.booksById.get(best.from.bookId).name;
      const toName = bibleData.booksById.get(best.to.bookId).name;
      tooltip.textContent = `${fromName} ${best.from.chapter}:${best.from.verse}  ↔  ${toName} ${best.to.chapter}:${best.to.verse}${
        best.curated ? '  (curated)' : `  (${best.votes} votes)`
      }`;
      tooltip.style.left = px + 14 + 'px';
      tooltip.style.top = py - 10 + 'px';
      tooltip.classList.remove('hidden');
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.classList.add('hidden');
      canvas.style.cursor = 'grab';
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function verseBlock(ref) {
    const book = bibleData.booksById.get(ref.bookId);
    const key = GraphCore.verseKey(ref.bookId, ref.chapter, ref.verse);
    const text = bibleData.verseText.get(key);
    return `
      <div class="stat-line" style="margin-bottom:4px;"><strong style="color:#d4af60">${escapeHtml(book.name)} ${ref.chapter}:${ref.verse}</strong></div>
      <div class="verse-text" style="margin-bottom:14px;">${text ? escapeHtml(text) : '<em>(text unavailable)</em>'}</div>
    `;
  }

  function handleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const best = nearestArc(px, py);
    if (best) {
      openArcPanel(best);
      return;
    }
    // Click on a book band (canonical mode only) toggles that book as filter.
    if (mode === 'canonical' && py > 20 && py < baselineY()) {
      const wx = worldXOf(px);
      const band = positions.bookRanges.find((b) => wx >= b.start && wx < b.end);
      if (band) {
        setBookFilter(filterBookId === band.bookId ? '' : band.bookId);
      }
    }
  }

  function openArcPanel(a) {
    panelContent.innerHTML = `
      <h2 style="margin-right:0">Cross-reference</h2>
      <div class="stat-line">${a.curated ? 'Curated link' : `${a.votes} votes`}</div>
      ${verseBlock(a.from)}
      <div class="ont-arrow" style="display:block;margin-bottom:10px;">&#8597;</div>
      ${verseBlock(a.to)}
    `;
    panel.classList.remove('hidden');
  }
  function closePanel() {
    panel.classList.add('hidden');
  }
  panelClose.onclick = closePanel;

  // ---- Controls ----
  minVotesInput.addEventListener('input', () => {
    minVotes = parseInt(minVotesInput.value, 10);
    minVotesVal.textContent = minVotes;
  });
  minVotesInput.addEventListener('change', rebuild);

  function setMode(next) {
    mode = next;
    modeCanonicalBtn.classList.toggle('active', mode === 'canonical');
    modeYearBtn.classList.toggle('active', mode === 'year');
    legendNote.textContent =
      mode === 'canonical'
        ? 'Arc height = distance between the two verses. Drag to pan, scroll to zoom, click an arc for detail, click a book to filter.'
        : 'X-axis = estimated year (see footer). Arc height = time between the two verses. Drag/scroll/click as before.';
    footerNote.textContent =
      mode === 'canonical'
        ? "Arc endpoints are placed at each verse's position in canonical reading order (cumulative verse count from Genesis 1:1), not at a historical date."
        : "Arc endpoints are placed at each verse's estimated year - Genesis 1-11 follows Septuagint (LXX) genealogical reckoning anchored to Abraham's conventional birth year; later books use standard regnal/composition-date estimates. Every year is approximate - see data/chronology.json's disclaimer.";
    fitToWholeBible();
    rebuild();
  }
  modeCanonicalBtn.addEventListener('click', () => setMode('canonical'));
  modeYearBtn.addEventListener('click', () => setMode('year'));

  function setBookFilter(bookId) {
    filterBookId = bookId;
    bookFilter.value = bookId;
    rebuild();
  }
  bookFilter.addEventListener('change', () => setBookFilter(bookFilter.value));

  function rebuild() {
    hint.textContent = 'Rebuilding…';
    hint.style.display = 'block';
    setTimeout(() => {
      buildEdges();
      buildArcs();
      draw();
      hint.style.display = 'none';
    }, 10);
  }

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
    positions = GraphCore.globalPositions(bibleData);

    hint.textContent = 'Loading chronology…';
    try {
      const chronologyData = await fetch('data/chronology.json').then((r) => r.json());
      chronIndex = GraphCore.buildChronologyIndex(chronologyData, positions);
    } catch (err) {
      console.error('Chronology unavailable, year mode disabled:', err);
      modeYearBtn.disabled = true;
      modeYearBtn.title = 'Chronology data failed to load';
    }

    bookFilter.innerHTML =
      '<option value="">All books</option>' +
      bibleData.books.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');

    buildEdges();
    buildArcs();
    fitToWholeBible();
    hint.style.display = 'none';
    draw();
  }
  boot();
})();
