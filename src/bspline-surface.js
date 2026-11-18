import { v3 } from "./math.js";

// Uniform cubic B-spline surface: a (PATCHES+3) x (PATCHES+3) control net
// spans PATCHES x PATCHES cells with built-in C2 continuity. Each cell is
// also expressed as a 4x4 Bezier control grid so the existing tessellation,
// rendering and diagnostics pipeline works unchanged.

export const PATCHES = 4;
const CP = PATCHES + 3;

// Cubic uniform B-spline basis at parameter t.
function bsplineBasis(t) {
  const u = 1 - t;
  return [
    u * u * u / 6,
    (3 * t * t * t - 6 * t * t + 4) / 6,
    (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6,
    t * t * t / 6
  ];
}

function bsplineDeriv(t) {
  const u = 1 - t;
  return [
    -u * u / 2,
    (9 * t * t - 12 * t) / 6,
    (-9 * t * t + 6 * t + 3) / 6,
    t * t / 2
  ];
}

function bsplineSecond(t) {
  const u = 1 - t;
  return [u, (3 * t - 2), (1 - 3 * t), t];
}

// B-spline power-basis coefficients mapped to cubic Bezier control points.
// Derived by matching the B-spline segment polynomial to the Bezier form.
const TO_BEZIER = [
  [1 / 6, 4 / 6, 1 / 6, 0],
  [0, 2 / 3, 1 / 3, 0],
  [0, 1 / 3, 2 / 3, 0],
  [0, 1 / 6, 4 / 6, 1 / 6]
];

export class BSplineSurface {
  constructor(controlPoints) {
    if (controlPoints.length !== CP || controlPoints[0].length !== CP) {
      throw new Error(`expected ${CP}x${CP} control points`);
    }
    this.controlPoints = controlPoints;
    this.grid = CP;
    this.patches = [];
    this._buildPatches();
  }

  get nodes() {
    return this.controlPoints;
  }

  _buildPatches() {
    this.patches = [];
    for (let r = 0; r < PATCHES; r++) {
      for (let c = 0; c < PATCHES; c++) {
        this.patches.push({ c, r, grid: this._bezierGrid(c, r) });
      }
    }
  }

  _cellPoints(c, r) {
    const out = [];
    for (let j = 0; j < 4; j++) {
      const row = [];
      for (let i = 0; i < 4; i++) row.push(this.controlPoints[r + j][c + i]);
      out.push(row);
    }
    return out;
  }

  // Convert one B-spline cell's 4x4 control polygon to an equivalent Bezier
  // grid by applying the 1D conversion along both parametric directions.
  _bezierGrid(c, r) {
    const cell = this._cellPoints(c, r);
    const apply = (matrix, points) =>
      matrix.map((row) => {
        let acc = [0, 0, 0];
        row.forEach((w, k) => { acc = v3.add(acc, v3.scale(points[k], w)); });
        return acc;
      });
    const alongU = cell.map((row) => apply(TO_BEZIER, row));
    const grid = Array.from({ length: 4 }, () => Array(4));
    for (let i = 0; i < 4; i++) {
      const column = alongU.map((row) => row[i]);
      const converted = apply(TO_BEZIER, column);
      converted.forEach((p, j) => { grid[j][i] = p; });
    }
    return grid;
  }

  // Move one B-spline control point vertically and rebuild only the cells
  // whose 4x4 support window contains it.
  moveNode(i, j, z) {
    this.controlPoints[j][i][2] = z;
    const c0 = Math.max(0, i - 3);
    const c1 = Math.min(PATCHES - 1, i);
    const r0 = Math.max(0, j - 3);
    const r1 = Math.min(PATCHES - 1, j);
    const affected = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const index = r * PATCHES + c;
        this.patches[index] = { c, r, grid: this._bezierGrid(c, r) };
        affected.push(index);
      }
    }
    this.dirtyPatches = new Set(affected);
    return affected;
  }

  // Direct analytic evaluation of a cell (used to validate C2 continuity).
  evaluateCell(c, r, u, w) {
    const cell = this._cellPoints(c, r);
    const bu = bsplineBasis(u);
    const bv = bsplineBasis(w);
    const du = bsplineDeriv(u);
    const dv = bsplineDeriv(w);
    const d2u = bsplineSecond(u);
    const d2v = bsplineSecond(w);
    const sum = (fu, fv) => {
      let acc = [0, 0, 0];
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          acc = v3.add(acc, v3.scale(cell[j][i], fu[i] * fv[j]));
        }
      }
      return acc;
    };
    return {
      position: sum(bu, bv),
      Pu: sum(du, bv),
      Pv: sum(bu, dv),
      Puu: sum(d2u, bv),
      Pvv: sum(bu, d2v),
      normal: v3.norm(v3.cross(sum(du, bv), sum(bu, dv)))
    };
  }
}
