import { v3 } from "./math.js";
import { evaluate, directionalCurvature } from "./evaluate.js";
import { PATCHES } from "./bspline-surface.js";

const MIN_SEG = 4;
const MAX_SEG = 32;
const SAMPLE = 6;

// Map a continuous sagitta demand to discrete levels with a dead-zone so flat
// regions stay at MIN_SEG instead of every patch creeping upward.
function quantizeLevel(demand) {
  if (demand <= MIN_SEG * 1.2) return MIN_SEG;
  return demand;
}

// Per-patch anisotropic tessellation levels. Seams are made watertight by
// forcing each shared boundary to take the max level of its two neighbours:
// both sides then emit the same number of samples along the edge, so no
// T-junction can appear while interiors keep their own density.
export class Tessellator {
  constructor(camera, tolerancePx = 0.32) {
    this.camera = camera;
    this.tolerancePx = tolerancePx;
    this.uLevels = Array.from({ length: PATCHES }, () => new Array(PATCHES).fill(MIN_SEG));
    this.vLevels = Array.from({ length: PATCHES }, () => new Array(PATCHES).fill(MIN_SEG));
    this.colSegments = new Array(PATCHES).fill(MIN_SEG);
    this.rowSegments = new Array(PATCHES).fill(MIN_SEG);
  }

  setCamera(camera) {
    this.camera = camera;
  }

  // Recompute levels only for patches touched by the moved control point,
  // then reconcile the shared boundaries with their untouched neighbours.
  computeLevels(surface, dirtyPatchSet = null) {
    const dirty = dirtyPatchSet ?? new Set(surface.patches.map((_, k) => k));
    for (const k of dirty) {
      const c = k % PATCHES;
      const r = Math.floor(k / PATCHES);
      const { u, v } = this._patchLevels(surface, c, r);
      this.uLevels[r][c] = u;
      this.vLevels[r][c] = v;
    }
    this._reconcileSeams(dirty);
    for (let c = 0; c < PATCHES; c++) {
      // u is shared down each column; v is shared across each row.
      this.colSegments[c] = this.uLevels[0][c];
    }
    for (let r = 0; r < PATCHES; r++) {
      this.rowSegments[r] = this.vLevels[r][0];
    }
    return { uLevels: this.uLevels, vLevels: this.vLevels };
  }

  _reconcileSeams(dirty) {
    // Vertical seams (left/right neighbours) are sampled along v, so both
    // sides must share a v level -> equalise v along each patch row.
    // Horizontal seams (top/bottom neighbours) are sampled along u, so both
    // sides must share a u level -> equalise u along each patch column.
    for (let r = 0; r < PATCHES; r++) {
      let rowDirty = false;
      for (let c = 0; c < PATCHES - 1; c++) {
        if (dirty.has(r * PATCHES + c) || dirty.has(r * PATCHES + c + 1)) rowDirty = true;
      }
      if (!rowDirty) continue;
      const m = Math.max(...this.vLevels[r]);
      for (let c = 0; c < PATCHES; c++) this.vLevels[r][c] = m;
    }
    for (let c = 0; c < PATCHES; c++) {
      let colDirty = false;
      for (let r = 0; r < PATCHES - 1; r++) {
        if (dirty.has(r * PATCHES + c) || dirty.has((r + 1) * PATCHES + c)) colDirty = true;
      }
      if (!colDirty) continue;
      const m = Math.max(...this.uLevels.map((row) => row[c]));
      for (let r = 0; r < PATCHES; r++) this.uLevels[r][c] = m;
    }
  }

  _patchLevels(surface, c, r) {
    const patch = surface.patches[r * PATCHES + c];
    let u = MIN_SEG;
    let v = MIN_SEG;
    for (let a = 0; a <= SAMPLE; a++) {
      for (let b = 0; b <= SAMPLE; b++) {
        const ev = evaluate(patch, a / SAMPLE, b / SAMPLE);
        u = Math.max(u, this._needed(ev, "u"));
        v = Math.max(v, this._needed(ev, "v"));
      }
    }
    const su = this._silhouetteBoost(patch, "u");
    const sv = this._silhouetteBoost(patch, "v");
    return {
      u: Math.min(MAX_SEG, quantizeLevel(Math.max(u, su))),
      v: Math.min(MAX_SEG, quantizeLevel(Math.max(v, sv)))
    };
  }

  _needed(ev, dir) {
    const kappa = directionalCurvature(ev, dir);
    const tangent = dir === "u" ? ev.Pu : ev.Pv;
    const pxLen = this._projectedLength(tangent, ev.position) / PATCHES;
    // Sagitta of one chord segment: tol = kappa * (L/n)^2 / 8  =>  n = ...
    return Math.ceil(pxLen * Math.sqrt(kappa / (8 * this.tolerancePx)));
  }

  // Outline edges whose normal turns toward the view ray are silhouette arcs:
  // keep extra vertices there so the projected outline never becomes a
  // shortened polygonal chord.
  _silhouetteBoost(patch, dir) {
    let boost = MIN_SEG;
    // Only edges running along `dir`: v-edges for u subdivision (v=0,1) and
    // u-edges for v subdivision (u=0,1).
    const edgeParams = dir === "u"
      ? [{ fixed: "v", value: 0 }, { fixed: "v", value: 1 }]
      : [{ fixed: "u", value: 0 }, { fixed: "u", value: 1 }];
    for (const edge of edgeParams) {
      for (let s = 0; s <= SAMPLE; s++) {
        const t = s / SAMPLE;
        const u = edge.fixed === "u" ? edge.value : t;
        const v = edge.fixed === "v" ? edge.value : t;
        const ev = evaluate(patch, u, v);
        const toEye = v3.norm(v3.sub(this.camera.eye, ev.position));
        const facing = Math.abs(v3.dot(ev.normal, toEye));
        if (facing < 0.3) {
          const tangent = dir === "u" ? ev.Pu : ev.Pv;
          const pxLen = this._projectedLength(tangent, ev.position) / PATCHES;
          const kappa = directionalCurvature(ev, dir);
          boost = Math.max(boost, Math.ceil(pxLen * Math.sqrt(Math.max(kappa, 0.05) / (8 * this.tolerancePx))));
        }
      }
    }
    return boost;
  }

  _projectedLength(tangent, position) {
    const half = v3.scale(tangent, 0.5);
    const a = this.camera.project(v3.sub(position, half));
    const b = this.camera.project(v3.add(position, half));
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  buildPatchMesh(surface, patchIndex) {
    const patch = surface.patches[patchIndex];
    const nu = this.uLevels[patch.r][patch.c];
    const nv = this.vLevels[patch.r][patch.c];
    const positions = [];
    const normals = [];
    const screen = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const ev = evaluate(patch, i / nu, j / nv);
        positions.push(ev.position);
        normals.push(ev.normal);
        screen.push(this.camera.project(ev.position));
      }
    }
    const indexAt = (i, j) => j * (nu + 1) + i;
    const triangles = [];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = indexAt(i, j), b = indexAt(i + 1, j);
        const c = indexAt(i, j + 1), d = indexAt(i + 1, j + 1);
        triangles.push([a, b, d], [a, d, c]);
      }
    }
    return { patchIndex, nu, nv, positions, normals, screen, triangles };
  }

  buildAll(surface) {
    return surface.patches.map((_, k) => this.buildPatchMesh(surface, k));
  }
}
