import { describe, expect, it } from "vitest";
import { createScenes } from "../src/scenes";
import { buildShadowVolume } from "../src/volume";
import { isOccludedFromLight, pointInsideMesh } from "../src/occlusion";
import { pointInsideShadowVolume } from "../src/verification";
import { vec3 } from "../src/math";

describe("scene invariants", () => {
  it("places the inside-volume camera in a shadow volume but outside solids", () => {
    const scenes = createScenes();
    for (const scene of scenes.slice(0, 3)) {
      const volumes = scene.casters.map((mesh) =>
        buildShadowVolume(mesh, scene.lightPosition, 150),
      );
      expect(volumes.every((volume) => volume.ok)).toBe(true);
      const point = scene.insideCamera.position;
      const insideAnyVolume = volumes.some(
        (volume) =>
          volume.ok && pointInsideShadowVolume(point, volume.volume.triangles),
      );
      expect(insideAnyVolume).toBe(true);
      expect(scene.casters.some((mesh) => pointInsideMesh(point, mesh))).toBe(false);
    }
  });

  it("slices the cube with the near plane in the near-camera preset", () => {
    const scene = createScenes()[0]!;
    const camera = scene.nearCamera;
    const forward = vec3.normalize(vec3.sub(camera.target, camera.position));
    const depths = scene.casters[0]!.positions.map((position) =>
      vec3.dot(vec3.sub(position, camera.position), forward),
    );
    expect(Math.min(...depths)).toBeGreaterThan(0);
    expect(Math.min(...depths)).toBeLessThan(camera.near);
    expect(Math.max(...depths)).toBeGreaterThan(camera.near);
  });

  it("matches analytic cube occlusion on the ground", () => {
    const scene = createScenes()[0]!;
    const light = scene.lightPosition;
    const center = scene.casters[0]!.positions.reduce(
      (sum, point) => vec3.add(sum, point),
      [0, 0, 0] as [number, number, number],
    );
    const cubeCenter = vec3.scale(center, 1 / scene.casters[0]!.positions.length);
    const t = (light[1] - 0.01) / (light[1] - cubeCenter[1]);
    const shadowPoint = vec3.add(
      light,
      vec3.scale(vec3.sub(cubeCenter, light), t),
    );
    expect(isOccludedFromLight(shadowPoint, [0, 1, 0], light, scene.casters)).toBe(true);
    expect(
      isOccludedFromLight([4.5, 0.01, 4.5], [0, 1, 0], light, scene.casters),
    ).toBe(false);
  });
});
