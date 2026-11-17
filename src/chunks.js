import { greedyMesh, summarize } from "./mesher.js";

// Meshes each chunk independently so a voxel edit only rebuilds its
// neighbouring chunks instead of the whole volume.
export class ChunkManager {
  constructor(volume) {
    this.volume = volume;
    this.meshes = new Map();
  }

  key(cx, cy, cz) {
    return `${cx},${cy},${cz}`;
  }

  rebuildChunk(cx, cy, cz) {
    const bounds = this.volume.chunkBounds(cx, cy, cz);
    const mesh = greedyMesh(this.volume, bounds);
    this.meshes.set(this.key(cx, cy, cz), mesh);
    return mesh;
  }

  rebuildAll() {
    const rebuilt = [];
    for (const [cx, cy, cz] of this.volume.allChunks()) {
      this.rebuildChunk(cx, cy, cz);
      rebuilt.push([cx, cy, cz]);
    }
    return rebuilt;
  }

  // Remove a voxel and rebuild only the chunks whose faces it touches.
  dig(x, y, z) {
    const before = this.triangleCount();
    const beforeMaterial = this.volume.get(x, y, z);
    const targets =
      beforeMaterial === 0
        ? []
        : this.volume.affectedChunks(x, y, z);
    if (beforeMaterial !== 0) {
      this.volume.set(x, y, z, 0);
      for (const chunk of targets) {
        this.rebuildChunk(...chunk);
      }
    }
    const after = this.triangleCount();
    return {
      removedMaterial: beforeMaterial,
      rebuiltChunks: targets,
      trianglesBefore: before,
      trianglesAfter: after,
      delta: after - before,
    };
  }

  allQuads() {
    const quads = [];
    for (const mesh of this.meshes.values()) {
      quads.push(...mesh.quads);
    }
    return quads;
  }

  triangleCount() {
    let total = 0;
    for (const mesh of this.meshes.values()) {
      total += mesh.stats.triangles;
    }
    return total;
  }

  quadCount() {
    let total = 0;
    for (const mesh of this.meshes.values()) {
      total += mesh.quads.length;
    }
    return total;
  }

  combinedStats() {
    return summarize(this.allQuads());
  }
}
