// 3-cascade CSM demo (WebGL2). Entry point loaded by index.html.
import { v3, m4 } from './math.js';
import { computeCSM, cascadeStats, DEFAULT_CONFIG } from './csm.js';
import { DEPTH_VS, DEPTH_FS, MAIN_VS, MAIN_FS } from './shaders.js';

const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2', { antialias: true });
if (!gl) {
  document.getElementById('hud').textContent = 'WebGL2 not available';
  throw new Error('WebGL2 not available');
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  }
  return s;
}

function link(vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

const depthProg = link(DEPTH_VS, DEPTH_FS);
const mainProg = link(MAIN_VS, MAIN_FS);

const U = {
  depth: {
    lightVP: gl.getUniformLocation(depthProg, 'uLightVP'),
    model: gl.getUniformLocation(depthProg, 'uModel'),
  },
  main: {
    proj: gl.getUniformLocation(mainProg, 'uProj'),
    view: gl.getUniformLocation(mainProg, 'uView'),
    model: gl.getUniformLocation(mainProg, 'uModel'),
    lightVP: gl.getUniformLocation(mainProg, 'uLightVP'),
    shadowMap: gl.getUniformLocation(mainProg, 'uShadowMap'),
    splits: gl.getUniformLocation(mainProg, 'uSplits'),
    lightDir: gl.getUniformLocation(mainProg, 'uLightDir'),
    camPos: gl.getUniformLocation(mainProg, 'uCamPos'),
    baseColor: gl.getUniformLocation(mainProg, 'uBaseColor'),
    blendBand: gl.getUniformLocation(mainProg, 'uBlendBand'),
    mapRes: gl.getUniformLocation(mainProg, 'uMapRes'),
    depthRange: gl.getUniformLocation(mainProg, 'uDepthRange'),
    debugMode: gl.getUniformLocation(mainProg, 'uDebugMode'),
  },
};

// ---- geometry ------------------------------------------------------------
function makeCube() {
  // 24 verts (per-face normals), 36 indices
  const p = [];
  const n = [];
  const idx = [];
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  let base = 0;
  for (const [normal, verts] of faces) {
    for (const v of verts) { p.push(...v); n.push(...normal); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  }
  return { positions: p, normals: n, indices: idx };
}

function makePlane(size) {
  const h = size / 2;
  return {
    positions: [-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    indices: [0, 2, 1, 0, 3, 2], // wound so the face normal is +Y
  };
}

function uploadMesh(mesh) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const pb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const nb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.normals), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: mesh.indices.length };
}

const cubeMesh = uploadMesh(makeCube());
const planeMesh = uploadMesh(makePlane(1)); // scaled per-object

// ---- scene ---------------------------------------------------------------
// Ground plane + a field of boxes/pillars spread along Z so shadows cross
// both cascade boundaries.
const objects = [];
objects.push({ mesh: planeMesh, scale: [600, 1, 600], pos: [0, 0, -80], color: [0.55, 0.58, 0.5] });
let rngState = 42;
const rand = () => (rngState = (rngState * 1664525 + 1013904223) >>> 0) / 2 ** 32;
for (let gx = -4; gx <= 4; gx++) {
  for (let gz = -12; gz <= 3; gz++) {
    if (rand() < 0.35) continue;
    const h = 1 + rand() * 5;
    const w = 1.5 + rand() * 2;
    objects.push({
      mesh: cubeMesh,
      scale: [w / 2, h / 2, w / 2],
      pos: [gx * 9 + (rand() - 0.5) * 3, h / 2, gz * 10 + (rand() - 0.5) * 3],
      color: [0.45 + rand() * 0.4, 0.4 + rand() * 0.35, 0.35 + rand() * 0.3],
    });
  }
}
// Tall pillars that cast long shadows across cascade boundaries.
for (const [x, z, h] of [[-6, -25, 10], [8, -45, 14], [-14, -70, 12], [4, -95, 16], [16, -20, 8]]) {
  objects.push({ mesh: cubeMesh, scale: [1.2, h / 2, 1.2], pos: [x, h / 2, z], color: [0.7, 0.65, 0.55] });
}

function modelMatrix(o) {
  return [
    o.scale[0], 0, 0, 0,
    0, o.scale[1], 0, 0,
    0, 0, o.scale[2], 0,
    o.pos[0], o.pos[1], o.pos[2], 1,
  ];
}

