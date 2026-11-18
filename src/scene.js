'use strict';

/* Deterministic PRNG so the basin looks identical on every load. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Accumulates interleaved position/normal/color vertices + 16-bit indices. */
class MeshBuilder {
  constructor() { this.v = []; this.idx = []; this.base = 0; }
  add(x, y, z, nx, ny, nz, color) {
    this.v.push(x, y, z, nx, ny, nz, color[0], color[1], color[2]);
    return this.base++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
}

function shade(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

/* Flat-shaded convex-ish rock from an icosahedron-ish random hull. */
function addRock(b, cx, cy, cz, r, rand, baseColor) {
    const rings = 3, seg = 7;
    const start = b.base;
    const ringIdx = [];
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI;
      ringIdx[j] = [];
      for (let i = 0; i < seg; i++) {
        const theta = (i / seg) * Math.PI * 2;
        const wobble = 0.78 + rand() * 0.4;
        const sx = Math.sin(phi) * Math.cos(theta) * r * wobble;
        const sy = Math.cos(phi) * r * 0.62 * wobble;
        const sz = Math.sin(phi) * Math.sin(theta) * r * wobble;
        const k = 0.72 + rand() * 0.4;
        ringIdx[j][i] = b.add(cx + sx, cy + sy, cz + sz, sx, sy, sz, shade(baseColor, k));
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = ringIdx[j][i], c = ringIdx[j][(i + 1) % seg];
        const d = ringIdx[j + 1][i], e = ringIdx[j + 1][(i + 1) % seg];
        b.tri(a, d, c); b.tri(c, d, e);
      }
    }
}

/* Conifer: trunk + 4 stacked cone tiers. */
function addConifer(b, x, groundY, z, h, rand) {
  const trunk = [0.26, 0.22, 0.16];
  const green = [0.16 + rand() * 0.05, 0.25 + rand() * 0.06, 0.17 + rand() * 0.04];
  const trunkH = h * 0.22, r = h * 0.13;
  // trunk cylinder (8 sides)
    const seg = 8, rows = [];
    for (let j = 0; j <= 1; j++) {
      rows[j] = [];
      const yy = groundY + j * trunkH;
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        rows[j][i] = b.add(x + Math.cos(a) * r * 0.5, yy, z + Math.sin(a) * r * 0.5,
          Math.cos(a), 0, Math.sin(a), shade(trunk, 0.85 + rand() * 0.2));
      }
    }
    for (let i = 0; i < seg; i++) {
      b.tri(rows[0][i], rows[0][(i + 1) % seg], rows[1][(i + 1) % seg]);
      b.tri(rows[0][i], rows[1][(i + 1) % seg], rows[1][i]);
    }
  // cone tiers
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const baseY = groundY + trunkH * 0.55 + t * h * 0.17;
    const tierH = h * 0.36;
    const tierR = r * (1.55 - t * 0.28);
    const coneSeg = 8;
    const ring = [];
    for (let i = 0; i < coneSeg; i++) {
      const a = (i / coneSeg) * Math.PI * 2;
      ring[i] = b.add(x + Math.cos(a) * tierR, baseY, z + Math.sin(a) * tierR,
        Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5, shade(green, 0.8 + rand() * 0.35));
    }
    const apex = b.add(x, baseY + tierH, z, 0, 1, 0, shade(green, 1.05));
    for (let i = 0; i < coneSeg; i++) b.tri(ring[i], ring[(i + 1) % coneSeg], apex);
  }
}

function addCylinder(b, cx, cy, cz, radius, height, seg, color) {
  const rows = [];
  for (let j = 0; j <= 1; j++) {
    rows[j] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      rows[j][i] = b.add(cx + Math.cos(a) * radius, cy + j * height, cz + Math.sin(a) * radius,
        Math.cos(a), 0, Math.sin(a), shade(color, j ? 1.05 : 0.8));
    }
  }
  for (let i = 0; i < seg; i++) {
    b.tri(rows[0][i], rows[0][(i + 1) % seg], rows[1][(i + 1) % seg]);
    b.tri(rows[0][i], rows[1][(i + 1) % seg], rows[1][i]);
  }
}

