import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBaker } from "../src/baker.js";
import { buildScenarios } from "../src/meshes.js";

const wasm = readFileSync(new URL("../public/baker.wasm", import.meta.url));
const scenarios = buildScenarios(40);

async function bake(highMesh, options = {}) {
  const baker = await createBaker(wasm);
  return baker.bake({
    highMesh,
    lowMesh: scenarios.low,
    resolution: 128,
    projection: "cage",
    cageOffset: 0.2,
    rayDistance: 0.4,
    weightScale: 8,
    maxHits: 8,
    ...options,
  });
}

function pixel(result, u, v) {
  const x = Math.min(result.width - 1, Math.max(0, Math.floor(u * result.width)));
  const y = Math.min(result.height - 1, Math.max(0, Math.floor(v * result.height)));
  const offset = (y * result.width + x) * 4;
  return [...result.texture.slice(offset, offset + 4)];
}

function assertNeutral(texel) {
  assert.ok(Math.abs(texel[0] - 0.5) < 1e-5);
  assert.ok(Math.abs(texel[1] - 0.5) < 1e-5);
  assert.ok(Math.abs(texel[2] - 1.0) < 1e-5);
  assert.equal(texel[3], 0);
}

test("几何法线、UV 岛范围和圆角轮廓一致", () => {
  for (const mesh of [scenarios.low, scenarios.hard.high, scenarios.rounded.high]) {
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const ia = mesh.indices[index] * 3;
      const ib = mesh.indices[index + 1] * 3;
      const ic = mesh.indices[index + 2] * 3;
      const ax = mesh.positions[ia], ay = mesh.positions[ia + 1], az = mesh.positions[ia + 2];
      const e1 = [
        mesh.positions[ib] - ax,
        mesh.positions[ib + 1] - ay,
        mesh.positions[ib + 2] - az,
      ];
      const e2 = [
        mesh.positions[ic] - ax,
        mesh.positions[ic + 1] - ay,
        mesh.positions[ic + 2] - az,
      ];
      const normal = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const vertexNormal = [
        mesh.normals[ia] + mesh.normals[ib] + mesh.normals[ic],
        mesh.normals[ia + 1] + mesh.normals[ib + 1] + mesh.normals[ic + 1],
        mesh.normals[ia + 2] + mesh.normals[ib + 2] + mesh.normals[ic + 2],
      ];
      const dot =
        normal[0] * vertexNormal[0] +
        normal[1] * vertexNormal[1] +
        normal[2] * vertexNormal[2];
      assert.ok(dot > 0, "triangle winding must match outward vertex normals");
    }
  }
  assert.equal(scenarios.low.vertexCount, 24);
  assert.equal(scenarios.low.triangleCount, 12);
  assert.equal(scenarios.hard.high.triangleCount, 12);
  assert.ok(scenarios.rounded.high.triangleCount > 10000);
  assert.ok(Math.min(...scenarios.low.uvs) >= 0.024 - 1e-6);
  assert.ok(Math.max(...scenarios.low.uvs) <= 0.976 + 1e-6);
});

test("硬边箱体烘焙保留中性面法线并填充 UV 岛", async () => {
  const result = await bake(scenarios.hard.high);
  assert.ok(result.stats.coverage > 0.75);
  assert.ok(result.stats.maxHits >= 1);
  let marginal = 0;
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 3; column++) {
      const texel = pixel(result, (column + 0.5) / 3, (row + 0.5) / 2);
      assert.ok(texel[3] > 0, "island center must be covered");
      assert.ok(texel[2] > 0.97, "flat face center should stay close to neutral");
    }
  }
  assertNeutral(pixel(result, 0.012, 0.5));
  for (let i = 0; i < result.texture.length; i += 4) {
    if (result.texture[i + 3] === 0) {
      assertNeutral([...result.texture.slice(i, i + 4)]);
    } else if (result.texture[i] > 0.53 || result.texture[i + 1] > 0.53) {
      marginal++;
    }
  }
  assert.ok(marginal > 100, "hard edge rays should produce colored edge strips");
});

test("圆角高模产生边缘渐变法线", async () => {
  const result = await bake(scenarios.rounded.high);
  assert.ok(result.stats.coverage > 0.75);
  assert.ok(result.stats.maxHits >= 1);
  let minimumZ = 1;
  let varied = 0;
  for (let i = 0; i < result.texture.length; i += 4) {
    if (result.texture[i + 3] === 0) continue;
    minimumZ = Math.min(minimumZ, result.texture[i + 2]);
    if (Math.abs(result.texture[i] - 0.5) > 0.03 || Math.abs(result.texture[i + 1] - 0.5) > 0.03) {
      varied++;
    }
  }
  assert.ok(minimumZ < 0.95, "rounded edges should tilt baked normals away from neutral");
  assert.ok(varied > 500, "rounded high should affect a substantial edge band");
});

test("最近表面投射与短射线的零命中处理", async () => {
  const nearest = await bake(scenarios.rounded.high, { projection: "nearest" });
  assert.ok(nearest.stats.coverage > 0.75);
  const shortRay = await bake(scenarios.rounded.high, { rayDistance: 0.1 });
  assert.ok(shortRay.stats.coverage < 0.1);
  assert.ok(shortRay.stats.zeroPixels > shortRay.texture.length / 4 * 0.9);
  for (let i = 0; i < shortRay.texture.length; i += 4) {
    if (shortRay.texture[i + 3] === 0) {
      assertNeutral([...shortRay.texture.slice(i, i + 4)]);
    }
  }
});

test("双层命中按距离权重累计", async () => {
  const lowMesh = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    tangents: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
    bitangents: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0.25, 0.25, 0.75, 0.25, 0.25, 0.75]),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    triangleCount: 1,
  };
  const highPositions = new Float32Array([
    -1, -1, 0.1, 1, -1, 0.1, 0, 1, 0.1,
    -1, -1, 0.2, 1, -1, 0.2, 0, 1, 0.2,
  ]);
  const highMesh = {
    positions: highPositions,
    normals: new Float32Array(18).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    vertexCount: 6,
    triangleCount: 2,
  };
  const baker = await createBaker(wasm);
  const cagePositions = new Float32Array([
    -0.5, -0.5, 0.3, 0.5, -0.5, 0.3, -0.5, 0.5, 0.3,
  ]);
  const result = baker.bake({
    highMesh,
    lowMesh,
    cagePositions,
    resolution: 32,
    projection: "cage",
    cageOffset: 0.3,
    rayDistance: 0.35,
    weightScale: 8,
    maxHits: 8,
  });
  assert.equal(result.stats.maxHits, 2);
  assert.equal(result.stats.totalHits, result.stats.hitPixels * 2);
  const center = pixel(result, 0.3, 0.35);
  assert.ok(center[3] > 0);
  assert.ok(center[2] > 0.98);
});
