// 场景定义：多个对象，每个对象包含若干实例（立方体）
// scene.version 在任何结构变更（删除/新增）时递增，拾取请求按提交时版本关联

import { mat4Compose } from './math.js';

// 36 顶点非索引立方体：position(3) + normal(3)，边长 1，中心在原点
export function createCubeVertexData() {
  const faces = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  ];
  const data = new Float32Array(36 * 6);
  let o = 0;
  for (const f of faces) {
    const corner = (su, sv) => [
      0.5 * (f.n[0] + su * f.u[0] + sv * f.v[0]),
      0.5 * (f.n[1] + su * f.u[1] + sv * f.v[1]),
      0.5 * (f.n[2] + su * f.u[2] + sv * f.v[2]),
    ];
    const quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)];
    for (const p of quad) {
      data[o++] = p[0]; data[o++] = p[1]; data[o++] = p[2];
      data[o++] = f.n[0]; data[o++] = f.n[1]; data[o++] = f.n[2];
    }
  }
  return data;
}

export class Scene {
  constructor() {
    this.version = 1;
    this.objects = [];
    this.nextId = 1;
  }

  addObject(name, color, instances) {
    const obj = {
      id: this.nextId++,
      name,
      color,
      deleted: false,
      instances: instances.map((inst) => ({
        model: mat4Compose(inst.x, inst.y, inst.z, inst.rotY || 0, inst.scale || 1),
        desc: inst,
      })),
    };
    this.objects.push(obj);
    this.version++;
    return obj;
  }

  deleteObject(id) {
    const obj = this.objects.find((o) => o.id === id);
    if (!obj || obj.deleted) return false;
    obj.deleted = true;
    this.version++;
    return true;
  }

  getObject(id) {
    return this.objects.find((o) => o.id === id && !o.deleted) || null;
  }

  liveObjects() {
    return this.objects.filter((o) => !o.deleted);
  }
}

// 布局：相互遮挡的实例行、左侧裁剪边缘的半可见实例、背景留白
export function buildDefaultScene() {
  const scene = new Scene();
  scene.addObject('occluders', [0.85, 0.30, 0.25, 1], [
    { x: -1.1, y: 0.0, z: 0.5, rotY: 0.4, scale: 1.2 },
    { x: -0.2, y: 0.1, z: -0.6, rotY: 0.9, scale: 1.2 },
    { x: 0.7, y: -0.1, z: -1.7, rotY: 1.3, scale: 1.2 },
  ]);
  scene.addObject('edge-huggers', [0.25, 0.65, 0.35, 1], [
    { x: -3.05, y: 0.2, z: -1.0, rotY: 0.2, scale: 1.0 },
    { x: 2.6, y: 0.6, z: -2.5, rotY: 0.7, scale: 0.9 },
  ]);
  scene.addObject('victim', [0.30, 0.45, 0.90, 1], [
    { x: 0.9, y: -0.75, z: -0.4, rotY: 0.5, scale: 0.8 },
  ]);
  return scene;
}
