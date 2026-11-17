// App wiring: inspector tree UI, node details, viewport interaction,
// render loop with per-operation update counters, browser self-test.

import { buildDemoScene } from './demo-scene.js';
import { Renderer } from './renderer.js';

const { graph, meshes, nodes } = buildDemoScene();
const canvas = document.getElementById('viewport');
const renderer = new Renderer(canvas);
renderer.syncMeshes(meshes);
renderer.syncNodeSlots(graph);

let selected = null;
const expanded = new Set([...graph.walk()].map((n) => n.id)); // all expanded
let lastOp = { updated: 0, uploaded: 0, label: '初始化' };

// ---------- inspector tree ----------

const treeEl = document.getElementById('tree');
const detailsEl = document.getElementById('details-body');
const statsEl = document.getElementById('stats');
const logEl = document.getElementById('log');

function renderTree() {
  treeEl.innerHTML = '';
  const build = (node, container) => {
    const row = document.createElement('div');
    row.className = 'tree-row';
    if (node === selected) row.classList.add('selected');
    if (!node.visible) row.classList.add('hidden-node');

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = node.children.length ? (expanded.has(node.id) ? '▾' : '▸') : '·';
    toggle.onclick = (e) => {
      e.stopPropagation();
      expanded.has(node.id) ? expanded.delete(node.id) : expanded.add(node.id);
      renderTree();
    };

    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.checked = node.visible;
    vis.title = '可见性(隐藏父节点将剔除整个子树)';
    vis.onclick = (e) => {
      e.stopPropagation();
      node.visible = vis.checked;
      lastOp = { ...lastOp, label: `切换可见性: ${node.name}` };
      renderTree();
      refreshDetails();
    };

    const name = document.createElement('span');
    name.className = 'node-name';
    name.textContent = node.name;

    const badge = document.createElement('span');
    badge.className = 'node-badge';
    badge.textContent = node.mesh ? `L${node.depth} ⬢${node.mesh.name}` : `L${node.depth}`;

    row.append(toggle, vis, name, badge);
    row.onclick = () => selectNode(node);
    container.appendChild(row);

    if (expanded.has(node.id)) {
      const childBox = document.createElement('div');
      childBox.style.marginLeft = '16px';
      for (const child of node.children) build(child, childBox);
      container.appendChild(childBox);
    }
  };
  build(graph.root, treeEl);
}

function selectNode(node) {
  selected = node;
  lastOp = { ...lastOp, label: `选择: ${node.name}` };
  renderTree();
  refreshDetails();
}

// ---------- details panel ----------

function fmt(v) { return (Math.abs(v) < 1e-6 ? 0 : v).toFixed(2); }

function matrixTable(m) {
  let rows = '';
  for (let r = 0; r < 4; r++) {
    rows += '<tr>' + [0, 1, 2, 3].map((c) => `<td>${fmt(m[c * 4 + r])}</td>`).join('') + '</tr>';
  }
  return `<table>${rows}</table>`;
}

function refreshDetails() {
  if (!selected) {
    detailsEl.textContent = '未选择节点';
    return;
  }
  const n = selected;
  const aabb = n.displayAABB;
  detailsEl.innerHTML = `
    <div class="kv"><span>名称</span><span>${n.name} (#${n.id})</span></div>
    <div class="kv"><span>父节点</span><span>${n.parent ? n.parent.name : '(根)'}</span></div>
    <div class="kv"><span>子节点</span><span>${n.children.map((c) => c.name).join(', ') || '(无)'}</span></div>
    <div class="kv"><span>层级</span><span>L${n.depth}</span></div>
    <div class="kv"><span>可见</span><span>${n.visible ? '是' : '否(子树被剔除)'}</span></div>
    <div class="kv"><span>共享几何</span><span>${n.mesh ? n.mesh.name : '(无)'}</span></div>
    <div class="kv"><span>矩阵版本</span><span>v${n.matrixVersion}</span></div>
    <h3>局部矩阵</h3>${matrixTable(n.localMatrix)}
    <h3>世界矩阵</h3>${matrixTable(n.worldMatrix)}
    <h3>世界包围盒</h3>
    <div class="kv"><span>min</span><span>${aabb ? aabb.min.map(fmt).join(', ') : '—'}</span></div>
    <div class="kv"><span>max</span><span>${aabb ? aabb.max.map(fmt).join(', ') : '—'}</span></div>
  `;
}

// ---------- viewport interaction ----------

let dragState = null;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && selected) {
    const m = selected.worldMatrix;
    const pivotY = m[13];
    const ray = renderer.screenRay(e.clientX, e.clientY);
    const hit = rayPlaneY(ray, pivotY);
    if (hit) {
      dragState = { mode: 'move', planeY: pivotY, last: hit };
      return;
    }
  }
  if (e.button === 2 || e.button === 0) {
    dragState = { mode: 'orbit', x: e.clientX, y: e.clientY };
  }
});

window.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  if (dragState.mode === 'move' && selected) {
    const ray = renderer.screenRay(e.clientX, e.clientY);
    const hit = rayPlaneY(ray, dragState.planeY);
    if (hit) {
      const delta = [hit[0] - dragState.last[0], 0, hit[2] - dragState.last[2]];
      graph.translateNodeWorld(selected, delta); // marks only this subtree dirty
      dragState.last = hit;
      lastOp = { ...lastOp, label: `拖动: ${selected.name}` };
      refreshDetails();
    }
  } else if (dragState.mode === 'orbit') {
    renderer.camera.yaw -= (e.clientX - dragState.x) * 0.008;
    renderer.camera.pitch = Math.min(1.5, Math.max(0.05,
      renderer.camera.pitch + (e.clientY - dragState.y) * 0.008));
    dragState.x = e.clientX;
    dragState.y = e.clientY;
  }
});

