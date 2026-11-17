import { m4, rayTriangle } from './math3.js';

// CPU raycast against every mesh. Returns the closest hit:
// { mesh, triIndex, u, v, t } or null. Works in world space by transforming
// each triangle with the mesh's model matrix.
export function pickTriangle(meshes, origin, dir) {
  let best = null;
  for (const mesh of meshes) {
    const model = mesh.modelMatrix();
    for (let tri = 0; tri < mesh.triangleCount; tri++) {
      const [a, b, c] = mesh.triPositions(tri);
      const wa = m4.transformPoint(model, a);
      const wb = m4.transformPoint(model, b);
      const wc = m4.transformPoint(model, c);
      const hit = rayTriangle(origin, dir, wa, wb, wc);
      if (hit && (!best || hit.t < best.t))
        best = { mesh, triIndex: tri, u: hit.u, v: hit.v, t: hit.t };
    }
  }
  return best;
}

// Is the world-space point occluded from the eye by any mesh surface?
// Casts a ray from the eye and checks for hits closer than the point itself.
export function isOccluded(meshes, eye, point) {
  const dx = point[0] - eye[0];
  const dy = point[1] - eye[1];
  const dz = point[2] - eye[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-9) return false;
  const dir = [dx / dist, dy / dist, dz / dist];
  const hit = pickTriangle(meshes, eye, dir);
  // Small epsilon so the anchor's own triangle doesn't count as an occluder.
  return !!hit && hit.t < dist - 1e-3;
}
