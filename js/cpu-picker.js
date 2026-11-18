// CPU 射线拾取：与 GPU ID 通道使用完全相同的相机与视口，
// 对每个存活实例把射线变换到局部空间，与单位立方体做 slab 求交，取最近命中

import {
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
  mat4Invert,
  transformPoint,
  transformDir,
  normalize3,
} from './math.js';

export class Camera {
  constructor() {
    this.eye = [0.2, 1.1, 4.6];
    this.target = [0, -0.1, -1.0];
    this.up = [0, 1, 0];
    this.fovY = (60 * Math.PI) / 180;
    this.near = 0.1;
    this.far = 100;
  }

  matrices(aspect) {
    const view = mat4LookAt(this.eye, this.target, this.up);
    const proj = mat4Perspective(this.fovY, aspect, this.near, this.far);
    const viewProj = mat4Multiply(proj, view);
    return { view, proj, viewProj };
  }
}

// 由设备像素坐标生成世界空间射线（与 GPU 光栅化同一套 NDC 约定）
export function rayFromPixel(camera, invViewProj, px, py, width, height) {
  const ndcX = ((px + 0.5) / width) * 2 - 1;
  const ndcY = 1 - ((py + 0.5) / height) * 2;
  const nearPt = transformPoint(invViewProj, [ndcX, ndcY, 0]);
  const farPt = transformPoint(invViewProj, [ndcX, ndcY, 1]);
  const dir = normalize3([farPt[0] - nearPt[0], farPt[1] - nearPt[1], farPt[2] - nearPt[2]]);
  return { origin: camera.eye.slice(), dir };
}

function rayUnitCube(origin, dir) {
  let tMin = -Infinity;
  let tMax = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = origin[i];
    const d = dir[i];
    if (Math.abs(d) < 1e-12) {
      if (o < -0.5 || o > 0.5) return null;
      continue;
    }
    let t0 = (-0.5 - o) / d;
    let t1 = (0.5 - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  return tMin > 0 ? tMin : 0;
}

// 返回 { objectId, instanceId, t } 或 null（背景）
export function cpuPick(scene, camera, px, py, width, height) {
  const aspect = width / height;
  const { viewProj } = camera.matrices(aspect);
  const invViewProj = mat4Invert(viewProj);
  const ray = rayFromPixel(camera, invViewProj, px, py, width, height);

  let best = null;
  for (const obj of scene.liveObjects()) {
    for (let instId = 0; instId < obj.instances.length; instId++) {
      const invModel = mat4Invert(obj.instances[instId].model);
      if (!invModel) continue;
      const localOrigin = transformPoint(invModel, ray.origin);
      const localDir = transformDir(invModel, ray.dir);
      const tLocal = rayUnitCube(localOrigin, localDir);
      if (tLocal === null) continue;
      // 用世界空间距离比较，避免非均匀缩放下的局部 t 失真
      const hitWorld = transformPoint(obj.instances[instId].model, [
        localOrigin[0] + localDir[0] * tLocal,
        localOrigin[1] + localDir[1] * tLocal,
        localOrigin[2] + localDir[2] * tLocal,
      ]);
      const dx = hitWorld[0] - camera.eye[0];
      const dy = hitWorld[1] - camera.eye[1];
      const dz = hitWorld[2] - camera.eye[2];
      const tWorld = dx * ray.dir[0] + dy * ray.dir[1] + dz * ray.dir[2];
      if (tWorld < camera.near || tWorld > camera.far) continue;
      if (!best || tWorld < best.t) {
        best = { objectId: obj.id, instanceId: instId, t: tWorld };
      }
    }
  }
  return best;
}
