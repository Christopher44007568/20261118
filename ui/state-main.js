import { App } from "../src/app.js";
import { drawShaded, drawWireframe } from "../src/render.js";
import { smoothNormalsAcrossPatches } from "../src/smooth-normals.js";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") || "shaded";
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");
const app = new App({ tolerancePx: 1.0 });
app.scene.camera.setViewport(canvas.width, canvas.height);
app.scene.tessellator.setCamera(app.scene.camera);
app.scene.tessellator.computeLevels(app.surface);
app.scene.meshes = smoothNormalsAcrossPatches(
  app.scene.tessellator.buildAll(app.surface));

// Deterministic local edit: lift an interior control point and keep it picked
// so the screenshots demonstrate the local-update path, not a full rebuild.
app.selected = [4, 4];
app.drag(1.1);
app.setMode(mode);

function draw() {
  if (mode === "wireframe") {
    drawWireframe(ctx, app.scene.meshes, app.scene.camera,
      canvas.width, canvas.height, app.surface, app.selected);
  } else {
    drawShaded(ctx, app.scene.meshes, app.scene.camera,
      canvas.width, canvas.height);
    drawOverlay();
  }
}

function drawOverlay() {
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
      const sel = app.selected[0] === i && app.selected[1] === j;
      ctx.fillStyle = sel ? "#f5b042" : "#e2e8f0";
      ctx.beginPath();
      ctx.arc(pts[j][i][0], pts[j][i][1], sel ? 7 : 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function bind(s) {
  document.getElementById("modeShaded").classList.toggle("active", mode === "shaded");
  document.getElementById("modeWire").classList.toggle("active", mode === "wireframe");
  document.getElementById("statTri").textContent = s.geometry.triangles.toLocaleString();
  document.getElementById("statVert").textContent = s.geometry.vertices.toLocaleString();
  document.getElementById("statTol").textContent = `${s.tolerancePx.toFixed(2)} px`;
  document.getElementById("triCount").textContent = s.geometry.triangles.toLocaleString();
  document.getElementById("vertCount").textContent = s.geometry.vertices.toLocaleString();
  document.getElementById("patchCount").textContent = s.patchCount;
  document.getElementById("tolValue").textContent = `${s.tolerancePx.toFixed(2)} px`;
  const grid = document.getElementById("levelGrid");
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
  tag.textContent = "局部";
  tag.className = "tag local";
  document.getElementById("buildText").textContent =
    `重建 ${s.localBuilds}/${s.totalBuilds} 面片 · 支持域局部更新`;
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

bind(app.snapshot());
draw();
