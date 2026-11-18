import { App, pixelToWorldDelta } from "../src/app.js";
import { drawShaded, drawWireframe } from "../src/render.js";
import { smoothNormalsAcrossPatches } from "../src/smooth-normals.js";

const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");
const app = new App({ tolerancePx: 1.0 });
app.scene.camera.setViewport(canvas.width, canvas.height);
app.scene.tessellator.setCamera(app.scene.camera);
app.scene.tessellator.computeLevels(app.surface);
app.scene.meshes = smoothNormalsAcrossPatches(
  app.scene.tessellator.buildAll(app.surface));

function render() {
  const snap = app.snapshot();
  if (app.mode === "wireframe") {
    drawWireframe(ctx, app.scene.meshes, app.scene.camera,
      canvas.width, canvas.height, app.surface, app.selected);
  } else {
    drawShaded(ctx, app.scene.meshes, app.scene.camera,
      canvas.width, canvas.height);
    drawControlOverlay();
  }
  bindPanel(snap);
}

function drawControlOverlay() {
  // Lightweight control-net overlay in shaded mode for dragging.
  const cam = app.scene.camera;
  const pts = app.surface.nodes.map((row) => row.map((p) => cam.project(p)));
  ctx.strokeStyle = "rgba(148,163,184,0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let j = 0; j < pts.length; j++) {
    for (let i = 0; i < pts[j].length - 1; i++) {
      ctx.moveTo(pts[j][i][0], pts[j][i][1]);
      ctx.lineTo(pts[j][i + 1][0], pts[j][i + 1][1]);
    }
  }
  for (let i = 0; i < pts[0].length; i++) {
    for (let j = 0; j < pts.length - 1; j++) {
      ctx.moveTo(pts[j][i][0], pts[j][i][1]);
      ctx.lineTo(pts[j + 1][i][0], pts[j + 1][i][1]);
    }
  }
  ctx.stroke();
  for (let j = 0; j < pts.length; j++) {
    for (let i = 0; i < pts[j].length; i++) {
      const sel = app.selected && app.selected[0] === i && app.selected[1] === j;
      ctx.fillStyle = sel ? "#f5b042" : "#e2e8f0";
      ctx.beginPath();
      ctx.arc(pts[j][i][0], pts[j][i][1], sel ? 7 : 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function bindPanel(s) {
  document.getElementById("statTri").textContent = s.geometry.triangles.toLocaleString();
  document.getElementById("statVert").textContent = s.geometry.vertices.toLocaleString();
  document.getElementById("statTol").textContent = `${s.tolerancePx.toFixed(2)} px`;
  document.getElementById("triCount").textContent = s.geometry.triangles.toLocaleString();
  document.getElementById("vertCount").textContent = s.geometry.vertices.toLocaleString();
  document.getElementById("patchCount").textContent = s.patchCount;
  document.getElementById("tolValue").textContent = `${s.tolerancePx.toFixed(2)} px`;

  const grid = document.getElementById("levelGrid");
  grid.innerHTML = "";
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const cell = document.createElement("div");
      const u = s.uLevels[r][c];
      const v = s.vLevels[r][c];
      cell.className = "level-cell" + (u + v > 46 ? " hot" : u + v < 34 ? " cool" : "");
      cell.textContent = `${u} × ${v}`;
      grid.appendChild(cell);
    }
  }

  const tag = document.getElementById("buildTag");
  tag.textContent = s.localBuilds > 0 ? "局部" : "初始构建";
  tag.className = "tag" + (s.localBuilds > 0 ? " local" : "");
  document.getElementById("buildText").textContent =
    `重建 ${s.localBuilds > 0 ? s.localBuilds : s.totalBuilds}/${s.totalBuilds} 面片 · 支持域局部更新`;

  const d = s.diagnostics;
  document.getElementById("passTag").textContent = d.continuity === "C2" ? "PASS" : "CHECK";
  const rows = [
    ["相邻面片最大缝隙", d.seamGap.toExponential(2)],
    ["切线失配 (C¹)", d.tangentError.toExponential(2)],
    ["二阶导失配 (C²)", d.secondDerivativeError.toExponential(2)],
    ["跨缝法线夹角", `${d.normalAngleDegrees.toExponential(1)}°`],
    ["轮廓折线弦高", `${d.silhouetteSagittaPx.toFixed(2)} px`],
    ["轮廓弧长缩短", `${(d.silhouetteShortening * 100).toFixed(4)}%`]
  ];
  document.getElementById("audit").innerHTML = rows.map(([k, v]) =>
    `<li><span class="k">${k}</span><span class="v">${v}</span></li>`).join("");
}

// --- Pointer interaction: pick then vertically drag a control point. ---
let dragging = false;
let lastY = 0;
canvas.addEventListener("pointerdown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  if (app.pick(x, y)) {
    dragging = true;
    lastY = y;
    canvas.classList.add("dragging");
    canvas.setPointerCapture(e.pointerId);
    render();
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const rect = canvas.getBoundingClientRect();
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  const delta = pixelToWorldDelta(app.scene.camera, y - lastY);
  lastY = y;
  app.drag(delta);
  render();
});
const endDrag = () => {
  dragging = false;
  canvas.classList.remove("dragging");
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

document.getElementById("modeShaded").addEventListener("click", () => {
  setMode("shaded", "modeShaded", "modeWire");
});
document.getElementById("modeWire").addEventListener("click", () => {
  setMode("wireframe", "modeWire", "modeShaded");
});
function setMode(mode, onId, offId) {
  app.setMode(mode);
  document.getElementById(onId).classList.add("active");
  document.getElementById(offId).classList.remove("active");
  render();
}
document.getElementById("tolSlider").addEventListener("input", (e) => {
  app.setTolerance(parseFloat(e.target.value));
  render();
});

render();
