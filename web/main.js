// Rock Strata Material Lab — WebGL2 front-end for the WASM generator.
// All five maps come from one WASM memory snapshot, so they can never drift
// apart; textures use REPEAT + trilinear mipmaps + anisotropy, so raising the
// tile count or moving away automatically drops to lower-detail mip levels
// instead of blurring a single image.

const TEX_SIZE = 512;

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aTangent;
layout(location=3) in vec2 aUV;
uniform mat4 uProj, uView, uModel;
uniform float uTiles;
out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vTangent;
out vec2 vUV;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = mat3(uModel) * aNormal;
  vTangent = mat3(uModel) * aTangent;
  vUV = aUV * uTiles;
  gl_Position = uProj * uView * wp;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vTangent;
in vec2 vUV;
uniform sampler2D uAlbedo, uRough, uNormal, uHeight, uPore;
uniform vec3 uLightDir;   // direction TO the light
uniform vec3 uCamPos;
uniform int uChannel;     // 0 shaded 1 albedo 2 rough 3 normal 4 height 5 pore 6 mip debug
uniform float uNormalStrength;
out vec4 fragColor;

vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 lin2srgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

vec3 mipColor(float lod) {
  vec3 c0 = vec3(0.15, 0.45, 0.95), c1 = vec3(0.1, 0.8, 0.3),
       c2 = vec3(0.95, 0.8, 0.1), c3 = vec3(0.95, 0.35, 0.1),
       c4 = vec3(0.9, 0.1, 0.4);
  float t = clamp(lod, 0.0, 4.0);
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  return mix(c3, c4, t - 3.0);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 T = normalize(vTangent - N * dot(N, vTangent));
  vec3 B = cross(N, T);
  vec3 nt = texture(uNormal, vUV).xyz * 2.0 - 1.0;
  nt.xy *= uNormalStrength;
  vec3 n = normalize(T * nt.x + B * nt.y + N * nt.z);

  vec3 albedo = srgb2lin(texture(uAlbedo, vUV).rgb);
  float rough = texture(uRough, vUV).r;
  float pore = texture(uPore, vUV).r;

  if (uChannel == 1) { fragColor = vec4(albedo, 1.0); return; }
  if (uChannel == 2) { fragColor = vec4(lin2srgb(vec3(rough)), 1.0); return; }
  if (uChannel == 3) { fragColor = vec4(n * 0.5 + 0.5, 1.0); return; }
  if (uChannel == 4) { fragColor = vec4(lin2srgb(texture(uHeight, vUV).rrr), 1.0); return; }
  if (uChannel == 5) { fragColor = vec4(lin2srgb(vec3(pore)), 1.0); return; }
  if (uChannel == 6) {
    // Manual LOD estimate (WebGL2 lacks textureQueryLod without an ext):
    // rho = max footprint of one pixel in texel space.
    vec2 gx = dFdx(vUV), gy = dFdy(vUV);
    float rho = max(length(gx), length(gy)) * 512.0;
    float lod = rho > 1.0 ? log2(rho) : 0.0;
    fragColor = vec4(mipColor(lod), 1.0); return;
  }

  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  float ndl = max(dot(n, L), 0.0);
  float ao = 1.0 - 0.35 * pore;              // pores trap light
  vec3 ambient = albedo * 0.18 * ao;
  vec3 diffuse = albedo * ndl * ao;
  float specPow = mix(96.0, 6.0, rough);
  float specAmt = mix(0.5, 0.08, rough);
  vec3 spec = vec3(specAmt) * pow(max(dot(n, H), 0.0), specPow) * ndl;
  fragColor = vec4(lin2srgb(ambient + diffuse + spec), 1.0);
}`;

function makeSphere(cols = 128, rows = 96) {
  const pos = [], nrm = [], tan = [], uv = [], idx = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows, phi = v * Math.PI;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols, theta = u * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      pos.push(x, y, z); nrm.push(x, y, z);
      tan.push(-Math.sin(theta), 0, Math.cos(theta));
      uv.push(u, v);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + cols + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { pos, nrm, tan, uv, idx };
}

function makePlane(size = 2.6, seg = 64) {
  const pos = [], nrm = [], tan = [], uv = [], idx = [];
  for (let r = 0; r <= seg; r++) {
    for (let c = 0; c <= seg; c++) {
      const u = c / seg, v = r / seg;
      pos.push((u - 0.5) * size, 0, (v - 0.5) * size);
      nrm.push(0, 1, 0); tan.push(1, 0, 0); uv.push(u, v);
    }
  }
  for (let r = 0; r < seg; r++) {
    for (let c = 0; c < seg; c++) {
      const a = r * (seg + 1) + c, b = a + seg + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  return { pos, nrm, tan, uv, idx };
}

// ---------- tiny mat4 ----------
const M4 = {
  perspective(fov, asp, near, far) {
    const f = 1 / Math.tan(fov / 2), d = 1 / (near - far);
    return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * d, -1, 0, 0, 2 * far * near * d, 0];
  },
  lookAt(eye, at, up) {
    const z = norm3(sub3(eye, at)), x = norm3(cross3(up, z)), y = cross3(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1];
  },
  rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  },
  ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
};
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm3(a) { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// ---------- GL boot ----------
const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2', { antialias: true });
const statusEl = document.getElementById('status');
if (!gl) { statusEl.textContent = 'WebGL2 不可用'; throw new Error('no webgl2'); }

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const U = {};
for (const name of ['uProj', 'uView', 'uModel', 'uTiles', 'uLightDir', 'uCamPos',
  'uChannel', 'uNormalStrength', 'uAlbedo', 'uRough', 'uNormal', 'uHeight', 'uPore'])
  U[name] = gl.getUniformLocation(prog, name);

const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
const maxAniso = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;

function makeMesh(geom) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = (loc, data, n) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
  };
  buf(0, geom.pos, 3); buf(1, geom.nrm, 3); buf(2, geom.tan, 3); buf(3, geom.uv, 2);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(geom.idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: geom.idx.length };
}
const sphereMesh = makeMesh(makeSphere());
const planeMesh = makeMesh(makePlane());

// ---------- WASM ----------
let wasm = null;
const MAPS = [
  ['albedo', 'getAlbedoPtr', 'uAlbedo'],
  ['roughness', 'getRoughnessPtr', 'uRough'],
  ['normal', 'getNormalPtr', 'uNormal'],
  ['height', 'getHeightPtr', 'uHeight'],
  ['porosity', 'getPorosityPtr', 'uPore'],
];
const textures = {};

async function loadWasm() {
  let resp = await fetch('./rockgen.wasm').catch(() => null);
  if (!resp || !resp.ok) resp = await fetch('../dist/rockgen.wasm');
  const bytes = await resp.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (m, f, l, c) => { throw new Error(`wasm abort ${l}:${c}`); } },
  });
  wasm = instance.exports;
}

function uploadMaps(seed) {
  wasm.generate(seed, TEX_SIZE);
  const mem = new Uint8Array(wasm.memory.buffer);
  for (const [name, getter] of MAPS) {
    const ptr = wasm[getter]();
    const pixels = mem.slice(ptr, ptr + TEX_SIZE * TEX_SIZE * 4);
    if (!textures[name]) textures[name] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textures[name]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_SIZE, TEX_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (anisoExt) gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
  }
}

// ---------- UI state ----------
const ui = {
  seedPreset: document.getElementById('seedPreset'),
  seedNum: document.getElementById('seedNum'),
  tiles: document.getElementById('tiles'),
  channel: document.getElementById('channel'),
  geom: document.getElementById('geom'),
  lightAz: document.getElementById('lightAz'),
  lightEl: document.getElementById('lightEl'),
  nstr: document.getElementById('nstr'),
};
const state = { yaw: 0.6, pitch: 0.35, dist: 3.4, tiles: 3 };

function currentSeed() { return parseInt(ui.seedNum.value, 10) || 0; }

function bindRange(el, outId, fmt, cb) {
  const out = document.getElementById(outId);
  const update = () => { out.textContent = fmt(el.value); cb && cb(); };
  el.addEventListener('input', update); update();
}
bindRange(ui.tiles, 'tilesOut', v => v, () => { state.tiles = +ui.tiles.value; });
bindRange(ui.lightAz, 'lightAzOut', v => v + '°');
bindRange(ui.lightEl, 'lightElOut', v => v + '°');
bindRange(ui.nstr, 'nstrOut', v => (+v).toFixed(1));
state.tiles = +ui.tiles.value;

ui.seedPreset.addEventListener('change', () => {
  if (ui.seedPreset.value !== 'custom') ui.seedNum.value = ui.seedPreset.value;
  regenerate();
});
ui.seedNum.addEventListener('change', () => { ui.seedPreset.value = 'custom'; regenerate(); });
document.getElementById('regen').addEventListener('click', regenerate);

function regenerate() {
  uploadMaps(currentSeed());
  statusEl.textContent = `seed ${currentSeedLabel()} 已生成 · 各向异性 ${anisoExt ? Math.min(8, maxAniso) + 'x' : '不可用'} · mip 链 10 级`;
}
function currentSeedLabel() { return currentSeed(); }

// ---------- export ----------
function downloadPNG(name, rgba, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  c.toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

function exportSeed(seed) {
  wasm.generate(seed, TEX_SIZE);
  const mem = new Uint8Array(wasm.memory.buffer);
  for (const [name, getter] of MAPS) {
    const ptr = wasm[getter]();
    downloadPNG(`seed${seed}_${name}.png`, mem.slice(ptr, ptr + TEX_SIZE * TEX_SIZE * 4), TEX_SIZE);
  }
  uploadMaps(currentSeed()); // restore the on-screen seed
}
document.getElementById('exportSeed').addEventListener('click', () => exportSeed(currentSeed()));
document.getElementById('exportBoth').addEventListener('click', () => {
  exportSeed(1234);
  setTimeout(() => exportSeed(9876), 400);
});

// ---------- camera ----------
let dragging = false, px = 0, py = 0;
canvas.addEventListener('pointerdown', e => { dragging = true; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  state.yaw += (e.clientX - px) * 0.008;
  state.pitch = Math.min(1.5, Math.max(-1.5, state.pitch + (e.clientY - py) * 0.008));
  px = e.clientX; py = e.clientY;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  state.dist = Math.min(12, Math.max(1.6, state.dist * (1 + Math.sign(e.deltaY) * 0.1)));
}, { passive: false });

// ---------- render loop ----------
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
}
window.addEventListener('resize', resize);

function drawMesh(mesh, model) {
  gl.uniformMatrix4fv(U.uModel, false, model);
  gl.bindVertexArray(mesh.vao);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
}

function frame() {
  resize();
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.06, 0.07, 0.09, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(prog);

  const eye = [
    state.dist * Math.cos(state.pitch) * Math.sin(state.yaw),
    state.dist * Math.sin(state.pitch),
    state.dist * Math.cos(state.pitch) * Math.cos(state.yaw),
  ];
  const proj = M4.perspective(0.8, canvas.width / canvas.height, 0.05, 100);
  const view = M4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
  gl.uniformMatrix4fv(U.uProj, false, proj);
  gl.uniformMatrix4fv(U.uView, false, view);
  gl.uniform3fv(U.uCamPos, eye);
  gl.uniform1f(U.uTiles, state.tiles);
  gl.uniform1i(U.uChannel, +ui.channel.value);
  gl.uniform1f(U.uNormalStrength, +ui.nstr.value);

  const az = +ui.lightAz.value * Math.PI / 180, el = +ui.lightEl.value * Math.PI / 180;
  gl.uniform3fv(U.uLightDir, [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]);

  let unit = 0;
  for (const [name, , uname] of MAPS) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures[name]);
    gl.uniform1i(U[uname], unit);
    unit++;
  }

  const mode = ui.geom.value;
  const draw = (mesh, x0, w) => {
    gl.viewport(x0, 0, w, canvas.height);
    const asp = w / canvas.height;
    gl.uniformMatrix4fv(U.uProj, false, M4.perspective(0.8, asp, 0.05, 100));
    drawMesh(mesh, M4.rotY(performance.now() * 0.0001));
  };
  if (mode === 'sphere') draw(sphereMesh, 0, canvas.width);
  else if (mode === 'plane') draw(planeMesh, 0, canvas.width);
  else {
    gl.enable(gl.SCISSOR_TEST);
    const half = canvas.width >> 1;
    gl.scissor(0, 0, half, canvas.height);
    draw(sphereMesh, 0, half);
    gl.scissor(half, 0, canvas.width - half, canvas.height);
    draw(planeMesh, half, canvas.width - half);
    gl.disable(gl.SCISSOR_TEST);
  }
  requestAnimationFrame(frame);
}

await loadWasm();
regenerate();
requestAnimationFrame(frame);
