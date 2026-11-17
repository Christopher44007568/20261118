import {
  SVTSystem, TILE_SIZE, TILES_PER_AXIS, NUM_TEXTURES,
  PREFETCH_RING, fallbackColor,
} from './svt.js';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

const WORLD_W = TILE_SIZE * TILES_PER_AXIS * NUM_TEXTURES;
const WORLD_H = TILE_SIZE * TILES_PER_AXIS;

// ---- Tile content ("disk" backing store, cached) ----
const diskCache = new Map();
function makeTile(tex, tx, ty) {
  const key = `${tex}:${tx}:${ty}`;
  if (diskCache.has(key)) return diskCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = TILE_SIZE;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, TILE_SIZE, TILE_SIZE);
  if (tex === 0) {
    grad.addColorStop(0, `hsl(${20 + tx * 3}, 70%, ${35 + ty}%)`);
    grad.addColorStop(1, `hsl(${40 + ty * 3}, 60%, 25%)`);
  } else {
    grad.addColorStop(0, `hsl(${200 + tx * 3}, 65%, ${30 + ty}%)`);
    grad.addColorStop(1, `hsl(${230 + ty * 3}, 55%, 22%)`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.strokeRect(0.5, 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
  g.beginPath();
  g.arc(TILE_SIZE / 2, TILE_SIZE / 2, 18 + ((tx * 7 + ty * 13) % 20), 0, 7);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 14px monospace';
  g.fillText(`T${tex}`, 6, 18);
  g.font = '12px monospace';
  g.fillText(`${tx},${ty}`, 6, 34);
  diskCache.set(key, c);
  return c;
}

const svt = new SVTSystem({ tileFactory: makeTile, uploadTicks: 4 });

// ---- Camera ----
const cam = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 0.35 };
let autofly = true;
let showPageTable = true, showPool = true, showGrid = false, markFallback = true;

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}
addEventListener('resize', resize);
resize();

// ---- Input ----
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY; autofly = false;
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', e => {
  if (!dragging) return;
  cam.x -= (e.clientX - lastX) / cam.zoom;
  cam.y -= (e.clientY - lastY) / cam.zoom;
  lastX = e.clientX; lastY = e.clientY;
  clampCamera();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  autofly = false;
  const f = Math.exp(-e.deltaY * 0.0015);
  const wx = cam.x + (e.clientX - canvas.width / 2) / cam.zoom;
  const wy = cam.y + (e.clientY - canvas.height / 2) / cam.zoom;
  cam.zoom = Math.min(16, Math.max(0.05, cam.zoom * f));
  cam.x = wx - (e.clientX - canvas.width / 2) / cam.zoom;
  cam.y = wy - (e.clientY - canvas.height / 2) / cam.zoom;
  clampCamera();
}, { passive: false });
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'a') autofly = !autofly;
  if (k === 'p') showPageTable = !showPageTable;
  if (k === 'r') showPool = !showPool;
  if (k === 'g') showGrid = !showGrid;
  if (k === 'f') markFallback = !markFallback;
});

function clampCamera() {
  cam.x = Math.max(0, Math.min(WORLD_W, cam.x));
  cam.y = Math.max(0, Math.min(WORLD_H, cam.y));
}

// Visible virtual tiles for the current camera, expanded by PREFETCH_RING.
function visibleTiles(ring) {
  const out = [];
  const vw = canvas.width / cam.zoom, vh = canvas.height / cam.zoom;
  const x0 = cam.x - vw / 2 - ring * TILE_SIZE;
  const y0 = cam.y - vh / 2 - ring * TILE_SIZE;
  const x1 = cam.x + vw / 2 + ring * TILE_SIZE;
  const y1 = cam.y + vh / 2 + ring * TILE_SIZE;
  for (let wy = Math.floor(y0 / TILE_SIZE); wy <= Math.floor(y1 / TILE_SIZE); wy++) {
    for (let wx = Math.floor(x0 / TILE_SIZE); wx <= Math.floor(x1 / TILE_SIZE); wx++) {
      const tex = wx < TILES_PER_AXIS ? 0 : 1;
      const tx = wx - tex * TILES_PER_AXIS;
      if (tex >= 0 && tex < NUM_TEXTURES &&
          tx >= 0 && tx < TILES_PER_AXIS && wy >= 0 && wy < TILES_PER_AXIS) {
        out.push({ tex, tx, ty: wy });
      }
    }
  }
  return out;
}

// ---- Render ----
let fallbackCount = 0;
let flyTime = 0;

