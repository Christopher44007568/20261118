import { VoxelVolume } from "./voxel.js";

function fillBox(volume, x0, y0, z0, x1, y1, z1, material) {
  for (let y = y0; y < y1; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        volume.set(x, y, z, material);
      }
    }
  }
}

// Scene 1: solid single-material wall. Large mergeable runs, so the
// greedy mesher collapses nearly everything to a handful of big quads.
export function buildWall(chunkSize = 8) {
  const volume = new VoxelVolume(24, 8, 1, chunkSize);
  fillBox(volume, 0, 0, 0, 24, 8, 1, 1);
  return {
    name: "规则墙体 (24x8x1, 单一材质)",
    volume,
    digTarget: [8, 4, 0],
  };
}

// Scene 2: thick wall with one voxel removed from its centre.
// The hole is a closed pocket: six new interior faces appear while the
// outer silhouette stays identical. The target sits on chunk borders,
// exercising multi-chunk local rebuild.
export function buildSingleHole(chunkSize = 8) {
  const volume = new VoxelVolume(16, 8, 2, chunkSize);
  fillBox(volume, 0, 0, 0, 16, 8, 2, 1);
  const hole = [8, 4, 1];
  volume.set(...hole, 0);
  return {
    name: "单孔洞墙体 (16x8x2, 中心挖空 1 体素)",
    volume,
    digTarget: [12, 4, 0],
  };
}

// Scene 3: checkerboard of two materials in 2x2 tiles. Every voxel
// still has solid neighbours, so interior faces stay culled; material
// boundaries block merging while each same-colour tile still collapses
// into one quad, proving merging is material-aware yet effective.
export function buildChecker(chunkSize = 8) {
  const volume = new VoxelVolume(24, 8, 2, chunkSize);
  for (let y = 0; y < 8; y++) {
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 24; x++) {
        const material = ((Math.floor(x / 2) + Math.floor(y / 2) + Math.floor(z / 2)) % 2) + 1;
        volume.set(x, y, z, material);
      }
    }
  }
  return {
    name: "棋盘混合材质 (24x8x2, 两材质 2x2 色块交替)",
    volume,
    digTarget: [14, 4, 1],
  };
}

export const SCENE_BUILDERS = [buildWall, buildSingleHole, buildChecker];