// ---- shadow map resources (one depth texture per cascade) -----------------
const CFG = { ...DEFAULT_CONFIG };
const shadowMaps = CFG.resolutions.map((res) => {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, res, res, 0,
    gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, res };
});

// ---- camera + light --------------------------------------------------------
const LIGHT_DIR = v3.normalize([0.45, -0.8, 0.4]);
const camera = {
  position: [0, 14, 26],
  yaw: Math.PI,          // look toward -Z
  pitch: -0.32,
  fovY: Math.PI / 3.2,
  near: 0.5,
  far: 220,
  forward() {
    const cp = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp];
  },
};

let debugMode = 0; // 0=off 1=cascade tint 2=blend band highlight
let autoSweep = false;

function camParams() {
  return {
    position: camera.position,
    forward: camera.forward(),
    up: [0, 1, 0],
    fovY: camera.fovY,
    aspect: canvas.width / canvas.height,
    near: camera.near,
    far: camera.far,
  };
}

// ---- render ----------------------------------------------------------------
function render() {
  const cam = camParams();
  const csm = computeCSM(cam, LIGHT_DIR, CFG);

  // 1) depth passes
  gl.useProgram(depthProg);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT); // reduce peter-panning / acne
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(2, 4);
  for (let i = 0; i < 3; i++) {
    const sm = shadowMaps[i];
    gl.bindFramebuffer(gl.FRAMEBUFFER, sm.fbo);
    gl.viewport(0, 0, sm.res, sm.res);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(U.depth.lightVP, false, csm.cascades[i].lightViewProj);
    for (const o of objects) {
      gl.uniformMatrix4fv(U.depth.model, false, modelMatrix(o));
      gl.bindVertexArray(o.mesh.vao);
      gl.drawElements(gl.TRIANGLES, o.mesh.count, gl.UNSIGNED_SHORT, 0);
    }
  }
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.cullFace(gl.BACK);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // 2) main pass
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.35, 0.45, 0.6, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(mainProg);
  const proj = m4.perspective(cam.fovY, cam.aspect, cam.near, cam.far);
  const view = m4.lookAt(cam.position, v3.add(cam.position, cam.forward), [0, 1, 0]);
  gl.uniformMatrix4fv(U.main.proj, false, proj);
  gl.uniformMatrix4fv(U.main.view, false, view);
  gl.uniformMatrix4fv(U.main.lightVP, false, csm.cascades.flatMap(c => c.lightViewProj));
  gl.uniform4f(U.main.splits, csm.splits[1], csm.splits[2], csm.splits[3], 0);
  gl.uniform3fv(U.main.lightDir, LIGHT_DIR);
  gl.uniform3fv(U.main.camPos, cam.position);
  gl.uniform1f(U.main.blendBand, CFG.blendBand);
  gl.uniform1fv(U.main.mapRes, csm.cascades.map(c => c.resolution));
  gl.uniform1fv(U.main.depthRange, csm.cascades.map(c => c.depthRange.far - c.depthRange.near));
  gl.uniform1i(U.main.debugMode, debugMode);
  for (let i = 0; i < 3; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, shadowMaps[i].tex);
  }
  gl.uniform1iv(U.main.shadowMap, [0, 1, 2]);
  for (const o of objects) {
    gl.uniformMatrix4fv(U.main.model, false, modelMatrix(o));
    gl.uniform3fv(U.main.baseColor, o.color);
    gl.bindVertexArray(o.mesh.vao);
    gl.drawElements(gl.TRIANGLES, o.mesh.count, gl.UNSIGNED_SHORT, 0);
  }
  gl.bindVertexArray(null);
  return csm;
}

// ---- HUD + stats output ----------------------------------------------------
const hud = document.getElementById('hud');
const fmt = (x, d = 1) => x.toFixed(d);

function statsLines(csm) {
  const stats = cascadeStats(csm);
  const lines = stats.map(s =>
    `C${s.cascade} | cover ${fmt(s.rangeStart)}-${fmt(s.rangeEnd)} m (span ${fmt(s.coverage)}) | ` +
    `${s.resolution}px | world ${fmt(s.worldDiameter)} m | ` +
    `${fmt(s.texelDensity, 2)} texel/m | depth ${fmt(s.depthNear)}..${fmt(s.depthFar)}`);
  return lines;
}

