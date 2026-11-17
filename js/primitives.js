import { Mesh } from './mesh.js';

export function createSphere(latBands = 24, lonBands = 32, radius = 1) {
  const positions = [];
  const indices = [];
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands;
    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands;
      positions.push(
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.cos(theta),
        radius * Math.sin(theta) * Math.sin(phi)
      );
    }
  }
  for (let lat = 0; lat < latBands; lat++)
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * (lonBands + 1) + lon;
      const b = a + lonBands + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return new Mesh('球体', positions, indices);
}

export function createTorus(radialSegs = 32, tubeSegs = 16, R = 0.8, r = 0.32) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= radialSegs; i++) {
    const u = (i / radialSegs) * 2 * Math.PI;
    for (let j = 0; j <= tubeSegs; j++) {
      const v = (j / tubeSegs) * 2 * Math.PI;
      positions.push(
        (R + r * Math.cos(v)) * Math.cos(u),
        r * Math.sin(v),
        (R + r * Math.cos(v)) * Math.sin(u)
      );
    }
  }
  for (let i = 0; i < radialSegs; i++)
    for (let j = 0; j < tubeSegs; j++) {
      const a = i * (tubeSegs + 1) + j;
      const b = a + tubeSegs + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return new Mesh('圆环', positions, indices);
}

export function createGrid(size = 2, segs = 16) {
  const positions = [];
  const indices = [];
  for (let iz = 0; iz <= segs; iz++)
    for (let ix = 0; ix <= segs; ix++) {
      const x = (ix / segs - 0.5) * size;
      const z = (iz / segs - 0.5) * size;
      positions.push(x, 0.15 * Math.sin(x * 3) * Math.cos(z * 3), z);
    }
  for (let iz = 0; iz < segs; iz++)
    for (let ix = 0; ix < segs; ix++) {
      const a = iz * (segs + 1) + ix;
      const b = a + segs + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return new Mesh('波浪面', positions, indices);
}
