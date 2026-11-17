export function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Link error: ' + gl.getProgramInfoLog(p));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return p;
}

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Compile error: ' + gl.getShaderInfoLog(s) + '\n' + src);
  }
  return s;
}

export function uniformLocations(gl, program, names) {
  const locs = {};
  for (const n of names) locs[n] = gl.getUniformLocation(program, n);
  return locs;
}

export function makeTexture(gl, width, height, internalformat, format, type) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalformat, width, height, 0,
    format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createMesh(gl, data) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  attachAttrib(gl, 0, data.positions, 3);
  attachAttrib(gl, 1, data.normals, 3);
  attachAttrib(gl, 2, data.uvs, 2);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(data.indices),
    gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: data.indices.length };
}

function attachAttrib(gl, index, data, size) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(index);
  gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
}

// Fullscreen triangle as a single VAO reused by every screen-space pass.
export function createQuad(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 3, -1, -1, 3,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}