let lastLog = 0;
function updateHUD(csm, now) {
  const camDist = v3.length(camera.position);
  const lines = [
    `cam (${fmt(camera.position[0])}, ${fmt(camera.position[1])}, ${fmt(camera.position[2])}) ` +
    `yaw ${fmt(camera.yaw, 2)} pitch ${fmt(camera.pitch, 2)} | origin dist ${fmt(camDist)}`,
    `splits (view depth): ${csm.splits.map(s => fmt(s)).join(' / ')} m`,
    ...statsLines(csm),
    `debug [D]: ${['off', 'cascade tint', 'blend band'][debugMode]} | auto-sweep [T]: ${autoSweep ? 'on' : 'off'}`,
  ];
  hud.textContent = lines.join('\n');
  if (now - lastLog > 2000) {
    lastLog = now;
    console.log('[CSM] splits:', csm.splits.map(s => fmt(s)).join(' / '));
    console.table(cascadeStats(csm).map(s => ({
      cascade: s.cascade,
      'cover start (m)': +fmt(s.rangeStart),
      'cover end (m)': +fmt(s.rangeEnd),
      'span (m)': +fmt(s.coverage),
      'res (px)': s.resolution,
      'world diam (m)': +fmt(s.worldDiameter),
      'texel density (texel/m)': +fmt(s.texelDensity, 3),
      'm/texel': +fmt(s.worldUnitsPerTexel, 4),
    })));
  }
}

// ---- input -----------------------------------------------------------------
const keys = new Set();
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'd') debugMode = (debugMode + 1) % 3;
  if (k === 't') autoSweep = !autoSweep;
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let dragging = false;
canvas.addEventListener('mousedown', () => (dragging = true));
addEventListener('mouseup', () => (dragging = false));
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  camera.yaw -= e.movementX * 0.003;
  camera.pitch = Math.max(-1.5, Math.min(1.5, camera.pitch - e.movementY * 0.003));
});

function stepCamera(dt, t) {
  if (autoSweep) {
    // Glide back and forth along Z, crossing both cascade boundaries so the
    // seam handling can be inspected live. Shadows must not pop or vanish.
    const z = 30 + 55 * Math.sin(t * 0.35);
    camera.position = [0, 12, z];
    camera.yaw = Math.PI;
    camera.pitch = -0.3;
    return;
  }
  const speed = (keys.has('shift') ? 40 : 12) * dt;
  const fwd = camera.forward();
  const right = v3.normalize(v3.cross(fwd, [0, 1, 0]));
  if (keys.has('w')) camera.position = v3.add(camera.position, v3.scale(fwd, speed));
  if (keys.has('s')) camera.position = v3.add(camera.position, v3.scale(fwd, -speed));
  if (keys.has('a')) camera.position = v3.add(camera.position, v3.scale(right, -speed));
  if (keys.has('d')) camera.position = v3.add(camera.position, v3.scale(right, speed));
  if (keys.has('q')) camera.position[1] -= speed;
  if (keys.has('e')) camera.position[1] += speed;
}

// ---- main loop ---------------------------------------------------------------
function resize() {
  const w = canvas.clientWidth * devicePixelRatio;
  const h = canvas.clientHeight * devicePixelRatio;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  resize();
  stepCamera(dt, now / 1000);
  const csm = render();
  updateHUD(csm, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- automated verification hooks ------------------------------------------
window.__csm = {
  setCamera(pos, yaw, pitch) {
    autoSweep = false;
    camera.position = [...pos];
    camera.yaw = yaw;
    camera.pitch = pitch;
  },
  stats() {
    const csm = computeCSM(camParams(), LIGHT_DIR, CFG);
    return { splits: csm.splits, cascades: cascadeStats(csm) };
  },
  // Render at the current camera and return the RGBA framebuffer.
  snapshot() {
    render();
    const w = canvas.width, h = canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { width: w, height: h, pixels: Array.from(px) };
  },
  // Mean absolute pixel difference between two camera states (shadow pop test).
  compare(camA, camB) {
    const grab = (c) => {
      this.setCamera(c.pos, c.yaw, c.pitch);
      render();
      const w = canvas.width, h = canvas.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const a = grab(camA);
    const b = grab(camB);
    let sum = 0, max = 0, changed = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      sum += d;
      if (d > max) max = d;
      if (d > 24) changed++;
    }
    return { meanAbsDiff: sum / a.length, maxDiff: max, changedPixels: changed, total: a.length };
  },
};
