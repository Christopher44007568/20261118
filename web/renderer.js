import { identity, lookAt, multiply, perspective } from "./mat4.js";

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vColor;
void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  vNormal = aNormal;
  vColor = aColor;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
uniform vec3 uLightDir;
out vec4 outColor;
void main() {
  float diffuse = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
  vec3 lit = vColor * (0.35 + 0.65 * diffuse);
  outColor = vec4(lit, 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: true });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
    this.program = createProgram(gl, VERT, FRAG);
    this.locViewProj = gl.getUniformLocation(this.program, "uViewProj");
    this.locLightDir = gl.getUniformLocation(this.program, "uLightDir");
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.07, 0.08, 0.1, 1);
    this.vao = null;
    this.indexCount = 0;
    this.yaw = 0.7;
    this.pitch = 0.5;
    this.distance = 34;
    this.center = [10, 4, 1];
    this.installControls(canvas);
  }

  uploadMesh(gpuMesh) {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, gpuMesh.vertices, gl.STATIC_DRAW);
    const stride = gpuMesh.strideFloats * 4;
    setupAttrib(gl, 0, 3, stride, 0);
    setupAttrib(gl, 1, 3, stride, 3 * 4);
    setupAttrib(gl, 2, 3, stride, 6 * 4);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gpuMesh.indices, gl.STATIC_DRAW);
    this.indexCount = gpuMesh.indexCount;
    gl.bindVertexArray(null);
  }

  installControls(canvas) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointerup", () => {
      dragging = false;
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      this.yaw += (event.clientX - lastX) * 0.01;
      this.pitch = clamp(this.pitch + (event.clientY - lastY) * 0.01, -1.4, 1.4);
      lastX = event.clientX;
      lastY = event.clientY;
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.distance = clamp(this.distance + event.deltaY * 0.02, 12, 90);
      },
      { passive: false }
    );
  }

  render() {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.vao) return;

    const eye = [
      this.center[0] + this.distance * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.center[1] + this.distance * Math.sin(this.pitch),
      this.center[2] + this.distance * Math.cos(this.pitch) * Math.cos(this.yaw),
    ];
    const aspect = gl.canvas.width / gl.canvas.height;
    const proj = perspective(Math.PI / 4, aspect, 0.1, 200);
    const view = lookAt(eye, this.center, [0, 1, 0]);
    const viewProj = multiply(proj, view);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locViewProj, false, viewProj);
    gl.uniform3fv(this.locLightDir, new Float32Array([0.5, 0.8, 0.6]));
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  frame(center) {
    this.center = center;
  }

  start() {
    const loop = () => {
      this.render();
      requestAnimationFrame(loop);
    };
    loop();
  }
}

function setupAttrib(gl, location, size, stride, offset) {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
}

function createProgram(gl, vertSource, fragSource) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSource);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSource);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
