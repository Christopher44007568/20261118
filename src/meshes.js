// Procedural meshes: subdivided plane, UV sphere, thin box, wavy cloth.

function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}

export function makePlane(width, depth, segX, segZ) {
  const positions = [], indices = [];
  for (let z = 0; z <= segZ; z++) {
    for (let x = 0; x <= segX; x++) {
      positions.push(
        (x / segX - 0.5) * width,
        0,
        (z / segZ - 0.5) * depth
      );
    }
  }
  const row = segX + 1;
  for (let z = 0; z < segZ; z++) {
    for (let x = 0; x < segX; x++) {
      const a = z * row + x, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: computeNormals(new Float32Array(positions), indices),
    indices: new Uint32Array(indices)
  };
}

export function makeSphere(radius, latSegments, lonSegments) {
  const positions = [], indices = [];
  for (let lat = 0; lat <= latSegments; lat++) {
    const theta = (lat / latSegments) * Math.PI;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    for (let lon = 0; lon <= lonSegments; lon++) {
      const phi = (lon / lonSegments) * Math.PI * 2;
      positions.push(
        radius * sinT * Math.cos(phi),
        radius * cosT,
        radius * sinT * Math.sin(phi)
      );
    }
  }
  const row = lonSegments + 1;
  for (let lat = 0; lat < latSegments; lat++) {
    for (let lon = 0; lon < lonSegments; lon++) {
      const a = lat * row + lon, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: computeNormals(new Float32Array(positions), indices),
    indices: new Uint32Array(indices)
  };
}

export function makeBox(w, h, d) {
  const p = [], n = [], idx = [];
  const faces = [
    { n: [0, 0, 1], v: [[-w / 2, -h / 2, d / 2], [w / 2, -h / 2, d / 2], [w / 2, h / 2, d / 2], [-w / 2, h / 2, d / 2]] },
    { n: [0, 0, -1], v: [[w / 2, -h / 2, -d / 2], [-w / 2, -h / 2, -d / 2], [-w / 2, h / 2, -d / 2], [w / 2, h / 2, -d / 2]] },
    { n: [0, 1, 0], v: [[-w / 2, h / 2, d / 2], [w / 2, h / 2, d / 2], [w / 2, h / 2, -d / 2], [-w / 2, h / 2, -d / 2]] },
    { n: [0, -1, 0], v: [[-w / 2, -h / 2, -d / 2], [w / 2, -h / 2, -d / 2], [w / 2, -h / 2, d / 2], [-w / 2, -h / 2, d / 2]] },
    { n: [1, 0, 0], v: [[w / 2, -h / 2, d / 2], [w / 2, -h / 2, -d / 2], [w / 2, h / 2, -d / 2], [w / 2, h / 2, d / 2]] },
    { n: [-1, 0, 0], v: [[-w / 2, -h / 2, -d / 2], [-w / 2, -h / 2, d / 2], [-w / 2, h / 2, d / 2], [-w / 2, h / 2, -d / 2]] }
  ];
  for (const f of faces) {
    const base = p.length / 3;
    for (const v of f.v) { p.push(...v); n.push(...f.n); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(p),
    normals: new Float32Array(n),
    indices: new Uint32Array(idx)
  };
}

// Cloth: a tessellated grid with a smooth wave so the real surface is curved.
export function makeCloth(width, depth, segX, segZ) {
  const positions = [], indices = [];
  const heightAt = (x, z) =>
    0.28 * Math.sin(x * 1.7) * Math.cos(z * 1.3) + 0.12 * Math.cos(z * 2.4);
  for (let z = 0; z <= segZ; z++) {
    for (let x = 0; x <= segX; x++) {
      const wx = (x / segX - 0.5) * width;
      const wz = (z / segZ - 0.5) * depth;
      positions.push(wx, heightAt(wx, wz), wz);
    }
  }
  const row = segX + 1;
  for (let z = 0; z < segZ; z++) {
    for (let x = 0; x < segX; x++) {
      const a = z * row + x, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: computeNormals(new Float32Array(positions), indices),
    indices: new Uint32Array(indices),
    heightAt
  };
}