function frame() {
  if (autofly) {
    flyTime += 1 / 60;
    const t = flyTime;
    cam.x = WORLD_W * (0.5 + 0.42 * Math.sin(t * 0.35));
    cam.y = WORLD_H * (0.5 + 0.38 * Math.sin(t * 0.23 + 1.7));
    // Oscillate zoom across a wide range incl. high magnification.
    cam.zoom = Math.pow(2, -1.5 + 4.5 * (0.5 + 0.5 * Math.sin(t * 0.18)));
  }

  svt.requestVisible(visibleTiles(PREFETCH_RING));
  svt.update(10);

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  fallbackCount = 0;
  const tileScreen = TILE_SIZE * cam.zoom;
  for (const { tex, tx, ty } of visibleTiles(0)) {
    const wx = (tex * TILES_PER_AXIS + tx) * TILE_SIZE;
    const wy = ty * TILE_SIZE;
    const slot = svt.lookup(tex, tx, ty);
    if (slot && slot.data) {
      ctx.drawImage(slot.data, wx, wy);
    } else {
      // Not resident: deterministic fallback color block, never a neighbor.
      fallbackCount++;
      ctx.fillStyle = fallbackColor(tex, tx, ty);
      ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
      if (markFallback && tileScreen > 24) {
        ctx.strokeStyle = 'rgba(255,80,80,0.9)';
        ctx.lineWidth = 2 / cam.zoom;
        ctx.strokeRect(wx + 2, wy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        ctx.fillStyle = 'rgba(255,120,120,0.95)';
        ctx.font = `${12 / cam.zoom}px monospace`;
        ctx.fillText('MISS', wx + 8 / cam.zoom, wy + 16 / cam.zoom);
      }
    }
    if (showGrid && tileScreen > 12) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1 / cam.zoom;
      ctx.strokeRect(wx, wy, TILE_SIZE, TILE_SIZE);
    }
  }

  // Boundary between the two virtual texture pages.
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2 / cam.zoom;
  ctx.beginPath();
  ctx.moveTo(TILE_SIZE * TILES_PER_AXIS, 0);
  ctx.lineTo(TILE_SIZE * TILES_PER_AXIS, WORLD_H);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
  ctx.restore();

  drawHud();
  if (showPageTable) drawPageTables();
  if (showPool) drawPool();
  requestAnimationFrame(frame);
}

// ---- HUD & overlays ----
const hitWindow = [];
function drawHud() {
  const { hits, misses, uploads, evictions } = svt.stats;
  hitWindow.push({ h: hits, m: misses });
  if (hitWindow.length > 60) hitWindow.shift();
  const dh = hits - hitWindow[0].h, dm = misses - hitWindow[0].m;
  const rate = dh + dm > 0 ? (100 * dh / (dh + dm)).toFixed(1) : '100.0';
  hud.textContent =
    `命中率(1s)  ${rate}%\n` +
    `上传次数    ${uploads}\n` +
    `淘汰次数    ${evictions}\n` +
    `回退色块    ${fallbackCount}\n` +
    `物理页占用  ${svt.poolUsage()}/${svt.slots.length}\n` +
    `待上传队列  ${svt.queue.length} (+${svt.inFlight.size} 传输中)\n` +
    `缩放        ${cam.zoom.toFixed(2)}x\n` +
    `相机        ${cam.x.toFixed(0)}, ${cam.y.toFixed(0)}`;
}

function drawPageTables() {
  const cell = 4, pad = 8, gap = 16;
  const w = TILES_PER_AXIS * cell, h = TILES_PER_AXIS * cell;
  const y0 = canvas.height - h - pad;
  const vis = new Set(visibleTiles(0).map(v => SVTSystem.key(v.tex, v.tx, v.ty)));
  for (let tex = 0; tex < NUM_TEXTURES; tex++) {
    const x0 = pad + tex * (w + gap);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x0 - 2, y0 - 14, w + 4, h + 18);
    ctx.fillStyle = '#aaa';
    ctx.font = '10px monospace';
    ctx.fillText(`页表 T${tex}`, x0, y0 - 4);
    for (let ty = 0; ty < TILES_PER_AXIS; ty++) {
      for (let tx = 0; tx < TILES_PER_AXIS; tx++) {
        const e = svt.pageTable[tex][ty * TILES_PER_AXIS + tx];
        if (e >= 0) ctx.fillStyle = '#3c3';
        else if (e === -2) ctx.fillStyle = '#cc3';
        else ctx.fillStyle = '#222';
        ctx.fillRect(x0 + tx * cell, y0 + ty * cell, cell - 1, cell - 1);
        if (vis.has(SVTSystem.key(tex, tx, ty))) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(x0 + tx * cell, y0 + ty * cell, cell - 1, 1);
        }
      }
    }
  }
}

function drawPool() {
  const cell = 10, cols = 16, pad = 8;
  const rows = Math.ceil(svt.slots.length / cols);
  const w = cols * cell, h = rows * cell;
  const x0 = canvas.width - w - pad, y0 = canvas.height - h - pad;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x0 - 2, y0 - 14, w + 4, h + 18);
  ctx.fillStyle = '#aaa';
  ctx.font = '10px monospace';
  ctx.fillText('物理页驻留池', x0, y0 - 4);
  for (let i = 0; i < svt.slots.length; i++) {
    const s = svt.slots[i];
    const x = x0 + (i % cols) * cell, y = y0 + Math.floor(i / cols) * cell;
    if (s.free) {
      ctx.fillStyle = '#222';
    } else {
      const age = Math.min(1, (svt.frame - s.lastUsed) / 120);
      const l = 65 - age * 40;
      ctx.fillStyle = s.tex === 0 ? `hsl(25,80%,${l}%)` : `hsl(210,80%,${l}%)`;
    }
    ctx.fillRect(x, y, cell - 1, cell - 1);
  }
}

requestAnimationFrame(frame);
