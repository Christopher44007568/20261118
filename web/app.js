import { naiveMesh, greedyMesh } from "../src/mesher.js";
import { buildGPUMesh } from "../src/gpu.js";
import { ChunkManager } from "../src/chunks.js";
import { buildWall, buildSingleHole, buildChecker } from "../src/scenes.js";
import { Renderer } from "./renderer.js";

const SCENES = [
  { builder: buildWall, label: "规则墙体" },
  { builder: buildSingleHole, label: "单孔洞墙体" },
  { builder: buildChecker, label: "棋盘混合材质" },
];

const canvas = document.querySelector("#view");
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;
const renderer = new Renderer(canvas);
renderer.start();

const state = {
  sceneIndex: 0,
  mode: "greedy",
  built: null,
  chunks: null,
};

const refs = {
  sceneButtons: [...document.querySelectorAll("[data-scene]")],
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  dig: document.querySelector("#dig"),
  reset: document.querySelector("#reset"),
  summary: document.querySelector("#summary"),
  digReport: document.querySelector("#dig-report"),
};

function buildScene(index) {
  const scene = SCENES[index].builder();
  const naive = naiveMesh(scene.volume);
  const greedy = greedyMesh(scene.volume);
  const chunks = new ChunkManager(scene.volume);
  chunks.rebuildAll();
  renderer.frame([scene.volume.sx / 2, scene.volume.sy / 2, scene.volume.sz / 2]);
  state.built = { scene, naive, greedy };
  state.chunks = chunks;
  refs.digReport.textContent = "尚未挖除体素。";
  refresh();
}

function activeQuads() {
  if (state.mode === "naive") return state.built.naive.quads;
  if (state.mode === "greedy") return state.built.greedy.quads;
  return state.chunks.allQuads();
}

function refresh() {
  const quads = activeQuads();
  const gpu = buildGPUMesh(quads);
  renderer.uploadMesh(gpu);
  const naive = state.built.naive.stats;
  const greedy = state.built.greedy.stats;
  const reduction = ((1 - greedy.quads / naive.quads) * 100).toFixed(1);
  refs.summary.innerHTML = `
    <tr><td>朴素面提取（四边形 / 三角形）</td><td>${naive.quads} / ${naive.triangles}</td></tr>
    <tr><td>贪心合并（四边形 / 三角形）</td><td>${greedy.quads} / ${greedy.triangles}</td></tr>
    <tr><td>面数下降</td><td>${reduction}%</td></tr>
    <tr><td>当前上载顶点 / 索引</td><td>${gpu.vertexCount} / ${gpu.indexCount}</td></tr>
    <tr><td>索引类型</td><td>Uint32（drawElements 一次绘制）</td></tr>
  `;
}

function digVoxel() {
  const [x, y, z] = state.built.scene.digTarget;
  if (state.built.scene.volume.get(x, y, z) === 0) {
    refs.digReport.textContent = `(${x}, ${y}, ${z}) 已经是空体素，请先重置场景。`;
    return;
  }
  const totalChunks = state.chunks.meshes.size;
  const result = state.chunks.dig(x, y, z);
  state.built.greedy = greedyMesh(state.built.scene.volume);
  state.built.naive = naiveMesh(state.built.scene.volume);
  const names = result.rebuiltChunks.map((c) => `(${c.join(",")})`).join("、");
  refs.digReport.innerHTML = `
    挖除 (${x}, ${y}, ${z})：仅重建区块 ${names}，共
    ${result.rebuiltChunks.length}/${totalChunks} 个；<br>
    三角形 ${result.trianglesBefore} → ${result.trianglesAfter}
    （Δ ${result.delta}），其余区块网格保持不变。
  `;
  state.mode = "chunk";
  syncModeButtons();
  refresh();
}

function syncModeButtons() {
  for (const button of refs.modeButtons) {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  }
}

for (const button of refs.sceneButtons) {
  button.addEventListener("click", () => {
    state.sceneIndex = Number(button.dataset.scene);
    refs.sceneButtons.forEach((b) =>
      b.classList.toggle("active", b === button)
    );
    buildScene(state.sceneIndex);
  });
}

for (const button of refs.modeButtons) {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    syncModeButtons();
    refresh();
  });
}

refs.dig.addEventListener("click", digVoxel);
refs.reset.addEventListener("click", () => buildScene(state.sceneIndex));

buildScene(0);
