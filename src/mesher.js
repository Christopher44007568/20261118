// Face culling + greedy meshing.
//
// Quad record convention (shared by the naive and greedy meshers):
//   { d: 0|1|2, sign: 1|-1, x, y, z, w, h, material }
// d is the normal axis (0=x,1=y,2=z), sign its direction.
// (x,y,z) is the minimum corner of the quad. On the normal axis it is
// the face plane coordinate (voxel front for sign=+1, back for -1);
// on the two in-plane axes it is the minimum coordinate.
// w extends along u=(d+1)%3, h along v=(d+2)%3.

const AXES = [0, 1, 2];

function fullBounds(volume) {
  return { x0: 0, y0: 0, z0: 0, x1: volume.sx, y1: volume.sy, z1: volume.sz };
}

// One quad per visible voxel face. Reference implementation used to
// prove greedy meshing keeps the exact same visible surface.
export function naiveMesh(volume, bounds = fullBounds(volume)) {
  const quads = [];
  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let z = bounds.z0; z < bounds.z1; z++) {
      for (let x = bounds.x0; x < bounds.x1; x++) {
        const material = volume.get(x, y, z);
        if (material === 0) continue;
        const p = [x, y, z];
        for (const d of AXES) {
          const front = p.slice();
          front[d] += 1;
          const back = p.slice();
          back[d] -= 1;
          if (volume.get(front[0], front[1], front[2]) === 0) {
            const corner = p.slice();
            corner[d] += 1;
            quads.push(makeQuad(d, 1, corner, 1, 1, material));
          }
          if (volume.get(back[0], back[1], back[2]) === 0) {
            const corner = p.slice();
            quads.push(makeQuad(d, -1, corner, 1, 1, material));
          }
        }
      }
    }
  }
  return { quads, stats: summarize(quads) };
}

function makeQuad(d, sign, corner, w, h, material) {
  return { d, sign, x: corner[0], y: corner[1], z: corner[2], w, h, material };
}

// Greedy meshing: sweep each axis, build a signed material mask per
// plane, then merge runs/rectangles of identical mask values.
// Faces between two solid voxels are culled regardless of material,
// and quads only merge when both geometry and material match.
export function greedyMesh(volume, bounds = fullBounds(volume)) {
  const dims = [bounds.x1 - bounds.x0, bounds.y1 - bounds.y0, bounds.z1 - bounds.z0];
  const origin = [bounds.x0, bounds.y0, bounds.z0];
  const quads = [];

  for (const d of AXES) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = dims[u];
    const dv = dims[v];
    const mask = new Int32Array(du * dv);
    const local = [0, 0, 0];
    const step = [0, 0, 0];
    step[d] = 1;

    local[d] = -1;
    while (local[d] < dims[d]) {
      for (local[v] = 0; local[v] < dv; local[v]++) {
        for (local[u] = 0; local[u] < du; local[u]++) {
          const behind = [0, 0, 0];
          const ahead = [0, 0, 0];
          for (const axis of AXES) {
            behind[axis] = origin[axis] + local[axis];
            ahead[axis] = behind[axis] + step[axis];
          }
          const matBehind = volume.get(behind[0], behind[1], behind[2]);
          const matAhead = volume.get(ahead[0], ahead[1], ahead[2]);
          let value = 0;
          if (matBehind !== 0 && matAhead === 0) value = matBehind;
          else if (matBehind === 0 && matAhead !== 0) value = -matAhead;
          mask[local[u] + du * local[v]] = value;
        }
      }
      local[d]++;

      let j = 0;
      while (j < dv) {
        let k = 0;
        while (k < du) {
          const current = mask[k + du * j];
          if (current === 0) {
            k++;
            continue;
          }
          let width = 1;
          while (k + width < du && mask[k + width + du * j] === current) width++;
          let height = 1;
          let blocked = false;
          while (j + height < dv && !blocked) {
            for (let kk = 0; kk < width; kk++) {
              if (mask[k + kk + du * (j + height)] !== current) {
                blocked = true;
                break;
              }
            }
            if (!blocked) height++;
          }
          const corner = [0, 0, 0];
          corner[d] = origin[d] + local[d];
          corner[u] = origin[u] + k;
          corner[v] = origin[v] + j;
          quads.push(
            makeQuad(d, current > 0 ? 1 : -1, corner, width, height, Math.abs(current))
          );
          for (let l = 0; l < height; l++) {
            for (let kk = 0; kk < width; kk++) {
              mask[k + kk + du * (j + l)] = 0;
            }
          }
          k += width;
        }
        j++;
      }
    }
  }
  return { quads, stats: summarize(quads) };
}

export function summarize(quads) {
  const triangles = quads.length * 2;
  const vertices = quads.length * 4;
  return { quads: quads.length, triangles, vertices };
}
