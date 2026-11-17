import { Frustum, bruteForceVisible, add, scale } from './octree.js';
import { buildScene, buildCameraPaths, updateDynamics } from './scene.js';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const WORLD = 150; // half-extent mapped to the canvas

const scene = buildScene();
const paths = buildCameraPaths();

const ui = {
  pathSelect: document.getElementById('pathSelect'),
  playBtn: document.getElementById('playBtn'),
  verifyBtn: document.getElementById('verifyBtn'),
  frameSlider: document.getElementById('frameSlider'),
  frameLabel: document.getElementById('frameLabel'),
  sVisited: document.getElementById('sVisited'),
  sPruned: document.getElementById('sPruned'),
  sSkipped: document.getElementById('sSkipped'),
  sAccepted: document.getElementById('sAccepted'),
  sRejected: document.getElementById('sRejected'),
  consistency: document.getElementById('consistency'),
  verifyLog: document.getElementById('verifyLog'),
};

let currentPath = 0;
let frame = 0;
let playing = false;

for (const path of paths) {
  const opt = document.createElement('option');
  opt.value = path.name;
  opt.textContent = path.label;
  ui.pathSelect.appendChild(opt);
}

function toScreen(x, z) {
  return [
    (x / WORLD) * (canvas.width / 2) + canvas.width / 2,
    (z / WORLD) * (canvas.height / 2) + canvas.height / 2,
  ];
}

function drawBox(box, color, fill = false) {
  const [x0, y0] = toScreen(box.min.x, box.min.z);
  const [x1, y1] = toScreen(box.max.x, box.max.z);
  if (fill) {
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  } else {
    ctx.strokeStyle = color;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
}

function drawNodes(node) {
  if (node.visibility === null) return;
  if (node.visibility === 2) drawBox(node.box, 'rgba(47,158,95,0.10)', true);
  if (node.children) {
    for (const child of node.children) drawNodes(child);
  }
  if (node.visibility === 1) drawBox(node.box, 'rgba(201,138,43,0.55)');
  else if (node.visibility === 0) drawBox(node.box, 'rgba(58,67,86,0.35)');
  else drawBox(node.box, 'rgba(47,158,95,0.45)');
}

function drawFrustum(frustum) {
  const tanH = Math.tan((frustum.fovYDeg * Math.PI) / 360);
  const tanW = tanH * frustum.aspect;
  const corner = (dist, sx, sy) => add(
    add(frustum.position, scale(frustum.forward, dist)),
    add(scale(frustum.right, sx * dist * tanW), scale(frustum.up, sy * dist * tanH))
  );
  const near = [corner(frustum.near, -1, -1), corner(frustum.near, 1, -1),
                corner(frustum.near, 1, 1), corner(frustum.near, -1, 1)];
  const far = [corner(frustum.far, -1, -1), corner(frustum.far, 1, -1),
               corner(frustum.far, 1, 1), corner(frustum.far, -1, 1)];
  ctx.strokeStyle = 'rgba(232,228,201,0.8)';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = toScreen(near[i].x, near[i].z);
    const [bx, by] = toScreen(near[(i + 1) % 4].x, near[(i + 1) % 4].z);
    const [cx, cy] = toScreen(far[i].x, far[i].z);
    const [dx, dy] = toScreen(far[(i + 1) % 4].x, far[(i + 1) % 4].z);
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.moveTo(cx, cy); ctx.lineTo(dx, dy);
    ctx.moveTo(ax, ay); ctx.lineTo(cx, cy);
  }
  ctx.stroke();
  const [px, py] = toScreen(frustum.position.x, frustum.position.z);
  ctx.fillStyle = '#e8e4c9';
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();
}

function ids(objects) {
  return objects.map((o) => o.id).sort((a, b) => a - b);
}

function renderFrame() {
  const path = paths[currentPath];
  const params = path.frames[frame];
  updateDynamics(scene, frame * 0.1);
  const frustum = new Frustum(params);
  const { visible, stats } = scene.tree.cull(frustum);

  const visibleIds = new Set(ids(visible));
  const expected = bruteForceVisible(frustum, [...scene.statics, ...scene.dynamics]);
  const ok = ids(visible).join(',') === ids(expected).join(',');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawNodes(scene.tree.root);

  for (const obj of scene.statics) {
    drawBox(obj.box, visibleIds.has(obj.id) ? '#2f9e5f' : 'rgba(214,79,79,0.55)');
  }
  for (const obj of scene.dynamics) {
    drawBox(obj.box, visibleIds.has(obj.id) ? '#4c8dff' : 'rgba(80,110,180,0.5)');
  }
  drawFrustum(frustum);

  ui.sVisited.textContent = stats.nodesVisited;
  ui.sPruned.textContent = stats.nodesPruned;
  ui.sSkipped.textContent = stats.nodesSkippedInside;
  ui.sAccepted.textContent = stats.objectsAccepted;
  ui.sRejected.textContent = stats.objectsRejected;
  ui.consistency.textContent = ok ? '一致 ✓' : '不一致 ✗';
  ui.consistency.className = ok ? 'ok' : 'bad';
  ui.frameLabel.textContent = `${frame} / ${path.frames.length - 1}`;
  ui.frameSlider.value = frame;
}

function tick() {
  if (playing) {
    frame = (frame + 1) % paths[currentPath].frames.length;
    renderFrame();
  }
  requestAnimationFrame(tick);
}

ui.pathSelect.addEventListener('change', () => {
  currentPath = paths.findIndex((p) => p.name === ui.pathSelect.value);
  frame = 0;
  renderFrame();
});

ui.frameSlider.addEventListener('input', () => {
  frame = Number(ui.frameSlider.value);
  renderFrame();
});

ui.playBtn.addEventListener('click', () => {
  playing = !playing;
  ui.playBtn.textContent = playing ? '暂停' : '播放';
});

ui.verifyBtn.addEventListener('click', () => {
  const lines = [];
  let totalMismatch = 0;
  for (const path of paths) {
    const verifyScene = buildScene();
    let mismatches = 0;
    path.frames.forEach((params, i) => {
      updateDynamics(verifyScene, i * 0.1);
      const frustum = new Frustum(params);
      const { visible } = verifyScene.tree.cull(frustum);
      const expected = bruteForceVisible(frustum, [...verifyScene.statics, ...verifyScene.dynamics]);
      if (ids(visible).join(',') !== ids(expected).join(',')) mismatches++;
    });
    totalMismatch += mismatches;
    lines.push(`${path.label}: ${path.frames.length} 帧, ${mismatches} 处不一致`);
  }
  lines.push(totalMismatch === 0 ? '全部通过 ✓' : `共 ${totalMismatch} 处不一致 ✗`);
  ui.verifyLog.innerHTML = lines.join('<br>');
  ui.verifyLog.style.color = totalMismatch === 0 ? '#5fd68a' : '#ff6b6b';
});

renderFrame();
tick();
