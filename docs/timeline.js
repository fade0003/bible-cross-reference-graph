(() => {
  'use strict';

  const canvas = document.getElementById('tlCanvas');
  const ctx = canvas.getContext('2d');
  const hint = document.getElementById('hint');
  const minVotesInput = document.getElementById('minVotes');
  const minVotesVal = document.getElementById('minVotesVal');
  const tooltip = document.getElementById('tlTooltip');

  const CAT_COLOR = { ot: '#5f8fd9', nt: '#6fce8f', apocrypha: '#e0473e' };

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
  let allArcs = []; // { x1, x2, curated, apocryphal, from, to }
  let visibleArcs = []; // recomputed per draw, viewport-culled
  let minVotes = 35;

  const BASELINE_MARGIN = 60;
  let camera = { x: 0, scale: 1 };

  function baselineY() {
    return height - BASELINE_MARGIN;
  }

  function screenX(worldX) {
    return worldX * camera.scale + camera.x;
  }
  function worldX(screenXVal) {
    return (screenXVal - camera.x) / camera.scale;
  }

  function buildArcs() {
    const { index } = positions;
    const arcs = [];
    for (const e of bibleData.edges) {
      if (!e.curated && e.votes < minVotes) continue;
      const fromKey = GraphCore.verseKey(e.from.bookId, e.from.chapter, e.from.verse);
      const toKey = GraphCore.verseKey(e.to.bookId, e.to.chapter, e.to.verse);
      const x1 = index.get(fromKey);
      const x2 = index.get(toKey);
      if (x1 === undefined || x2 === undefined) continue;
      arcs.push({
        x1: Math.min(x1, x2),
        x2: Math.max(x1, x2),
        curated: e.curated,
        votes: e.votes,
        from: e.from,
        to: e.to,
      });
    }
    return arcs;
  }

  function fitToWholeBible() {
    camera.scale = width / positions.total;
    camera.x = 0;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    if (!positions) return;
    const by = baselineY();

    // Testament/apocrypha background bands + book boundary ticks.
    for (const b of positions.bookRanges) {
      const sx1 = screenX(b.start);
      const sx2 = screenX(b.end);
      if (sx2 < 0 || sx1 > width) continue;
      ctx.fillStyle = b.apocryphal
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
        ctx.fillStyle = '#8a8ea8';
        ctx.font = '10px Georgia, serif';
        ctx.textAlign = 'left';
        ctx.translate((sx1 + sx2) / 2, by + 14);
        ctx.rotate(segWidth < 60 ? -Math.PI / 3 : 0);
        ctx.textAlign = segWidth < 60 ? 'right' : 'center';
        ctx.fillText(b.name, 0, 0);
        ctx.restore();
      }
    }

    ctx.strokeStyle = 'rgba(212, 175, 96, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, by);
    ctx.lineTo(width, by);
    ctx.stroke();

    // Viewport-cull arcs before drawing - at low minVotes there can still be
    // tens of thousands of edges, but only a fraction span the visible x-range.
    const wLeft = worldX(0);
    const wRight = worldX(width);
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

  // ---- Interaction: drag pan, wheel zoom (centered on cursor) ----
  let dragStart = null;
  canvas.addEventListener('mousedown', (e) => {
    dragStart = { x: e.clientX, camX: camera.x };
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mouseup', () => {
    dragStart = null;
    canvas.style.cursor = 'grab';
  });
  window.addEventListener('mousemove', (e) => {
    if (dragStart) {
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
      const before = worldX(px);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      camera.scale = Math.max(width / positions.total, Math.min(4000, camera.scale * factor));
      const after = worldX(px);
      camera.x += (after - before) * camera.scale;
      draw();
    },
    { passive: false }
  );

  function handleHover(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const by = baselineY();
    if (py > by || py < 15) {
      tooltip.classList.add('hidden');
      return;
    }
    let best = null;
    let bestD = 8; // px tolerance
    for (const a of visibleArcs) {
      const sx1 = screenX(a.x1);
      const sx2 = screenX(a.x2);
      const span = sx2 - sx1;
      const arcHeight = Math.min(by - 30, span * 0.5);
      for (let t = 0; t <= 1; t += 0.1) {
        const x = (1 - t) * (1 - t) * sx1 + 2 * (1 - t) * t * (sx1 + sx2) / 2 + t * t * sx2;
        const y = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * (by - arcHeight) + t * t * by;
        const d = Math.hypot(x - px, y - py);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
    }
    if (best) {
      const fromName = bibleData.booksById.get(best.from.bookId).name;
      const toName = bibleData.booksById.get(best.to.bookId).name;
      tooltip.textContent = `${fromName} ${best.from.chapter}:${best.from.verse}  ↔  ${toName} ${best.to.chapter}:${best.to.verse}${
        best.curated ? '  (curated)' : `  (${best.votes} votes)`
      }`;
      tooltip.style.left = px + 14 + 'px';
      tooltip.style.top = py - 10 + 'px';
      tooltip.classList.remove('hidden');
    } else {
      tooltip.classList.add('hidden');
    }
  }

  minVotesInput.addEventListener('input', () => {
    minVotes = parseInt(minVotesInput.value, 10);
    minVotesVal.textContent = minVotes;
  });
  minVotesInput.addEventListener('change', () => {
    hint.textContent = 'Rebuilding arcs…';
    hint.style.display = 'block';
    setTimeout(() => {
      allArcs = buildArcs();
      draw();
      hint.style.display = 'none';
    }, 10);
  });

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
    allArcs = buildArcs();
    fitToWholeBible();
    hint.style.display = 'none';
    draw();
  }
  boot();
})();
