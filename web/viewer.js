"use strict";
// WebGL2 viewer for the approximate subsurface scattering material.
// It reuses the exact GLSL ES 3.00 shaders from src/shaders (including the
// shared sss_common.glsl math) so the browser and headless tests match.

const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl2", { antialias: false });
if (!gl) {
  document.body.innerHTML = "<p style='padding:24px'>WebGL2 unavailable.</p>";
  throw new Error("WebGL2 unavailable");
}

const SHADER_DIR = "../src/shaders";

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("fetch failed " + path);
  return res.text();
}

// GLSL ES has no #include; inline sss_common.glsl the same way the C loader
// (src/platform/shader_util.h) does.
async function loadShader(path) {
  const raw = await fetchText(path);
  const includeRe = /#include\s+"([^"]+)"/;
  let src = raw;
  while (includeRe.test(src)) {
    const m = src.match(includeRe);
    const inc = await fetchText(`${SHADER_DIR}/${m[1]}`);
    src = src.replace(m[0], inc);
  }
  return src;
}

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(src);
    throw new Error("shader compile: " + log);
  }
  return sh;
}

async function makeProgram(vertPath, fragPath) {
  const vs = compile(gl.VERTEX_SHADER, await loadShader(vertPath));
  const fs = compile(gl.FRAGMENT_SHADER, await loadShader(fragPath));
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("program link: " + gl.getProgramInfoLog(prog));
  }
  return prog;
}

// Column-major 4x4 matrices.
function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (far - near); m[11] = -1;
  m[14] = (2 * far * near) / (far - near);
  return m;
}
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function mat4LookAt(eye, center, up) {
  const f = normalize(sub(center, eye));
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  const m = mat4Identity();
  m[0]=s[0]; m[4]=s[1]; m[8]=s[2];
  m[1]=u[0]; m[5]=u[1]; m[9]=u[2];
  m[2]=-f[0]; m[6]=-f[1]; m[10]=-f[2];
  m[12]=-dot(s, eye); m[13]=-dot(u, eye); m[14]=dot(f, eye);
  return m;
}
function mat4Scale(x, y, z) {
  const m = mat4Identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}
function mat4RotateY(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const m = mat4Identity();
  m[0]=c; m[2]=-s; m[8]=s; m[10]=c;
  return m;
}
function mat4RotateX(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const m = mat4Identity();
  m[5]=c; m[6]=s; m[9]=-s; m[10]=c;
  return m;
}

// UV sphere with CCW outward-facing triangles (matches src/platform/mesh.h).
function makeSphere(stacks, slices) {
  const verts = [];
  const indices = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * Math.PI;
    const y = Math.cos(phi);
    const ring = Math.sin(phi);
    for (let j = 0; j <= slices; j++) {
      const theta = (j / slices) * 2 * Math.PI;
      const x = ring * Math.cos(theta);
      const z = ring * Math.sin(theta);
      verts.push(x, y, z, x, y, z);
    }
  }
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j;
      const b = (i + 1) * (slices + 1) + j;
      const c = (i + 1) * (slices + 1) + j + 1;
      const d = i * (slices + 1) + j + 1;
      indices.push(a, d, b, b, d, c);
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices),
                gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  return { vao, count: indices.length };
}

function makeFloatTexture(size) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0,
                gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function makePrepTarget(size) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const posTex = makeFloatTexture(size);
  const normalTex = makeFloatTexture(size);
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, size, size);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                          gl.TEXTURE_2D, posTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1,
                          gl.TEXTURE_2D, normalTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
                             gl.RENDERBUFFER, depth);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  return { fbo, posTex, normalTex };
}

