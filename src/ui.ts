import type { CameraView, DebugState, SceneRenderMetrics } from "./renderer";
import type { DemoScene } from "./scenes";
import type { ShadowVerification } from "./verification";

export type CameraPreset = "default" | "inside" | "near";

export interface UiCallbacks {
  onScene: (index: number) => void;
  onDebug: (key: keyof DebugState) => void;
  onPreset: (preset: CameraPreset) => void;
}

function formatPoint(point: readonly number[]): string {
  return `(${point.map((value) => value.toFixed(2)).join(", ")})`;
}

const violationNames: Record<string, string> = {
  open: "开放边",
  "non-manifold": "非流形边",
  winding: "绕序冲突",
  degenerate: "退化面",
};

export class AppUi {
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly sceneButtons: HTMLButtonElement[];
  private readonly modeButtons: HTMLButtonElement[];
  private readonly stats: HTMLElement;
  private readonly verify: HTMLElement;
  private readonly invalid: HTMLElement;
  private readonly toast: HTMLElement;

  constructor(
    root: HTMLElement,
    scenes: DemoScene[],
    callbacks: UiCallbacks,
  ) {
    root.innerHTML = `
      <section class="panel title-card">
        <div class="eyebrow">WebGL2 · Z-fail stencil volumes</div>
        <h1>点光源模板阴影体</h1>
        <p class="subtitle" id="scene-subtitle"></p>
        <div class="keys">
          <span><kbd>1-4</kbd>场景</span>
          <span><kbd>V</kbd>阴影体</span>
          <span><kbd>S</kbd>轮廓边</span>
          <span><kbd>T</kbd>模板</span>
          <span><kbd>I</kbd>体内视角</span>
          <span><kbd>N</kbd>近裁剪</span>
          <span><kbd>R</kbd>重置相机</span>
        </div>
      </section>
      <section class="panel scene-card">
        <div class="card-label"><span>测试场景</span><span>1 / 4</span></div>
        <div class="scene-grid" id="scene-grid"></div>
        <div class="divider"></div>
        <div class="card-label"><span>调试叠层</span><span id="mode-name">关闭</span></div>
        <div class="segmented" id="mode-grid">
          <button class="mode-button" data-debug="showSilhouette">轮廓边</button>
          <button class="mode-button" data-debug="showVolume">阴影体</button>
          <button class="mode-button" data-debug="showStencil">模板</button>
        </div>
        <div class="preset-row">
          <button class="preset-button" data-preset="inside">进入阴影体</button>
          <button class="preset-button" data-preset="near">近裁剪穿物体</button>
          <button class="preset-button wide" data-preset="default">重置默认相机</button>
        </div>
      </section>
      <section class="panel stats-card" id="stats"></section>
      <section class="panel verify-card" id="verify"></section>
      <section class="panel invalid-card hidden" id="invalid"></section>
      <div class="hint">拖拽旋转 · 滚轮缩放 · 模板值非零即受影</div>
      <div class="toast hidden" id="toast"></div>
    `;
    this.title = root.querySelector("h1")!;
    this.subtitle = root.querySelector("#scene-subtitle")!;
    this.stats = root.querySelector("#stats")!;
    this.verify = root.querySelector("#verify")!;
    this.invalid = root.querySelector("#invalid")!;
    this.toast = root.querySelector("#toast")!;

    const grid = root.querySelector("#scene-grid")!;
    this.sceneButtons = scenes.map((scene, index) => {
      const button = document.createElement("button");
      button.className = "scene-button";
      button.dataset.scene = String(index);
      button.innerHTML = `<span class="num">0${scene.id}</span>${scene.title}`;
      button.addEventListener("click", () => callbacks.onScene(index));
      grid.append(button);
      return button;
    });
    this.modeButtons = [...root.querySelectorAll<HTMLButtonElement>(".mode-button")];
    this.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        callbacks.onDebug(button.dataset.debug as keyof DebugState);
      });
    });
    root.querySelectorAll<HTMLButtonElement>(".preset-button").forEach((button) => {
      button.addEventListener("click", () => {
        callbacks.onPreset(button.dataset.preset as CameraPreset);
      });
    });
  }

  setScene(index: number, scene: DemoScene, metrics: SceneRenderMetrics): void {
    this.title.textContent = `${scene.id} · ${scene.title}`;
    this.subtitle.textContent = scene.subtitle;
    this.sceneButtons.forEach((button, buttonIndex) => {
      button.classList.toggle("active", buttonIndex === index);
    });
    const p = scene.lightPosition;
    this.stats.innerHTML = `
      <div class="stats-head"><span>场景与几何</span><span>${metrics.rejectedMeshes > 0 ? "REJECTED" : "VALID"}</span></div>
      <div class="stats-line"><span class="key">点光源</span><span class="value">P (${p[0].toFixed(2)}, ${p[1].toFixed(2)}, ${p[2].toFixed(2)})</span></div>
      <div class="stats-line"><span class="key">网格 / 拒绝</span><span class="value">${metrics.validMeshes} / ${metrics.rejectedMeshes}</span></div>
      <div class="stats-line"><span class="key">轮廓边</span><span class="value">${metrics.silhouetteEdges}</span></div>
      <div class="stats-line"><span class="key">阴影体三角形</span><span class="value">${metrics.volumeTriangles}</span></div>
      <div class="stats-line"><span class="key">Z-fail</span><span class="value">depth LEQUAL · stencil ±wrap</span></div>
      <div id="camera-stats"></div>
    `;
    if (scene.invalid.length === 0) {
      this.invalid.classList.add("hidden");
      this.invalid.innerHTML = "";
    } else {
      this.renderInvalid(scene);
    }
  }

  setCamera(camera: CameraView): void {
    const position = camera.position;
    const target = camera.target;
    const container = this.stats.querySelector("#camera-stats");
    if (container) container.innerHTML =
      `<div class="stats-line"><span class="key">相机</span><span class="value">(${position[0].toFixed(2)}, ${position[1].toFixed(2)}, ${position[2].toFixed(2)}) → (${target[0].toFixed(2)}, ${target[1].toFixed(2)}, ${target[2].toFixed(2)})</span></div>
       <div class="stats-line"><span class="key">近 / 远</span><span class="value">${camera.near.toFixed(2)} / ${camera.far.toFixed(0)}</span></div>`;
  }

  setDebug(debug: DebugState): void {
    this.modeButtons.forEach((button) => {
      const key = button.dataset.debug as keyof DebugState;
      button.classList.toggle("active", debug[key]);
    });
    const active = this.modeButtons.filter((button) => button.classList.contains("active"));
    const label = active.length === 0
      ? "关闭"
      : active.map((button) => button.textContent).join(" + ");
    const modeName = document.querySelector("#mode-name");
    if (modeName) modeName.textContent = label;
  }

  setVerification(result: ShadowVerification | null, pending = false): void {
    if (pending || !result) {
      this.verify.innerHTML = `
        <div class="verify-title"><span class="status-dot pending"></span>CPU 射线 vs GPU 模板</div>
        <div class="metric"><span class="name">状态</span> <span class="number">计算中…</span></div>
      `;
      return;
    }
    const percent = result.mismatchRate * 100;
    const good = result.mismatchRate <= 0.015;
    this.verify.innerHTML = `
      <div class="verify-title"><span class="status-dot ${good ? "" : "bad"}"></span>CPU 射线 vs GPU 模板</div>
      <div class="verify-metrics">
        <div class="metric"><span class="name">抽样</span> <span class="number">${result.samples}</span></div>
        <div class="metric"><span class="name">命中表面</span> <span class="number">${result.surfaceHits}</span></div>
        <div class="metric"><span class="name">CPU 受影</span> <span class="number">${result.cpuShadowed}</span></div>
        <div class="metric"><span class="name">GPU 受影</span> <span class="number">${result.gpuShadowed}</span></div>
        <div class="metric"><span class="name">一致</span> <span class="number">${result.matches}</span></div>
        <div class="metric"><span class="name">差异</span> <span class="mismatch ${good ? "good" : "bad"}">${result.mismatches} (${percent.toFixed(2)}%)</span></div>
      </div>
      <div class="metric"><span class="name">掩码</span> <span class="number">${result.maskWidth}×${result.maskHeight} · readPixels</span></div>
    `;
  }

  showError(message: string | null): void {
    this.toast.classList.toggle("hidden", !message);
    this.toast.textContent = message ?? "";
  }

  private renderInvalid(scene: DemoScene): void {
    const entries: Array<{ meshName: string; violation: (typeof scene.invalid)[number]["validation"]["violations"][number] }> = [];
    for (const mesh of scene.invalid) {
      for (const violation of mesh.validation.violations) {
        entries.push({ meshName: mesh.source.name, violation });
      }
    }
    const priority: Record<string, number> = {
      "non-manifold": 0,
      winding: 1,
      open: 2,
      degenerate: 3,
    };
    entries.sort(
      (left, right) =>
        (priority[left.violation.kind] ?? 9) - (priority[right.violation.kind] ?? 9),
    );
    const lines = entries.slice(0, 6).map(({ meshName, violation }) => {
      const edge = violation.edge ? ` 边 ${violation.edge[0]}–${violation.edge[1]}` : "";
      const faces =
        violation.kind === "non-manifold" ? ` · ${violation.faceCount} 个相邻面` : "";
      return `<div class="invalid-line"><span class="kind">[${meshName}] ${violationNames[violation.kind]}</span>${edge}${faces} @ ${formatPoint(violation.point)}</div>`;
    });
    const total = scene.invalid.reduce(
      (sum, mesh) => sum + mesh.validation.violations.length,
      0,
    );
    this.invalid.innerHTML = `
      <div class="invalid-title">网格已拒绝：${total} 处边拓扑错误，未生成阴影体</div>
      ${lines.join("")}
      ${total > lines.length ? `<div class="invalid-line">…另有 ${total - lines.length} 处</div>` : ""}
    `;
    this.invalid.classList.remove("hidden");
  }
}
