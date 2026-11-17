import assert from 'node:assert/strict';
import {
  f32, perspective, lookAt, mulMat4, extractFrustumPlanes,
  aabbInFrustum, transformAABB, composeTR,
} from '../js/math.js';
import { buildScene, updateInstances, CAMERAS } from '../js/scene.js';

// 1) 视锥平面对已知内部点为正、外部点为负
{
  const proj = perspective(f32((50 * Math.PI) / 180), f32(1280 / 720), 0.5, 120);
  const view = lookAt([0, 8, 34], [0, 0, 0], [0, 1, 0]);
  const vp = mulMat4(proj, view);
  const planes = extractFrustumPlanes(vp);

  const inside = [0, 0, 0];
  for (const p of planes) {
    const d = f32(f32(f32(p[0] * inside[0]) + f32(p[1] * inside[1])) + f32(p[2] * inside[2]) + p[3]);
    assert.ok(d > 0, `原点应在视锥内，平面距离 ${d}`);
  }

  // 相机身后的点必被剔除
  const behind = [0, 0, 60];
  assert.equal(aabbInFrustum(behind, [0.1, 0.1, 0.1], planes), false);
}

// 2) 旋转实例的世界 AABB 随旋转更新，且包围旋转后的几何体
{
  const model = composeTR(f32(Math.PI / 4), 5, 0, 0);
  const box = transformAABB([-1, -1, -1], [1, 1, 1], model);
  assert.ok(Math.abs(box.half[0] - Math.SQRT2) < 0.02, `旋转后 half.x≈sqrt2，实际 ${box.half[0]}`);
  assert.ok(Math.abs(box.half[2] - Math.SQRT2) < 0.02);
  assert.equal(box.half[1], 1);
}

// 2b) 动态场景多帧：旋转实例 AABB 逐帧变化，但任意角点始终被 AABB 包围
{
  const instances = buildScene();
  const halfXSeries = new Set();
  for (let frame = 0; frame < 60; frame++) {
    updateInstances(instances, 1 / 60);
    const rot = instances.find((it) => it.category === 1);
    halfXSeries.add(rot.world.half[0].toFixed(4));
    // 用模型矩阵变换 8 角点，验证都落在 world AABB 内
    for (let i = 0; i < 8; i++) {
      const lx = i & 1 ? rot.localMax[0] : rot.localMin[0];
      const ly = i & 2 ? rot.localMax[1] : rot.localMin[1];
      const lz = i & 4 ? rot.localMax[2] : rot.localMin[2];
      for (let row = 0; row < 3; row++) {
        const wx = f32(
          f32(rot.model[row] * lx) +
          f32(rot.model[4 + row] * ly) +
          f32(rot.model[8 + row] * lz) +
          rot.model[12 + row]
        );
        assert.ok(wx >= rot.world.min[row] - 1e-6 && wx <= rot.world.max[row] + 1e-6,
          `帧 ${frame} 角点越界 AABB`);
      }
    }
  }
  assert.ok(halfXSeries.size > 3, `旋转 AABB 应随帧变化，实际只有 ${halfXSeries.size} 种`);
}

// 3) 三相机下的场景统计：静态/旋转/遮挡类数量合理
{
  const instances = buildScene();
  updateInstances(instances, 0.1);
  assert.equal(instances.length, 152);

  const counts = [0, 0, 0, 0];
  for (const it of instances) counts[it.category]++;
  assert.deepEqual(counts, [121, 20, 1, 10]);

  const proj = perspective(f32((50 * Math.PI) / 180), f32(1280 / 720), 0.5, 120);
  const summary = CAMERAS.map((cam) => {
    const vp = mulMat4(proj, lookAt(cam.eye, cam.center, cam.up));
    const planes = extractFrustumPlanes(vp);
    let visible = 0;
    const byCat = [0, 0, 0, 0];
    for (const it of instances) {
      if (aabbInFrustum(it.world.center, it.world.half, planes)) {
        visible++;
        byCat[it.category]++;
      }
    }
    return { name: cam.name, visible, byCat };
  });

  for (const s of summary) {
    assert.ok(s.visible > 0 && s.visible < 152, `${s.name} 应发生真实裁剪`);
    // 被遮挡小模型必须仍在视锥内（验证未用缩小/远平面手段让它们消失）
    assert.ok(s.byCat[3] >= 5, `${s.name} 被遮挡模型应基本可见，实际 ${s.byCat[3]}`);
    assert.ok(s.byCat[2] === 1, `${s.name} 大遮挡体应在视锥内`);
  }
  console.log('三相机可见统计:', JSON.stringify(summary, null, 2));
}

// 4) 完全在视锥外的实例必被剔除
{
  const proj = perspective(f32((50 * Math.PI) / 180), f32(1280 / 720), 0.5, 120);
  const view = lookAt([0, 8, 34], [0, 0, 0], [0, 1, 0]);
  const planes = extractFrustumPlanes(mulMat4(proj, view));
  assert.equal(aabbInFrustum([0, 100, 0], [1, 1, 1], planes), false);
  assert.equal(aabbInFrustum([100, 0, 0], [1, 1, 1], planes), false);
}

console.log('全部 Node 逻辑测试通过 ✓');
