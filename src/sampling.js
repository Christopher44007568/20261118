// Deterministic hemisphere kernel and a small fixed rotation-noise texture.

function hash(n) {
  // Stable hash so every run produces the identical kernel (no flicker
  // across frames or camera motion).
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function buildHemisphereKernel(size) {
  const samples = new Float32Array(size * 3);
  for (let i = 0; i < size; i++) {
    // Random direction inside the upper hemisphere (z >= 0 in kernel space).
    let x = hash(i * 3 + 1) * 2 - 1;
    let y = hash(i * 3 + 2) * 2 - 1;
    let z = hash(i * 3 + 3);
    const len = Math.hypot(x, y, z) || 1;
    x /= len; y /= len; z /= len;
    if (z < 0) { x = -x; y = -y; z = -z; }

    // Distribute more samples near the origin and give them unit scaling.
    let scale = i / size;
    scale = 0.1 + 0.9 * scale * scale;
    samples[i * 3] = x * scale;
    samples[i * 3 + 1] = y * scale;
    samples[i * 3 + 2] = z * scale;
  }
  return samples;
}

export function buildNoiseTexture(gl, size = 4) {
  const data = new Float32Array(size * size * 2);
  for (let i = 0; i < size * size; i++) {
    // Store a deterministic random angle directly in [0, 1); the shader
    // maps it to radians. Keeping it scalar avoids a cos/sin mismatch.
    data[i * 2] = hash(i * 2 + 101);
    data[i * 2 + 1] = hash(i * 2 + 202);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, size, size, 0, gl.RG, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}