const MATERIALS = {
  jade: {
    surfaceColor: [0.08, 0.30, 0.24],
    scatterColor: [0.78, 1.0, 0.55],
    curvatureScale: 2.2, density: 1.4, wrap: 0.55,
    scatterStrength: 1.35, anisotropy: 0.35, scatterPower: 1.6,
    thicknessScale: 2.4, specular: 0.35, shininess: 48,
    scale: [1, 1, 1],
  },
  skin: {
    surfaceColor: [0.78, 0.55, 0.45],
    scatterColor: [0.95, 0.35, 0.28],
    curvatureScale: 1.6, density: 1.3, wrap: 0.62,
    scatterStrength: 1.15, anisotropy: 0.25, scatterPower: 2.4,
    thicknessScale: 1.1, specular: 0.18, shininess: 28,
    scale: [1.25, 0.9, 0.42],
  },
};

const LIGHT_DIRS = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  side: [1, 0, 0],
};

const state = {
  material: "jade",
  light: "back",
  debug: 0,
  rotX: -0.15,
  rotY: 0.0,
};

function uniform(prog, name) { return gl.getUniformLocation(prog, name); }
function setMat4(prog, name, m) {
  gl.uniformMatrix4fv(uniform(prog, name), false, m);
}

async function main() {
  const prepProg = await makeProgram(`${SHADER_DIR}/prep.vert`,
                                     `${SHADER_DIR}/prep.frag`);
  const sssProg = await makeProgram(`${SHADER_DIR}/sss.vert`,
                                    `${SHADER_DIR}/sss.frag`);
  const mesh = makeSphere(48, 64);
  const size = 512;
  const front = makePrepTarget(size);
  const back = makePrepTarget(size);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
  }

  function runPrep(model, view, proj) {
    gl.useProgram(prepProg);
    setMat4(prepProg, "uModel", model);
    setMat4(prepProg, "uView", view);
    setMat4(prepProg, "uProj", proj);
    gl.bindVertexArray(mesh.vao);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    const clear = [0, 0, 0, 0];

    gl.bindFramebuffer(gl.FRAMEBUFFER, back.fbo);
    gl.clearBufferfv(gl.COLOR, 0, clear);
    gl.clearBufferfv(gl.COLOR, 1, clear);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.cullFace(gl.FRONT);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, front.fbo);
    gl.clearBufferfv(gl.COLOR, 0, clear);
    gl.clearBufferfv(gl.COLOR, 1, clear);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.cullFace(gl.BACK);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.CULL_FACE);
  }

  function runSss(mc, model, view, proj) {
    gl.useProgram(sssProg);
    setMat4(sssProg, "uModel", model);
    setMat4(sssProg, "uView", view);
    setMat4(sssProg, "uProj", proj);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, front.posTex);
    gl.uniform1i(uniform(sssProg, "uFrontPos"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, back.posTex);
    gl.uniform1i(uniform(sssProg, "uBackPos"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, front.normalTex);
    gl.uniform1i(uniform(sssProg, "uFrontNormal"), 2);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform2f(uniform(sssProg, "uTexel"), 1 / size, 1 / size);
    const L = LIGHT_DIRS[state.light];
    gl.uniform3f(uniform(sssProg, "uLightDir"), L[0], L[1], L[2]);
    gl.uniform3f(uniform(sssProg, "uLightColor"), 1, 1, 1);
    gl.uniform3f(uniform(sssProg, "uCameraPos"), 0, 0, 4.2);
    gl.uniform1i(uniform(sssProg, "uDebugMode"), state.debug);

    gl.uniform3fv(uniform(sssProg, "uSurfaceColor"), mc.surfaceColor);
    gl.uniform3fv(uniform(sssProg, "uScatterColor"), mc.scatterColor);
    gl.uniform1f(uniform(sssProg, "uCurvatureScale"), mc.curvatureScale);
    gl.uniform1f(uniform(sssProg, "uDensity"), mc.density);
    gl.uniform1f(uniform(sssProg, "uWrap"), mc.wrap);
    gl.uniform1f(uniform(sssProg, "uScatterStrength"), mc.scatterStrength);
    gl.uniform1f(uniform(sssProg, "uAnisotropy"), mc.anisotropy);
    gl.uniform1f(uniform(sssProg, "uScatterPower"), mc.scatterPower);
    gl.uniform1f(uniform(sssProg, "uThicknessScale"), mc.thicknessScale);
    gl.uniform1f(uniform(sssProg, "uSssGain"), 1.8);
    gl.uniform1f(uniform(sssProg, "uSpecular"), mc.specular);
    gl.uniform1f(uniform(sssProg, "uShininess"), mc.shininess);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindVertexArray(mesh.vao);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.02, 0.02, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.CULL_FACE);
  }

  function frame() {
    resize();
    const mc = MATERIALS[state.material];
    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = mat4Perspective(Math.PI / 4, aspect, 0.1, 100);
    const view = mat4LookAt([0, 0, 4.2], [0, 0, 0], [0, 1, 0]);
    const rot = mat4Multiply(mat4RotateY(state.rotY), mat4RotateX(state.rotX));
    const model = mat4Multiply(rot,
      mat4Scale(mc.scale[0], mc.scale[1], mc.scale[2]));

    gl.viewport(0, 0, size, size);
    runPrep(model, view, proj);
    runSss(mc, model, view, proj);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function setActive(ids, chosen) {
  ids.forEach((id) =>
    document.getElementById(id).classList.toggle("active", id === chosen));
}

function bindToggle(id, apply) {
  document.getElementById(id).addEventListener("click", apply);
}

function setupUI() {
  const matButtons = ["mat-jade", "mat-skin"];
  bindToggle("mat-jade", () => {
    state.material = "jade"; setActive(matButtons, "mat-jade"); syncSliders();
  });
  bindToggle("mat-skin", () => {
    state.material = "skin"; setActive(matButtons, "mat-skin"); syncSliders();
  });

  const lightButtons = ["light-front", "light-back", "light-side"];
  bindToggle("light-front", () => {
    state.light = "front"; setActive(lightButtons, "light-front");
  });
  bindToggle("light-back", () => {
    state.light = "back"; setActive(lightButtons, "light-back");
  });
  bindToggle("light-side", () => {
    state.light = "side"; setActive(lightButtons, "light-side");
  });

  const dbgButtons = [0, 1, 2, 3, 4, 5].map((n) => `dbg-${n}`);
  dbgButtons.forEach((id, n) =>
    bindToggle(id, () => { state.debug = n; setActive(dbgButtons, id); }));

  const sliders = [
    ["p-strength", "v-strength", "scatterStrength"],
    ["p-density", "v-density", "density"],
    ["p-wrap", "v-wrap", "wrap"],
    ["p-power", "v-power", "scatterPower"],
  ];
  sliders.forEach(([pid, vid, key]) => {
    const input = document.getElementById(pid);
    input.addEventListener("input", () => {
      MATERIALS[state.material][key] = parseFloat(input.value);
      document.getElementById(vid).textContent =
        MATERIALS[state.material][key].toFixed(2);
    });
  });

  function syncSliders() {
    const mc = MATERIALS[state.material];
    const map = {
      "p-strength": ["v-strength", mc.scatterStrength],
      "p-density": ["v-density", mc.density],
      "p-wrap": ["v-wrap", mc.wrap],
      "p-power": ["v-power", mc.scatterPower],
    };
    Object.entries(map).forEach(([pid, [vid, val]]) => {
      document.getElementById(pid).value = val;
      document.getElementById(vid).textContent = val.toFixed(2);
    });
    const surf = mc.surfaceColor.map((c) =>
      Math.round(c * 255).toString(16).padStart(2, "0")).join("");
    const scat = mc.scatterColor.map((c) =>
      Math.round(Math.min(1, c) * 255).toString(16).padStart(2, "0")).join("");
    document.getElementById("sw-surface").style.background = `#${surf}`;
    document.getElementById("sw-scatter").style.background = `#${scat}`;
  }
  syncSliders();

  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => { dragging = false; });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    state.rotY += (e.clientX - lastX) * 0.01;
    state.rotX += (e.clientY - lastY) * 0.01;
    state.rotX = Math.max(-1.2, Math.min(1.2, state.rotX));
    lastX = e.clientX; lastY = e.clientY;
  });
}

setupUI();
main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML("beforeend",
    `<pre style='color:#f88;padding:24px'>${err.message}</pre>`);
});