function addBox(b, cx, cy, cz, sx, sy, sz, color) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces = [
    [[1, 0, 0], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]],
    [[-1, 0, 0], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]],
    [[0, 1, 0], [-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]],
    [[0, -1, 0], [-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]],
    [[0, 0, 1], [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
    [[0, 0, -1], [hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]
  ];
  const ids = [];
  for (const f of faces) {
    for (const p of f.slice(1)) {
      ids.push(b.add(cx + p[0], cy + p[1], cz + p[2], f[0][0], f[0][1], f[0][2],
        shade(color, 0.82 + 0.25 * Math.max(0, f[0][1]))));
    }
  }
  for (let f = 0; f < 6; f++) b.tri(ids[f * 4], ids[f * 4 + 1], ids[f * 4 + 2]),
    b.tri(ids[f * 4], ids[f * 4 + 2], ids[f * 4 + 3]);
}

/* Rolling hills: a wide triangulated ribbon behind the shoreline. */
function buildHills(rand) {
  const b = new MeshBuilder();
  const seg = 56, rows = 5;
  const grid = [];
  for (let j = 0; j <= rows; j++) {
    grid[j] = [];
    const z = -26 - j * 11;
    for (let i = 0; i <= seg; i++) {
      const x = -78 + (i / seg) * 156;
      const wave = Math.sin(x * 0.07 + j * 1.7) * 2.2 + Math.sin(x * 0.15 + 2.1) * 1.1;
      const y = -1.2 + j * 1.55 + wave * (0.6 + j * 0.18) + (rand() - 0.5) * 0.5;
      const green = [0.17 + j * 0.012, 0.27 + j * 0.01, 0.18];
      grid[j][i] = b.add(x, y, z, 0, 1, 0, shade(green, 0.85 + rand() * 0.25));
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < seg; i++) {
      b.tri(grid[j][i], grid[j][i + 1], grid[j + 1][i]);
      b.tri(grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
    }
  return b;
}

/* Shore band: sandy strip right at y=0 behind the water edge. */
function buildShore(rand) {
  const b = new MeshBuilder();
  const seg = 48;
  const rows = [[], []];
  for (let i = 0; i <= seg; i++) {
    const x = -78 + (i / seg) * 156;
    const edgeZ = -22 + Math.sin(x * 0.1) * 1.4;
    const sand = [0.42, 0.4, 0.3];
    rows[0][i] = b.add(x, -0.15, edgeZ, 0, 1, 0, shade(sand, 0.9 + rand() * 0.15));
    rows[1][i] = b.add(x, -0.4, edgeZ - 6 - rand() * 2, 0, 1, 0, shade(sand, 0.7));
  }
  for (let i = 0; i < seg; i++) {
    b.tri(rows[0][i], rows[0][i + 1], rows[1][i]);
    b.tri(rows[0][i + 1], rows[1][i + 1], rows[1][i]);
  }
  return b;
}

window.SceneBuild = {
  mulberry32, MeshBuilder, addRock, addConifer, addCylinder, addBox,
  buildHills, buildShore, shade
};

/*
 * Assemble the alpine basin. Every group keeps its own MeshBuilder so the
 * renderer can count per-pass draws and triangles independently.
 */
function buildScene() {
  const rand = mulberry32(20261118);
  const SB = window.SceneBuild;
  const groups = [];
  let totalTris = 0;

  const push = (name, builder) => {
    const tris = builder.idx.length / 3;
    totalTris += tris;
    groups.push({ name, verts: builder.v, indices: builder.idx, tris });
  };

  push('hills', SB.buildHills(rand));
  push('shore', SB.buildShore(rand));

  // Conifer forest on the hills, two depth bands for parallax.
  const forest = new MeshBuilder();
  const treeCount = 52;
  for (let i = 0; i < treeCount; i++) {
    const x = -70 + rand() * 140;
    const z = -27 - rand() * 34;
    const groundY = -0.6 + (Math.sin(x * 0.07) * 1.4) - (z + 27) * 0.12;
    const h = 4.2 + rand() * 4.6;
    SB.addConifer(forest, x, groundY, z, h, rand);
  }
  push('forest', forest);

  // Rocks: some half-submerged in the lake, some on the shore.
  const rocks = new MeshBuilder();
  const rockColor = [0.34, 0.33, 0.26];
  for (let i = 0; i < 14; i++) {
    const x = -34 + rand() * 68;
    const z = -4 - rand() * 26;
    const r = 0.7 + rand() * 1.5;
    SB.addRock(rocks, x, -r * 0.25, z, r, rand, rockColor);
  }
  for (let i = 0; i < 8; i++) {
    const x = -60 + rand() * 120;
    SB.addRock(rocks, x, 0.1, -23 - rand() * 3, 0.9 + rand() * 1.1, rand, rockColor);
  }
  push('rocks', rocks);

  // Wooden dock on the right shore.
  const dock = new MeshBuilder();
  const wood = [0.36, 0.25, 0.15];
  const dockX = 21, dockZ = -8;
  for (let p = 0; p < 7; p++) {
    SB.addBox(dock, dockX + p * 0.85, 0.55, dockZ, 0.78, 0.14, 3.4, wood);
  }
  for (const px of [dockX - 0.3, dockX + 5.4]) {
    for (const pz of [dockZ - 1.4, dockZ + 1.4]) {
      SB.addCylinder(dock, px, -1.2, pz, 0.16, 2.6, 7, [0.24, 0.17, 0.11]);
    }
  }
  push('dock', dock);

  // Red buoy / hull floating near the center.
  const buoy = new MeshBuilder();
  const red = [0.62, 0.22, 0.14];
  SB.addCylinder(buoy, 6.4, 0.12, -6.2, 0.12, 1.7, 8, [0.2, 0.18, 0.14]);
  {
    // ellipsoid hull from stretched ring geometry
    const seg = 14, rings = 6, cx = 4.6, cy = 0.28, cz = -6.2;
    const grid = [];
    for (let j = 0; j <= rings; j++) {
      grid[j] = [];
      const phi = (j / rings) * Math.PI;
      for (let i = 0; i < seg; i++) {
        const theta = (i / seg) * Math.PI * 2;
        const px = Math.cos(phi) * 2.6;
        const py = Math.sin(phi) * 0.62;
        const pz = Math.sin(theta) * Math.sin(phi) * 0.95;
        const k = 0.8 + 0.3 * Math.max(0, Math.sin(phi));
        grid[j][i] = buoy.add(cx + px, cy + py * (px > 0 ? 1 : 0.75), cz + pz,
          Math.cos(phi), Math.sin(phi), Math.sin(theta), SB.shade(red, k));
      }
    }
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < seg; i++) {
        buoy.tri(grid[j][i], grid[j + 1][i], grid[j][(i + 1) % seg]);
        buoy.tri(grid[j][(i + 1) % seg], grid[j + 1][i], grid[j + 1][(i + 1) % seg]);
      }
  }
  push('buoy', buoy);

  // Marker pole with small flag behind the buoy.
  const marker = new MeshBuilder();
  SB.addCylinder(marker, 8.6, 0, -10.4, 0.07, 3.4, 6, [0.22, 0.2, 0.15]);
  SB.addBox(marker, 9.0, 2.9, -10.4, 0.8, 0.42, 0.06, [0.55, 0.24, 0.16]);
  push('marker', marker);

  // Reeds in the shallow left margin.
  const reeds = new MeshBuilder();
  const reedColor = [0.3, 0.33, 0.2];
  for (let i = 0; i < 46; i++) {
    const x = -36 + rand() * 12;
    const z = -6 - rand() * 10;
    const h = 1.1 + rand() * 1.6;
    const tilt = (rand() - 0.5) * 0.3;
    const w = 0.05 + rand() * 0.04;
    const p0 = reeds.add(x - w, -0.2, z, 0, 0, 1, SB.shade(reedColor, 0.8));
    const p1 = reeds.add(x + w, -0.2, z, 0, 0, 1, SB.shade(reedColor, 0.8));
    const p2 = reeds.add(x + tilt + w * 0.4, h, z, 0, 0, 1, SB.shade(reedColor, 1.15));
    const p3 = reeds.add(x + tilt - w * 0.4, h, z, 0, 0, 1, SB.shade(reedColor, 1.15));
    reeds.tri(p0, p1, p2);
    reeds.tri(p0, p2, p3);
  }
  push('reeds', reeds);

  return {
    groups,
    totalTris,
    drawCalls: groups.length
  };
}

window.buildScene = buildScene;
