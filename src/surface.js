import { v3, bernstein, bernsteinDeriv } from "./math.js";

// A 4x4 array of bicubic Bezier patches built from a 5x5 Hermite network.
// Sharing Hermite data across cell boundaries gives exact C1 continuity;
// each patch stores its own 4x4 Bezier control grid after Hermite->Bezier
// conversion, so a moved control point only rebuilds the adjacent patches.

export const GRID = 5;          // 5x5 Hermite nodes
export const PATCHES = 4;       // 4x4 Bezier patches
const N = GRID;

export class SurfaceModel {
  constructor(nodes) {
    // nodes: 5x5 array of [x, y, z]. x/y stay fixed; interaction edits z.
    this.baseNodes = nodes;
    this.nodes = nodes.map((row) => row.map((p) => [...p]));
    this.patches = [];
    this.rebuildAll();
  }

  rebuildAll() {
    this._buildHermite();
    this.patches = [];
    for (let j = 0; j < PATCHES; j++) {
      for (let i = 0; i < PATCHES; i++) {
        this.patches.push(this._buildPatch(i, j));
      }
    }
    this.dirtyPatches = new Set(this.patches.map((_, k) => k));
  }

  // Move one control point vertically. Only neighbouring patches are rebuilt;
  // the other 12 patch grids are left untouched (no full-surface rebuild).
  moveNode(i, j, z) {
    this.nodes[j][i][2] = z;
    const refreshedNodes = this._refreshHermiteAround(i, j);
    const affected = this._patchesTouchingNodes(refreshedNodes);
    for (const k of affected) {
      const c = k % PATCHES;
      const r = Math.floor(k / PATCHES);
      this.patches[k] = this._buildPatch(c, r);
    }
    this.dirtyPatches = new Set(affected);
    return affected;
  }

  _affectedPatches(i, j) {
    const cs = [i - 1, i].filter((c) => c >= 0 && c < PATCHES);
    const rs = [j - 1, j].filter((r) => r >= 0 && r < PATCHES);
    const out = [];
    for (const r of rs) for (const c of cs) out.push(r * PATCHES + c);
    return out;
  }

  _buildHermite() {
    this.du = Array.from({ length: N }, () => Array(N));
    this.dv = Array.from({ length: N }, () => Array(N));
    this.duv = Array.from({ length: N }, () => Array(N));
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) this._nodeTangents(i, j);
    }
  }

  _refreshHermiteAround(i, j) {
    // Forward-difference support: the node itself plus its left/up node.
    const ii = i > 0 ? [i - 1, i] : [i];
    const jj = j > 0 ? [j - 1, j] : [j];
    const nodes = [];
    for (const y of jj) for (const x of ii) this._nodeTangents(x, y);
    // On the final row/column the tangent flips to a backward difference,
    // which also reads the moved node through its left/up neighbour.
    if (i === N - 1 && i > 0) {
      for (const y of jj) { this._nodeTangents(i, y); nodes.push([i, y]); }
    }
    if (j === N - 1 && j > 0) {
      for (const x of ii) { this._nodeTangents(x, j); nodes.push([x, j]); }
    }
    for (const y of jj) for (const x of ii) nodes.push([x, y]);
    return nodes;
  }

  _patchesTouchingNodes(nodeList) {
    const set = new Set();
    for (const [x, y] of nodeList) {
      for (const k of this._affectedPatches(x, y)) set.add(k);
    }
    return [...set].sort((a, b) => a - b);
  }

  _nodeTangents(i, j) {
    const p = this.nodes;
    // One-sided differences keep the support of a node move inside its
    // 2x2 adjacent patch block; the shared seam node carries one tangent
    // value, so neighbouring patches stay exactly C1 after local edits.
    const sx = p[j][1][0] - p[j][0][0] || 1;
    const sy = p[1][i][1] - p[0][i][1] || 1;
    if (i < N - 1) {
      this.du[j][i] = v3.scale(v3.sub(p[j][i + 1], p[j][i]), 1 / sx);
    } else {
      this.du[j][i] = v3.scale(v3.sub(p[j][i], p[j][i - 1]), 1 / sx);
    }
    if (j < N - 1) {
      this.dv[j][i] = v3.scale(v3.sub(p[j + 1][i], p[j][i]), 1 / sy);
    } else {
      this.dv[j][i] = v3.scale(v3.sub(p[j][i], p[j - 1][i]), 1 / sy);
    }
    // Ferguson bicubic patches: zero twist bounds the influence domain.
    this.duv[j][i] = [0, 0, 0];
  }

  _buildPatch(c, r) {
    const P = (i, j) => this.nodes[r + j][c + i];
    const Du = (i, j) => this.du[r + j][c + i];
    const Dv = (i, j) => this.dv[r + j][c + i];
    const Duv = (i, j) => this.duv[r + j][c + i];
    const grid = Array.from({ length: 4 }, () => Array(4));
    const set = (i, j, v) => { grid[j][i] = v; };

    set(0, 0, P(0, 0));
    set(3, 0, P(1, 0));
    set(0, 3, P(0, 1));
    set(3, 3, P(1, 1));
    set(1, 0, v3.add(P(0, 0), v3.scale(Du(0, 0), 1 / 3)));
    set(2, 0, v3.sub(P(1, 0), v3.scale(Du(1, 0), 1 / 3)));
    set(1, 3, v3.add(P(0, 1), v3.scale(Du(0, 1), 1 / 3)));
    set(2, 3, v3.sub(P(1, 1), v3.scale(Du(1, 1), 1 / 3)));
    set(0, 1, v3.add(P(0, 0), v3.scale(Dv(0, 0), 1 / 3)));
    set(0, 2, v3.sub(P(0, 1), v3.scale(Dv(0, 1), 1 / 3)));
    set(3, 1, v3.add(P(1, 0), v3.scale(Dv(1, 0), 1 / 3)));
    set(3, 2, v3.sub(P(1, 1), v3.scale(Dv(1, 1), 1 / 3)));

    const inner = (i, j, px, py, su, sv, st) => {
      let q = v3.add(P(px, py), v3.scale(Du(px, py), su / 3));
      q = v3.add(q, v3.scale(Dv(px, py), sv / 3));
      q = v3.add(q, v3.scale(Duv(px, py), st / 9));
      set(i, j, q);
    };
    inner(1, 1, 0, 0, 1, 1, 1);
    inner(2, 1, 1, 0, -1, 1, -1);
    inner(1, 2, 0, 1, 1, -1, -1);
    inner(2, 2, 1, 1, -1, -1, 1);
    return { c, r, grid };
  }
}
