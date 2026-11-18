import { lookAt, multiply, perspective } from "./math.js";
import {
  HIGH_FRAGMENT,
  HIGH_VERTEX,
  LINE_FRAGMENT,
  LINE_VERTEX,
  LOW_FRAGMENT,
  LOW_VERTEX,
} from "./shaders.js";

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

function createBuffer(gl, target, data, usage = gl.STATIC_DRAW) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, usage);
  return buffer;
}

function attachAttribute(gl, vao, buffer, location, size) {
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

function edgeIndices(mesh) {
  const seen = new Set();
  const edges = [];
  const { indices } = mesh;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const low = Math.min(u, v);
      const high = Math.max(u, v);
      const key = low * 1000000 + high;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(u, v);
    }
  }
  return new Uint32Array(edges);
}

function createVao(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  return vao;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("当前浏览器不支持 WebGL2");
    this.canvas = canvas;
    this.gl = gl;
    this.lowProgram = createProgram(gl, LOW_VERTEX, LOW_FRAGMENT);
    this.highProgram = createProgram(gl, HIGH_VERTEX, HIGH_FRAGMENT);
    this.lineProgram = createProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
    this.lowUniforms = this.collectUniforms(this.lowProgram);
    this.highUniforms = this.collectUniforms(this.highProgram);
    this.lineUniforms = this.collectUniforms(this.lineProgram);
    this.lowAttributes = this.collectAttributes(this.lowProgram);
    this.highAttributes = this.collectAttributes(this.highProgram);
    this.lineAttributes = this.collectAttributes(this.lineProgram);
    this.projection = new Float32Array(16);
    this.view = new Float32Array(16);
    this.viewProjection = new Float32Array(16);
    this.camera = { azimuth: 0.72, elevation: 0.38, distance: 4.75, target: [0, 0, 0] };
    this.lowMesh = null;
    this.highMesh = null;
    this.texture = null;
    this.textureSize = 0;
    this.createFallbackTexture();
    this.resize();
  }

  collectUniforms(program) {
    const gl = this.gl;
    const result = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      result[info.name] = gl.getUniformLocation(program, info.name);
    }
    return result;
  }

  collectAttributes(program) {
    const gl = this.gl;
    const count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    const result = {};
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveAttrib(program, i);
      result[info.name] = gl.getAttribLocation(program, info.name);
    }
    return result;
  }

  createFallbackTexture() {
    const gl = this.gl;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT,
      new Float32Array([0.5, 0.5, 1, 0]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  setLowMesh(mesh) {
    const gl = this.gl;
    const attrs = this.lowAttributes;
    const vao = createVao(gl);
    const positions = createBuffer(gl, gl.ARRAY_BUFFER, mesh.positions);
    attachAttribute(gl, vao, positions, attrs.aPosition, 3);
    attachAttribute(gl, vao, createBuffer(gl, gl.ARRAY_BUFFER, mesh.normals), attrs.aNormal, 3);
    attachAttribute(gl, vao, createBuffer(gl, gl.ARRAY_BUFFER, mesh.tangents), attrs.aTangent, 3);
    attachAttribute(gl, vao, createBuffer(gl, gl.ARRAY_BUFFER, mesh.bitangents), attrs.aBitangent, 3);
    attachAttribute(gl, vao, createBuffer(gl, gl.ARRAY_BUFFER, mesh.uvs), attrs.aUv, 2);
    const index = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
    gl.bindVertexArray(null);
    this.lowMesh = { ...mesh, vao, index };
  }

  setHighMesh(mesh) {
    const gl = this.gl;
    const attrs = this.highAttributes;
    const vao = createVao(gl);
    const positions = createBuffer(gl, gl.ARRAY_BUFFER, mesh.positions);
    attachAttribute(gl, vao, positions, attrs.aPosition, 3);
    attachAttribute(gl, vao, createBuffer(gl, gl.ARRAY_BUFFER, mesh.normals), attrs.aNormal, 3);
    const index = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
    gl.bindVertexArray(null);

    const wireVao = createVao(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    attachAttribute(gl, wireVao, positions, this.lineAttributes.aPosition, 3);
    const wireIndex = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, edgeIndices(mesh));
    gl.bindVertexArray(null);
    this.highMesh = { ...mesh, vao, index, wireVao, wireIndex, wireCount: wireIndex.length };
  }

  setBake(texture, width, height) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, texture,
    );
    this.textureSize = width;
  }

  clearBake() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT,
      new Float32Array([0.5, 0.5, 1, 0]),
    );
    this.textureSize = 0;
  }

  cameraEye() {
    const { azimuth, elevation, distance, target } = this.camera;
    const horizontal = Math.cos(elevation) * distance;
    return [
      target[0] + Math.sin(azimuth) * horizontal,
      target[1] + Math.sin(elevation) * distance,
      target[2] + Math.cos(azimuth) * horizontal,
    ];
  }

  orbit(deltaX, deltaY) {
    this.camera.azimuth -= deltaX * 0.008;
    this.camera.elevation = Math.max(
      -1.35,
      Math.min(1.35, this.camera.elevation + deltaY * 0.008),
    );
  }

  zoom(delta) {
    this.camera.distance = Math.max(2.1, Math.min(7.5, this.camera.distance * Math.exp(delta)));
  }

  resetCamera() {
    this.camera = { azimuth: 0.72, elevation: 0.38, distance: 4.75, target: [0, 0, 0] };
  }

  updateCamera() {
    const eye = this.cameraEye();
    perspective(
      this.projection,
      Math.PI / 5,
      this.canvas.width / Math.max(1, this.canvas.height),
      0.05,
      30,
    );
    lookAt(this.view, eye, this.camera.target, [0, 1, 0]);
    multiply(this.viewProjection, this.projection, this.view);
    return eye;
  }

  draw(options) {
    const gl = this.gl;
    this.resize();
    const eye = this.updateCamera();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);

    if (options.showHigh && this.highMesh) {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(this.highProgram);
      const uniforms = this.highUniforms;
      gl.uniformMatrix4fv(uniforms.uViewProjection, false, this.viewProjection);
      gl.uniform3fv(uniforms.uCamera, eye);
      gl.uniform3fv(uniforms.uColor, [0.12, 0.68, 0.92]);
      gl.uniform1f(uniforms.uAlpha, options.showHighFill ? 0.052 : 0);
      if (options.showHighFill) {
        gl.bindVertexArray(this.highMesh.vao);
        gl.drawElements(gl.TRIANGLES, this.highMesh.indices.length, gl.UNSIGNED_INT, 0);
      }

      if (options.showWire) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.lineProgram);
        gl.uniformMatrix4fv(this.lineUniforms.uViewProjection, false, this.viewProjection);
        gl.uniform4fv(this.lineUniforms.uColor, [0.29, 0.90, 1.0, 0.32]);
        gl.bindVertexArray(this.highMesh.wireVao);
        gl.drawElements(gl.LINES, this.highMesh.wireCount, gl.UNSIGNED_INT, 0);
      }
    }

    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (options.showLow && this.lowMesh) {
      gl.useProgram(this.lowProgram);
      const uniforms = this.lowUniforms;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(uniforms.uBake, 0);
      gl.uniformMatrix4fv(uniforms.uViewProjection, false, this.viewProjection);
      gl.uniform3fv(uniforms.uCamera, eye);
      gl.uniform1f(uniforms.uUseBake, options.showBake ? 1 : 0);
      gl.uniform1f(uniforms.uNormalMix, options.normalMix);
      gl.bindVertexArray(this.lowMesh.vao);
      gl.drawElements(gl.TRIANGLES, this.lowMesh.indices.length, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }
}