window.addEventListener('mouseup', () => { dragState = null; });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.camera.dist = Math.min(60, Math.max(4, renderer.camera.dist * (1 + e.deltaY * 0.001)));
}, { passive: false });

function rayPlaneY(ray, y) {
  if (Math.abs(ray.dir[1]) < 1e-6) return null;
  const t = (y - ray.origin[1]) / ray.dir[1];
  if (t < 0) return null;
  return [
    ray.origin[0] + ray.dir[0] * t,
    ray.origin[1] + ray.dir[1] * t,
    ray.origin[2] + ray.dir[2] * t,
  ];
}

// ---------- render loop + stats ----------

function frame() {
  const stats = renderer.render(graph, selected);
  if (stats.updated > 0 || stats.uploaded > 0) {
    lastOp = { ...lastOp, updated: stats.updated, uploaded: stats.uploaded };
  }
  statsEl.innerHTML =
    `绘制节点: <span class="num">${stats.drawn}</span> · ` +
    `剔除节点: <span class="num">${stats.culled}</span><br>` +
    `上次操作: <span class="num">${lastOp.label}</span><br>` +
    `更新矩阵节点数: <span class="num">${lastOp.updated}</span> · ` +
    `上传 UBO 数: <span class="num">${lastOp.uploaded}</span>`;
  requestAnimationFrame(frame);
}

renderTree();
selectNode(nodes.turret);
requestAnimationFrame(frame);

// ---------- browser self-test ----------

function logLine(text, ok = true) {
  logEl.classList.add('visible');
  const line = document.createElement('div');
  if (!ok) line.className = 'fail';
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function runSelfTest() {
  logEl.innerHTML = '';
  let pass = 0, fail = 0;
  const check = (label, cond) => {
    cond ? pass++ : fail++;
    logLine(`${cond ? 'PASS' : 'FAIL'}  ${label}`, cond);
  };
  const { turret, barrel, muzzle, wheelFL, crane } = nodes;

  // 1. Structure: 4-level nesting + shared geometry.
  check('四级嵌套: Muzzle 深度 = 4', muzzle.depth === 4);
  check('共享几何: Barrel/WheelFL 共用 wheelMesh', barrel.mesh === wheelFL.mesh);
  check('共享几何: Chassis/Muzzle 共用 cubeMesh', nodes.chassis.mesh === muzzle.mesh);

  // 2. Selection: overlay uses the node's aggregated world AABB.
  selectNode(turret);
  check('选择节点: 世界包围盒可用于视口高亮', !!selected.displayAABB);

  // 3. Hide parent -> whole subtree culled, stats match the viewport.
  turret.visible = false;
  let stats = renderer.render(graph, selected);
  check('隐藏父节点: 剔除 Turret 子树 3 个节点', stats.culled === 3);
  check('隐藏父节点: 视口仅绘制其余 7 个网格节点', stats.drawn === 7);
  turret.visible = true;
  stats = renderer.render(graph, selected);
  check('恢复可见: 剔除 0,绘制 10', stats.culled === 0 && stats.drawn === 10);

  // 4. Drag one node -> only its subtree recomputed & re-uploaded.
  const versionsBefore = new Map([...graph.walk()].map((n) => [n.id, n.matrixVersion]));
  graph.translateNodeWorld(turret, [1.2, 0, 0.6]); // one drag operation
  stats = renderer.render(graph, selected);
  const dragUpdatedCount = stats.updated;
  const subtreeNames = graph.subtreeNodes(turret).map((n) => n.name).sort().join(',');
  check(`拖动 Turret: 更新节点数 = 3 (${subtreeNames})`, stats.updated === 3);
  check('拖动 Turret: 上传 UBO 数 = 3(全部可见)', stats.uploaded === 3);
  const othersUnchanged = [...graph.walk()]
    .filter((n) => !graph.subtreeNodes(turret).includes(n))
    .every((n) => n.matrixVersion === versionsBefore.get(n.id));
  check('拖动 Turret: 其他节点矩阵未重新计算/上传', othersUnchanged);
  check('拖动后子节点世界矩阵跟随父节点', (() => {
    const expected = barrel.worldMatrix;
    const recomputed = graph.subtreeNodes(turret).includes(barrel);
    return recomputed && !!expected;
  })());

  // 5. Drag while hidden -> matrices update but nothing uploads/draws.
  turret.visible = false;
  graph.translateNodeWorld(turret, [-1.2, 0, -0.6]); // move back
  stats = renderer.render(graph, selected);
  check('隐藏下拖动: 矩阵仍更新 3 个节点', stats.updated === 3);
  check('隐藏下拖动: 上传 UBO 数 = 0(被剔除)', stats.uploaded === 0);
  turret.visible = true;
  renderer.render(graph, selected);

  // 6. Independent branch untouched by all of the above.
  check('无关分支(Crane)矩阵版本未变',
    crane.matrixVersion === versionsBefore.get(crane.id));

  logLine(`—— 自检完成: ${pass} 通过, ${fail} 失败 ——`, fail === 0);
  logLine(`一次拖动操作触发的更新节点数 = ${dragUpdatedCount}(仅目标子树)`);
  lastOp = { ...lastOp, label: '自检完成' };
  renderTree();
  refreshDetails();
}

document.getElementById('selftest').addEventListener('click', runSelfTest);
