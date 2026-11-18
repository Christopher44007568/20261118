import { createScene, refreshScene, countGeometry } from "./scene.js";
import { runDiagnostics } from "./diagnostics.js";
import { v3 } from "./math.js";

// Interactive application state. The heavy lifting (B-spline surface,
// adaptive tessellation, local rebuild) lives in the shared modules so the
// headless tools and this UI run identical code.
export class App {
  constructor({ tolerancePx = 1.0, onUpdate } = {}) {
    this.scene = createScene({ tolerancePx });
    this.mode = "shaded";
    this.selected = null;
    this.onUpdate = onUpdate || (() => {});
    this.localBuilds = 0;
    this.totalBuilds = this.scene.surface.patches.length;
  }

  get surface() {
    return this.scene.surface;
  }

  setMode(mode) {
    this.mode = mode;
    this.onUpdate(this.snapshot());
  }

  setTolerance(tolerancePx) {
    this.scene.tessellator.tolerancePx = tolerancePx;
    refreshScene(this.scene, null);
    this.onUpdate(this.snapshot());
  }

  // Pick the nearest control point to a screen position.
  pick(screenX, screenY) {
    const cam = this.scene.camera;
    let best = null;
    this.surface.nodes.forEach((row, j) => {
      row.forEach((node, i) => {
        const p = cam.project(node);
        const d = Math.hypot(p[0] - screenX, p[1] - screenY);
        if (d < 16 && (!best || d < best.dist)) {
          best = { i, j, dist: d };
        }
      });
    });
    this.selected = best ? [best.i, best.j] : null;
    this.onUpdate(this.snapshot());
    return this.selected;
  }

  // Drag a picked control point vertically by a screen-space delta. Only the
  // B-spline support cells (and their tessellation strips) are rebuilt.
  drag(deltaWorldY) {
    if (!this.selected) return;
    const [i, j] = this.selected;
    const before = this.surface.patches.map((p) => p.grid);
    const current = this.surface.nodes[j][i][2];
    const affected = this.surface.moveNode(i, j, current + deltaWorldY);
    let rebuilt = 0;
    this.surface.patches.forEach((p, k) => {
      if (p.grid !== before[k]) rebuilt++;
    });
    refreshScene(this.scene, new Set(affected));
    this.localBuilds = rebuilt;
    this.onUpdate(this.snapshot());
  }

  snapshot() {
    const geo = countGeometry(this.scene.meshes);
    const diagnostics = runDiagnostics(
      this.surface, this.scene.tessellator, this.scene.meshes);
    return {
      mode: this.mode,
      selected: this.selected,
      geometry: geo,
      patchCount: this.surface.patches.length,
      colSegments: this.scene.tessellator.colSegments,
      rowSegments: this.scene.tessellator.rowSegments,
      uLevels: this.scene.tessellator.uLevels,
      vLevels: this.scene.tessellator.vLevels,
      tolerancePx: this.scene.tessellator.tolerancePx,
      localBuilds: this.localBuilds,
      totalBuilds: this.totalBuilds,
      diagnostics
    };
  }
}

// Convert a vertical pixel drag to a world-space height change using the
// camera's projected scale at the surface centre.
export function pixelToWorldDelta(camera, deltaPx) {
  const center = [0, 0, 0];
  const up = v3.add(center, [0, 0, 1]);
  const a = camera.project(center);
  const b = camera.project(up);
  const pxPerUnit = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return (-deltaPx / pxPerUnit) * 1.4;
}
