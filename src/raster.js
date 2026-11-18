// Software Gouraud triangle rasterizer writing straight into ImageData.
// Canvas2D only offers flat fills or linear gradients (which cannot match
// three independent vertex colours), so scanline interpolation is used to
// guarantee shading continuity across the whole adaptive mesh.

export class FrameBuffer {
  constructor(width, height, bg = [13, 22, 34]) {
    this.width = width;
    this.height = height;
    const data = new Uint8ClampedArray(width * height * 4);
    this.image = typeof ImageData !== "undefined"
      ? new ImageData(data, width, height)
      : { data, width, height };
    this.depth = new Float32Array(width * height).fill(Infinity);
    const d = data;
    for (let i = 0; i < width * height; i++) {
      d[i * 4] = bg[0];
      d[i * 4 + 1] = bg[1];
      d[i * 4 + 2] = bg[2];
      d[i * 4 + 3] = 255;
    }
  }

  // p: [x, y, z] screen coords; c: [r, g, b] 0-255 per vertex.
  triangle(p0, c0, p1, c1, p2, c2) {
    const { width: w, height: h } = this;
    const pts = [
      { p: p0, c: c0 }, { p: p1, c: c1 }, { p: p2, c: c2 }
    ].sort((a, b) => a.p[1] - b.p[1]);
    const [A, B, C] = pts;
    // Barycentric coordinates from signed sub-areas. The small epsilon lets
    // pixels centred exactly on a shared edge be claimed by both adjacent
    // triangles; the depth test then keeps a single consistent winner, so
    // the mesh stays watertight without double-shading interior pixels.
    const area = edge(A.p, B.p, C.p);
    if (Math.abs(area) < 1e-9) return;
    const EPS = 1e-6 * Math.max(1, Math.abs(area));
    const yMin = Math.max(0, Math.floor(Math.min(A.p[1], B.p[1], C.p[1])));
    const yMax = Math.min(h - 1, Math.ceil(Math.max(A.p[1], B.p[1], C.p[1])));
    const xMin = Math.max(0, Math.floor(Math.min(A.p[0], B.p[0], C.p[0])));
    const xMax = Math.min(w - 1, Math.ceil(Math.max(A.p[0], B.p[0], C.p[0])));
    for (let y = yMin; y <= yMax; y++) {
      const px = y + 0.5;
      for (let x = xMin; x <= xMax; x++) {
        const sx = x + 0.5;
        const l0 = edge(B.p, C.p, [sx, px]) / area;
        const l1 = edge(C.p, A.p, [sx, px]) / area;
        const l2 = edge(A.p, B.p, [sx, px]) / area;
        if (l0 < -EPS || l1 < -EPS || l2 < -EPS) continue;
        const cl0 = Math.max(0, l0), cl1 = Math.max(0, l1), cl2 = Math.max(0, l2);
        const sum = cl0 + cl1 + cl2 || 1;
        const b0 = cl0 / sum, b1 = cl1 / sum, b2 = cl2 / sum;
        const z = A.p[2] * b0 + B.p[2] * b1 + C.p[2] * b2;
        const idx = y * w + x;
        if (z >= this.depth[idx]) continue;
        this.depth[idx] = z;
        const out = this.image.data;
        out[idx * 4] = clamp255(A.c[0] * b0 + B.c[0] * b1 + C.c[0] * b2);
        out[idx * 4 + 1] = clamp255(A.c[1] * b0 + B.c[1] * b1 + C.c[1] * b2);
        out[idx * 4 + 2] = clamp255(A.c[2] * b0 + B.c[2] * b1 + C.c[2] * b2);
      }
    }
  }
}

function edge(a, b, p) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
