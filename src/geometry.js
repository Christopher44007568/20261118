// Interleaved mesh data: { positions, normals, uvs, indices }

export function sphere(lat = 28, lon = 36, radius = 1) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let y = 0; y <= lat; y++) {
    const v = y / lat;
    const theta = v * Math.PI;
    const ny = Math.cos(theta);
    const ring = Math.sin(theta);
    for (let x = 0; x <= lon; x++) {
      const u = x / lon;
      const phi = u * Math.PI * 2;
      const nx = ring * Math.cos(phi);
      const nz = ring * Math.sin(phi);
      positions.push(nx * radius, ny * radius, nz * radius);
      normals.push(nx, ny, nz);
      uvs.push(u, 1 - v);
    }
  }
  for (let y = 0; y < lat; y++) {
    for (let x = 0; x < lon; x++) {
      const a = y * (lon + 1) + x;
      const b = a + lon + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, uvs, indices };
}

export function box(size = 1) {
  const h = size / 2;
  const faces = [
    { n: [1, 0, 0], p: [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]] },
    { n: [-1, 0, 0], p: [[-h, -h, h], [-h, h, h], [-h, h, -h], [-h, -h, -h]] },
    { n: [0, 1, 0], p: [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]] },
    { n: [0, -1, 0], p: [[-h, -h, h], [-h, -h, -h], [h, -h, -h], [h, -h, h]] },
    { n: [0, 0, 1], p: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], p: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
  ];
  const positions = [], normals = [], uvs = [], indices = [];
  for (const f of faces) {
    const base = positions.length / 3;
    for (let k = 0; k < 4; k++) {
      positions.push(...f.p[k]);
      normals.push(...f.n);
      uvs.push(k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, uvs, indices };
}

export function torus(R = 1, r = 0.35, segU = 48, segV = 20) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * Math.PI * 2;
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      const x = (R + r * cv) * Math.cos(u);
      const y = (R + r * cv) * Math.sin(u);
      const z = r * sv;
      positions.push(x, y, z);
      normals.push(cv * Math.cos(u), cv * Math.sin(u), sv);
      uvs.push(i / segU, j / segV);
    }
  }
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * (segV + 1) + j;
      const b = a + segV + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, uvs, indices };
}

export function plane(size = 20, seg = 1) {
  const h = size / 2;
  const positions = [], normals = [], uvs = [], indices = [];
  for (let y = 0; y <= seg; y++) {
    for (let x = 0; x <= seg; x++) {
      const px = (x / seg) * size - h;
      const pz = (y / seg) * size - h;
      positions.push(px, 0, pz);
      normals.push(0, 1, 0);
      uvs.push(x / seg, y / seg);
    }
  }
  for (let y = 0; y < seg; y++) {
    for (let x = 0; x < seg; x++) {
      const a = y * (seg + 1) + x;
      const b = a + seg + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, uvs, indices };
}
