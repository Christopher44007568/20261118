import { describe, expect, it } from "vitest";
import { createConcavePrism, createCube, createNonManifoldFan, createOpenBox } from "../src/geometry";
import { prepareMesh } from "../src/mesh";
import {
  buildShadowVolume,
  countInconsistentWindingEdges,
  countNonWatertightEdges,
} from "../src/volume";

describe("closed mesh validation", () => {
  it("accepts a welded cube with consistent outward winding", () => {
    const mesh = prepareMesh(createCube([0, 1, 0], 1));
    expect(mesh.validation.closed).toBe(true);
    expect(mesh.validation.violations).toHaveLength(0);
    expect(mesh.validation.edges).toHaveLength(18);
  });

  it("accepts a concave prism and triangulates its caps", () => {
    const mesh = prepareMesh(createConcavePrism([0, 0.6, 0], 1.8, 1));
    expect(mesh.validation.closed).toBe(true);
  });

  it("reports open edges for an open box", () => {
    const mesh = prepareMesh(createOpenBox([0, 1, 0], 1));
    expect(mesh.validation.closed).toBe(false);
    const open = mesh.validation.violations.filter((violation) => violation.kind === "open");
    expect(open).toHaveLength(4);
    expect(open[0]?.point).toHaveLength(3);
    expect(buildShadowVolume(mesh, [3, 5, 2]).ok).toBe(false);
  });

  it("reports a non-manifold edge with three incident faces", () => {
    const mesh = prepareMesh(createNonManifoldFan([0, 1, 0]));
    expect(mesh.validation.closed).toBe(false);
    const nonManifold = mesh.validation.violations.filter(
      (violation) => violation.kind === "non-manifold",
    );
    expect(nonManifold).toHaveLength(1);
    expect(nonManifold[0]?.faceCount).toBe(3);
  });
});

describe("point-light shadow volume", () => {
  it("extracts six silhouette edges from a cube", () => {
    const mesh = prepareMesh(createCube([0, 1, 0], 1));
    const result = buildShadowVolume(mesh, [3.2, 5.2, 2.4], 80);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.volume.silhouetteEdges).toHaveLength(6);
    expect(result.volume.frontTriangleCount).toBe(6);
    expect(countInconsistentWindingEdges(result.volume.triangles)).toBe(0);
  });

  it("builds a watertight capped volume for a concave mesh", () => {
    const mesh = prepareMesh(createConcavePrism([0, 0.6, 0], 1.8, 1));
    const result = buildShadowVolume(mesh, [3, 6, 2], 80);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.volume.farTriangleCount).toBeGreaterThan(0);
    expect(countNonWatertightEdges(result.volume.triangles)).toBe(0);
    expect(countInconsistentWindingEdges(result.volume.triangles)).toBe(0);
  });
});
