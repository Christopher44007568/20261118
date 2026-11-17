import { f32, composeTR, transformAABB } from './math.js';

export const CATEGORY = { STATIC: 0, ROTATING: 1, OCCLUDER: 2, OCCLUDED: 3 };

export const CATEGORY_COLOR = [
  [0.36, 0.62, 0.95], // 静态：蓝
  [0.95, 0.62, 0.25], // 旋转：橙
  [0.55, 0.55, 0.60], // 大遮挡体：灰
  [0.90, 0.28, 0.35], // 被遮挡：红
];

export const CAMERAS = [
  // 三视角均刻意收紧到部分实例落出视锥（发生真实裁剪），far 仍覆盖整个场景
  { name: 'A 正视', eye: [0, 6, 26], center: [0, 0, 4], up: [0, 1, 0] },
  { name: 'B 侧视', eye: [22, 8, 10], center: [0, 0, 3], up: [0, 1, 0] },
  { name: 'C 俯视', eye: [4, 28, 16], center: [0, 0, 6], up: [0, 1, 0] },
];

function makeInstance(id, category, center, half, color) {
  const localMin = half.map((v) => -v);
  const localMax = half.slice();
  return {
    id,
    category,
    base: center.slice(),
    half: half.slice(),
    localMin,
    localMax,
    color: color.slice(),
    angle: 0,
    model: null,
    world: null,
  };
}

// 全场景固定尺寸：远平面覆盖整个场景，没有任何缩放/远平面收缩
export function buildScene() {
  const instances = [];
  let id = 0;

  // 1) 静态网格：11x11，间距 2，位于 y=-2 平面
  for (let gx = 0; gx < 11; gx++) {
    for (let gz = 0; gz < 11; gz++) {
      const x = f32((gx - 5) * 2);
      const z = f32((gz - 5) * 2);
      instances.push(
        makeInstance(id++, CATEGORY.STATIC, [x, -2, z], [0.8, 0.8, 0.8], CATEGORY_COLOR[0])
      );
    }
  }

  // 2) 旋转环：20 个方块绕 y 轴旋转并整体环绕原点
  for (let i = 0; i < 20; i++) {
    const theta = f32((i / 20) * Math.PI * 2);
    const r = 9;
    const x = f32(r * Math.cos(theta));
    const z = f32(r * Math.sin(theta));
    instances.push(
      makeInstance(id++, CATEGORY.ROTATING, [x, 1.6, z], [0.9, 0.9, 0.9], CATEGORY_COLOR[1])
    );
  }

  // 3) 大遮挡体：边长 7 的立方体，放在相机与后排小模型之间
  instances.push(
    makeInstance(id++, CATEGORY.OCCLUDER, [0, 1.5, 14], [3.5, 3.5, 3.5], CATEGORY_COLOR[2])
  );

  // 4) 被大物体遮挡的小模型：10 个，藏在遮挡体后方，视锥内但被深度遮挡
  for (let i = 0; i < 10; i++) {
    const x = f32(-2.7 + i * 0.6);
    const y = f32(0.2 + (i % 3) * 1.2);
    const z = f32(19 + (i % 2) * 1.2);
    instances.push(
      makeInstance(id++, CATEGORY.OCCLUDED, [x, y, z], [0.3, 0.3, 0.3], CATEGORY_COLOR[3])
    );
  }

  return instances;
}

// 每帧更新动态实例：旋转网格更新模型矩阵与世界 AABB；静态实例首帧初始化即可
export function updateInstances(instances, dt) {
  for (const inst of instances) {
    if (inst.category === CATEGORY.ROTATING) {
      inst.angle = f32(inst.angle + f32(dt * 1.4));
      inst.model = composeTR(inst.angle, inst.base[0], inst.base[1], inst.base[2]);
      inst.world = transformAABB(inst.localMin, inst.localMax, inst.model);
    } else if (inst.model === null) {
      inst.model = composeTR(0, inst.base[0], inst.base[1], inst.base[2]);
      inst.world = transformAABB(inst.localMin, inst.localMax, inst.model);
    }
  }
}
