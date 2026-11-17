// Voxel storage: 0 = empty, positive integer = material id.
// Stored as Uint8 so valid materials are 1..255; the greedy mesher uses
// signed Int32 masks, which covers this range with room to spare.

export class VoxelVolume {
  constructor(sizeX, sizeY, sizeZ, chunkSize = 8) {
    if ([sizeX, sizeY, sizeZ, chunkSize].some((n) => n <= 0 || !Number.isInteger(n))) {
      throw new Error("dimensions and chunkSize must be positive integers");
    }
    this.sx = sizeX;
    this.sy = sizeY;
    this.sz = sizeZ;
    this.chunkSize = chunkSize;
    this.voxels = new Uint8Array(sizeX * sizeY * sizeZ);
  }

  index(x, y, z) {
    return (y * this.sz + z) * this.sx + x;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.voxels[this.index(x, y, z)];
  }

  set(x, y, z, material) {
    if (!this.inBounds(x, y, z)) {
      throw new Error(`voxel (${x},${y},${z}) out of bounds`);
    }
    this.voxels[this.index(x, y, z)] = material;
  }

  chunkCounts() {
    const c = this.chunkSize;
    return [
      Math.ceil(this.sx / c),
      Math.ceil(this.sy / c),
      Math.ceil(this.sz / c),
    ];
  }

  chunkOf(x, y, z) {
    const c = this.chunkSize;
    return [Math.floor(x / c), Math.floor(y / c), Math.floor(z / c)];
  }

  // All chunk coordinates [min,max) along each axis.
  *allChunks() {
    const [nx, ny, nz] = this.chunkCounts();
    for (let cy = 0; cy < ny; cy++) {
      for (let cz = 0; cz < nz; cz++) {
        for (let cx = 0; cx < nx; cx++) {
          yield [cx, cy, cz];
        }
      }
    }
  }

  chunkBounds(cx, cy, cz) {
    const c = this.chunkSize;
    return {
      x0: cx * c,
      y0: cy * c,
      z0: cz * c,
      x1: Math.min((cx + 1) * c, this.sx),
      y1: Math.min((cy + 1) * c, this.sy),
      z1: Math.min((cz + 1) * c, this.sz),
    };
  }

  // Chunks that own any face touched by changing the voxel at (x,y,z).
  // Neighbour chunks are included when the voxel sits on a chunk border,
  // because their culled/unculled face state also changes.
  affectedChunks(x, y, z) {
    const c = this.chunkSize;
    const [ccx, ccy, ccz] = this.chunkOf(x, y, z);
    const offsets = [
      [0, 0, 0],
      [x % c === 0 ? -1 : 0, 0, 0],
      [x % c === c - 1 || x === this.sx - 1 ? 1 : 0, 0, 0],
      [0, y % c === 0 ? -1 : 0, 0],
      [0, y % c === c - 1 || y === this.sy - 1 ? 1 : 0, 0],
      [0, 0, z % c === 0 ? -1 : 0],
      [0, 0, z % c === c - 1 || z === this.sz - 1 ? 1 : 0],
    ];
    const [nx, ny, nz] = this.chunkCounts();
    const seen = new Set();
    const result = [];
    for (const [ox, oy, oz] of offsets) {
      const cx = ccx + ox;
      const cy = ccy + oy;
      const cz = ccz + oz;
      if (cx < 0 || cy < 0 || cz < 0 || cx >= nx || cy >= ny || cz >= nz) continue;
      const key = `${cx},${cy},${cz}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push([cx, cy, cz]);
      }
    }
    return result;
  }
}
