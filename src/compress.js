// Pack / unpack the compressed vertex stream.
//
// Compressed per-vertex stride (padded for GPU vertex attributes, 4-byte
// aligned):
//   bytes 0..5   position : 3 x UNORM16
//   bytes 6..7   normal   : 2 x SNORM8  (octahedron, oct16)
//   bytes 8..11  uv       : 2 x UNORM16
//   byte  12     tangent  : handedness sign in {-1,+1} (one byte)
//   bytes 13..15 padding
//
// The oct32 comparison layout (oct32 flag) replaces the two SNORM8 normals
// with two SNORM16 at bytes 6..9 and shifts the remaining fields, yielding a
// 20-byte stride.

import { makeAabbQuantizer, dequantizeUnorm16, dequantizeSnorm8 } from './quant.js';
import { oct16Encode, oct16Decode, oct32Encode, oct32Decode } from './octahedron.js';
import { cross3 } from './mesh.js';

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// Sign-only tangent reconstruction: the tangent vector is rebuilt from the
// (decoded) normal and the stored handedness sign. The original tangent
// direction is discarded; only the frame handedness survives.
export function reconstructTangent(normal, handedness) {
  const up = Math.abs(normal[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  let t = normalize3(cross3(up, normal));
  // Rebuild the bitangent with the stored orientation.
  const bitangent = normalize3(
    handedness >= 0 ? cross3(normal, t) : cross3(t, normal)
  );
  // Re-orthogonalize the tangent so the frame is strictly orthonormal.
  t = normalize3(cross3(bitangent, normal));
  return t;
}

export function compressMesh(mesh, { mode = 'oct16' } = {}) {
  const q = makeAabbQuantizer(mesh.aabb);
  const vertexCount = mesh.positions.length / 3;
  const stride = mode === 'oct32' ? 20 : 16;
  const bytes = new Uint8Array(stride * vertexCount);
  const view = new DataView(bytes.buffer);

  for (let v = 0; v < vertexCount; v++) {
    const base = v * stride;
    const p = mesh.positions.slice(3 * v, 3 * v + 3);
    const n = mesh.normals.slice(3 * v, 3 * v + 3);
    const uv = mesh.uvs.slice(2 * v, 2 * v + 2);
    const pq = q.quantize(p);
    view.setUint16(base + 0, pq[0], true);
    view.setUint16(base + 2, pq[1], true);
    view.setUint16(base + 4, pq[2], true);
    if (mode === 'oct32') {
      const nq = oct32Encode(n);
      view.setInt16(base + 6, nq[0], true);
      view.setInt16(base + 8, nq[1], true);
      view.setUint16(base + 10, Math.round(uv[0] * 65535), true);
      view.setUint16(base + 12, Math.round(uv[1] * 65535), true);
      view.setInt8(base + 14, mesh.handedness[v] >= 0 ? 1 : -1);
    } else {
      const nq = oct16Encode(n);
      view.setInt8(base + 6, nq[0]);
      view.setInt8(base + 7, nq[1]);
      view.setUint16(base + 8, Math.round(uv[0] * 65535), true);
      view.setUint16(base + 10, Math.round(uv[1] * 65535), true);
      view.setInt8(base + 12, mesh.handedness[v] >= 0 ? 1 : -1);
    }
  }
  return { bytes, stride, mode, aabb: mesh.aabb, vertexCount };
}

export function decompressMesh(mesh, packed) {
  const { bytes, stride, mode, aabb } = packed;
  const view = new DataView(bytes.buffer);
  const range = [
    aabb.max[0] - aabb.min[0],
    aabb.max[1] - aabb.min[1],
    aabb.max[2] - aabb.min[2],
  ];
  const vertexCount = packed.vertexCount;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const tangent = new Float32Array(vertexCount * 3);
  const handedness = new Int8Array(vertexCount);

  for (let v = 0; v < vertexCount; v++) {
    const base = v * stride;
    for (let k = 0; k < 3; k++) {
      const qn = view.getUint16(base + 2 * k, true);
      positions[3 * v + k] = aabb.min[k] + dequantizeUnorm16(qn) * range[k];
    }
    let n;
    if (mode === 'oct32') {
      n = oct32Decode([view.getInt16(base + 6, true), view.getInt16(base + 8, true)]);
      uvs[2 * v] = dequantizeUnorm16(view.getUint16(base + 10, true));
      uvs[2 * v + 1] = dequantizeUnorm16(view.getUint16(base + 12, true));
      handedness[v] = view.getInt8(base + 14);
    } else {
      n = oct16Decode([view.getInt8(base + 6), view.getInt8(base + 7)]);
      uvs[2 * v] = dequantizeUnorm16(view.getUint16(base + 8, true));
      uvs[2 * v + 1] = dequantizeUnorm16(view.getUint16(base + 10, true));
      handedness[v] = view.getInt8(base + 12);
    }
    normals.set(n, 3 * v);
    tangent.set(reconstructTangent(n, handedness[v]), 3 * v);
  }
  return { positions, normals, uvs, tangent, handedness, indices: mesh.indices };
}

// Source (uncompressed) byte size: position3 + normal3 + uv2 + tangent4
// (vec4 tangent packs the handedness in .w), all float32 = 48 bytes/vertex.
export function sourceByteCount(vertexCount) {
  return vertexCount * (3 + 3 + 2 + 4) * 4;
}

export function compressedByteCount(packed) {
  return packed.bytes.byteLength;
}
