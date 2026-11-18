// ANISO/LAB — 主逻辑:渲染循环、UI、诊断读数
"use strict";

const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
if (!gl) { document.body.innerHTML = "<p style='padding:40px'>需要 WebGL2 支持</p>"; throw new Error("no webgl2"); }

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT_SRC));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG_SRC));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

const U = {};
for (const n of ["uRes","uTime","uRough","uAniso","uRoll","uAzimuth","uSingleLobe","uDebugTangent"])
  U[n] = gl.getUniformLocation(prog, n);

// ---- 状态(支持 URL 参数,便于无头截图) ----
const q = new URLSearchParams(location.search);
const state = {
  rough: parseFloat(q.get("rough") ?? "0.22"),
  aniso: parseFloat(q.get("aniso") ?? "0.62"),
  roll: parseFloat(q.get("roll") ?? "0"),
  azimuth: parseFloat(q.get("az") ?? "28"),
  singleLobe: q.get("lobe") !== "off",
  debugTangent: q.get("view") === "tangent",
  auto: q.get("auto") === "1",
};

const $ = (id) => document.getElementById(id);
const els = {
  rough: $("rough"), aniso: $("aniso"), roll: $("roll"), azimuth: $("azimuth"),
  vRough: $("vRough"), vAniso: $("vAniso"), vRoll: $("vRoll"), vAz: $("vAz"),
  singleLobe: $("singleLobe"), lobeBadge: $("lobeBadge"),
  viewLit: $("viewLit"), viewTangent: $("viewTangent"),
  autoOrbit: $("autoOrbit"), orbitReset: $("orbitReset"),
  fps: $("fps"), caption: $("stageCaption"), dbgMode: $("dbgMode"), dbgNote: $("dbgNote"),
  lobeRatio: $("lobeRatio"), consistency: $("consistency"), checks: $("checks"),
};

function syncUI() {
  els.rough.value = state.rough; els.aniso.value = state.aniso;
  els.roll.value = state.roll; els.azimuth.value = state.azimuth;
  els.vRough.textContent = state.rough.toFixed(2);
  els.vAniso.textContent = state.aniso.toFixed(2);
  els.vRoll.textContent = `${Math.round(state.roll)}°`;
  els.vAz.textContent = `${Math.round(state.azimuth)}°`;
  els.singleLobe.checked = state.singleLobe;
  els.lobeBadge.textContent = state.singleLobe ? "PASS" : "WARN";
  els.lobeBadge.classList.toggle("ok", state.singleLobe);
  els.viewLit.classList.toggle("active", !state.debugTangent);
  els.viewTangent.classList.toggle("active", state.debugTangent);
  els.autoOrbit.classList.toggle("on", state.auto);
  els.autoOrbit.textContent = state.auto ? "⏸ 自动旋转" : "▶ 自动旋转";
  els.dbgMode.textContent = state.debugTangent ? "TANGENT" : "LIGHTING";
  els.dbgNote.textContent = state.debugTangent
    ? "当前显示世界空间切线 T 的 RGB 编码:红/绿/蓝分量对应 +X/+Y/+Z。旋转样品时颜色与高光长轴应同步转动。"
    : "当前为光照视图。切换“切线调试”查看世界空间切线方向的 RGB 编码。";
  els.caption.textContent = state.debugTangent
    ? `WORLD-SPACE TANGENT · RGB = (T × 0.5 + 0.5) · SOURCE ORBIT ${Math.round(state.azimuth)}°`
    : `PUNCTUAL LIGHT · SINGLE ANISOTROPIC LOBE · SOURCE ORBIT ${Math.round(state.azimuth)}°`;
}

function bind() {
  els.rough.oninput = () => { state.rough = +els.rough.value; syncUI(); };
  els.aniso.oninput = () => { state.aniso = +els.aniso.value; syncUI(); };
  els.roll.oninput = () => { state.roll = +els.roll.value; syncUI(); };
  els.azimuth.oninput = () => { state.azimuth = +els.azimuth.value; state.auto = false; syncUI(); };
  els.singleLobe.onchange = () => { state.singleLobe = els.singleLobe.checked; syncUI(); };
  els.viewLit.onclick = () => { state.debugTangent = false; syncUI(); };
  els.viewTangent.onclick = () => { state.debugTangent = true; syncUI(); };
  els.autoOrbit.onclick = () => { state.auto = !state.auto; syncUI(); };
  els.orbitReset.onclick = () => { state.azimuth = 28; state.auto = false; syncUI(); };
  document.querySelectorAll("[data-roll]").forEach((b) => {
    b.onclick = () => {
      const d = b.dataset.roll;
      state.roll = d === "0" ? 0 : (state.roll + parseFloat(d) + 360) % 360;
      syncUI();
    };
  });
}

// ---- 诊断:JS 复算 BRDF,与着色器同一套数学 ----
const V3 = {
  add: (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]],
  sub: (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]],
  scale: (a, s) => [a[0]*s, a[1]*s, a[2]*s],
  dot: (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2],
  cross: (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
  norm: (a) => { const l = Math.hypot(...a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; },
};
const CAM = [0, 0.35, 5.8];
const SPHERES = [
  { c: [-1.18, 0, 0], axis: [1, 0, 0] },  // H 水平拉丝
  { c: [ 1.18, 0, 0], axis: [0, 1, 0] },  // V 垂直拉丝
];
function rotZv(v, deg) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c*v[0] - s*v[1], s*v[0] + c*v[1], v[2]];
}
function frameFor(sphere) {
  const Tw = rotZv(sphere.axis, state.roll);
  return (N) => {
    const T = V3.norm(V3.sub(Tw, V3.scale(N, V3.dot(N, Tw))));
    return { T, B: V3.norm(V3.cross(N, T)) };
  };
}
function alphas() {
  const a = Math.max(state.rough * state.rough, 1e-3);
  return { a, at: Math.max(a * (1 + state.aniso), 1e-3), ab: Math.max(a * (1 - state.aniso), 1e-3) };
}
function specIntensity(N, P, L, T, B, at, ab) {
  const V = V3.norm(V3.sub(CAM, P));
  const H = V3.norm(V3.add(V, L));
  const NoL = Math.max(V3.dot(N, L), 0), NoV = Math.max(V3.dot(N, V), 1e-4);
  if (NoL <= 0) return 0;
  const th = V3.dot(H, T) / at, bh = V3.dot(H, B) / ab, nh = V3.dot(H, N);
  const dd = th*th + bh*bh + nh*nh;
  const D = 1 / (Math.PI * at * ab * dd * dd);
  const lam = (v) => {
    const vt = V3.dot(v, T)*at, vb = V3.dot(v, B)*ab, vn = V3.dot(v, N);
    return 0.5 * (-1 + Math.sqrt(1 + (vt*vt + vb*vb) / Math.max(vn*vn, 1e-7)));
  };
  const G2 = 1 / (1 + lam(V) + lam(L));
  return (D * G2 / (4 * NoV)) * NoL;
}
// 在朝向相机的半球上粗搜高光中心
function findHighlight(sphere, L) {
  const mkFrame = frameFor(sphere);
  const { at, ab } = alphas();
  let best = { I: -1, N: null, P: null };
  for (let i = 0; i <= 48; i++) for (let j = 0; j <= 96; j++) {
    const th = (i / 48) * Math.PI, ph = (j / 96) * Math.PI * 2;
    const N = [Math.sin(th)*Math.cos(ph), Math.sin(th)*Math.sin(ph), Math.cos(th)];
    const P = V3.add(sphere.c, N);
    if (V3.dot(N, V3.norm(V3.sub(CAM, P))) < 0.05) continue;
    const { T, B } = mkFrame(N);
    const I = specIntensity(N, P, L, T, B, at, ab);
    if (I > best.I) best = { I, N, P };
  }
  return best;
}

function lightPos(azDeg) {
  const az = (azDeg * Math.PI) / 180;
  return [Math.sin(az) * 3.6, 2.6, Math.cos(az) * 3.6];
}
// 高光斑块的屏幕空间方向:对强度分布求二阶矩主轴(相机无滚转,屏幕轴≈世界 XY)
function blobOrientation(sphere, hl, L) {
  const mkFrame = frameFor(sphere);
  const { at, ab } = alphas();
  const R = 0.28, STEPS = 13;
  const pts = [];
  let maxI = 1e-9;
  for (let i = -STEPS; i <= STEPS; i++) for (let j = -STEPS; j <= STEPS; j++) {
    const dx = (i / STEPS) * R, dy = (j / STEPS) * R;
    const N = V3.norm([hl.N[0] + dx, hl.N[1] + dy, hl.N[2]]);
    const P = V3.add(sphere.c, N);
    const { T, B } = mkFrame(N);
    const I = specIntensity(N, P, L, T, B, at, ab);
    pts.push({ dx, dy, I });
    if (I > maxI) maxI = I;
  }
  let sw = 0, mx = 0, my = 0;
  for (const p of pts) { p.w = Math.max(p.I - 0.35 * maxI, 0); sw += p.w; mx += p.w * p.dx; my += p.w * p.dy; }
  if (sw < 1e-9) return null;
  mx /= sw; my /= sw;
  let uxx = 0, uyy = 0, uxy = 0;
  for (const p of pts) {
    uxx += p.w * (p.dx - mx) ** 2; uyy += p.w * (p.dy - my) ** 2; uxy += p.w * (p.dx - mx) * (p.dy - my);
  }
  let ang = 0.5 * Math.atan2(2 * uxy, uxx - uyy) * 180 / Math.PI;
  ang = ((ang % 180) + 180) % 180;
  return { angle: ang, elong: Math.sqrt(Math.max(uxx, uyy) / Math.max(Math.min(uxx, uyy), 1e-12)) };
}
function updateDiagnostics() {
  const { at, ab } = alphas();
  const L = lightPos(state.azimuth);
  els.lobeRatio.textContent = `αT / αB = ${(at / ab).toFixed(2)}`;
  const ids = [["H", 0], ["V", 1]];
  const results = {};
  for (const [key, si] of ids) {
    const sp = SPHERES[si];
    const hl = findHighlight(sp, L);
    let peakPct = 0, dirDeg = 0;
    if (hl.N) {
      // 峰值:归一化到该球在光源轨道上的最优几何
      let maxI = 1e-9;
      for (let a = 0; a < 360; a += 15) {
        const h2 = findHighlight(sp, lightPos(a));
        if (h2.I > maxI) maxI = h2.I;
      }
      peakPct = Math.min(999, (hl.I / maxI) * 100);
      const blob = blobOrientation(sp, hl, L);
      if (blob) dirDeg = blob.angle;
    }
    results[key] = { hl, peakPct, dirDeg };
    $(`mRatio${key}`).textContent = `${(at / ab).toFixed(2)}×`;
    $(`mDir${key}`).textContent = `${dirDeg.toFixed(1)}°`;
    $(`mPeak${key}`).textContent = hl.N ? `${Math.round(peakPct)}%` : "–";
    drawSpark($(`spark${key}`), sp, hl, L);
  }
  drawLobePlot(at, ab);
  updateChecks(results);
}
function drawSpark(cv, sphere, hl, L) {
  const ctx = cv.getContext("2d");
  const W = cv.width, Hh = cv.height;
  ctx.clearRect(0, 0, W, Hh);
  ctx.strokeStyle = "#1d242e";
  for (let y = 8; y < Hh; y += 9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  if (!hl.N) return;
  const mkFrame = frameFor(sphere);
  const { at, ab } = alphas();
  // 沿过高光中心、垂直于高光长轴的弦采样 → 显示紧方向剖面
  const { T } = mkFrame(hl.N);
  const axis = Math.abs(T[1]) > 0.7 ? [1, 0, 0] : [0, 1, 0]; // 屏幕上垂直于拉伸方向
  let maxI = 1e-9; const vals = [];
  for (let x = 0; x < W; x++) {
    const s = (x / W - 0.5) * 1.6;
    const N = V3.norm(V3.add(hl.N, V3.scale(axis, s)));
    const P = V3.add(sphere.c, N);
    const f = mkFrame(N);
    const I = specIntensity(N, P, L, f.T, f.B, at, ab);
    vals.push(I); if (I > maxI) maxI = I;
  }
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "rgba(232,163,61,0)"); grad.addColorStop(0.5, "rgba(232,163,61,0.9)"); grad.addColorStop(1, "rgba(232,163,61,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.moveTo(0, Hh);
  vals.forEach((v, x) => ctx.lineTo(x, Hh - (v / maxI) * (Hh - 6)));
  ctx.lineTo(W, Hh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e8a33d";
  const peakX = vals.indexOf(Math.max(...vals));
  ctx.fillRect(peakX - 1, 2, 2, Hh - 4);
}

function drawLobePlot(at, ab) {
  const cv = els.lobePlot || $("lobePlot");
  const ctx = cv.getContext("2d");
  const W = cv.width, Hh = cv.height;
  ctx.clearRect(0, 0, W, Hh);
  ctx.strokeStyle = "#1d242e";
  for (let y = 0; y <= 4; y++) { ctx.beginPath(); ctx.moveTo(0, (y * Hh) / 4); ctx.lineTo(W, (y * Hh) / 4); ctx.stroke(); }
  const D = (dir) => {
    // h 在 N-dir 平面内摆动 ±75°
    const out = [];
    for (let x = 0; x < W; x++) {
      const th = ((x / W) - 0.5) * (Math.PI * 0.85);
      const h = [Math.sin(th) * dir[0], Math.sin(th) * dir[1], Math.cos(th)];
      const thh = h[0] / at, bhh = h[1] / ab, nh = h[2];
      const d = thh*thh + bhh*bhh + nh*nh;
      out.push(1 / (Math.PI * at * ab * d * d));
    }
    return out;
  };
  const plot = (vals, color) => {
    const mx = Math.max(...vals);
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
    vals.forEach((v, x) => {
      const y = Hh - 4 - (v / mx) * (Hh - 12);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  plot(D([1, 0, 0]), "#e8a33d");  // 沿切线 T:宽
  plot(D([0, 1, 0]), "#39c6a5");  // 垂直切线 B:窄
}
function updateChecks(results) {
  const items = [];
  items.push(["镜面项", state.singleLobe ? "单一各向异性瓣 ✓" : "各向异性+各向同性叠加 ⚠", state.singleLobe]);
  items.push(["普通粗糙度斑块", state.singleLobe ? "未叠加 ✓" : "已叠加 ⚠", state.singleLobe]);
  // 数值验证:高光处 T·N ≈ 0,|T| ≈ 1
  let orthoOk = true, dirOk = true;
  for (const key of ["H", "V"]) {
    const { hl, peakPct } = results[key];
    if (!hl.N) continue;
    const { T } = frameFor(SPHERES[key === "H" ? 0 : 1])(hl.N);
    if (Math.abs(V3.dot(T, hl.N)) > 1e-3 || Math.abs(V3.dot(T, T) - 1) > 1e-3) orthoOk = false;
    if (peakPct < 2) continue; // 高光转到背面时方向读数无意义,跳过
    const expect = key === "H" ? 0 : 90;
    const got = results[key].dirDeg;
    let diff = (got - state.roll - expect) % 180;
    if (diff > 90) diff -= 180;
    if (diff < -90) diff += 180;
    if (Math.abs(diff) > 6) dirOk = false;
  }
  items.push(["切线 / 副切线", orthoOk ? "正交归一 ✓" : "异常 ⚠", orthoOk]);
  items.push(["高光方向", dirOk ? "随 T 变化 ✓" : "偏离切线 ⚠", dirOk]);
  els.checks.innerHTML = items
    .map(([k, v, ok]) => `<li>${k}<b class="${ok ? "" : "warn"}">${v}</b></li>`)
    .join("");
  const allOk = items.every((i) => i[2]);
  els.consistency.textContent = allOk ? "PASS" : "WARN";
  els.consistency.classList.toggle("ok", allOk);
}

// ---- 渲染循环 ----
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}
let lastT = performance.now(), frames = 0, fpsT = lastT;
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  if (state.auto) {
    state.azimuth = (state.azimuth + dt * 18) % 360;
    syncUI();
  }
  resize();
  gl.uniform2f(U.uRes, canvas.width, canvas.height);
  gl.uniform1f(U.uTime, now / 1000);
  gl.uniform1f(U.uRough, state.rough);
  gl.uniform1f(U.uAniso, state.aniso);
  gl.uniform1f(U.uRoll, state.roll);
  gl.uniform1f(U.uAzimuth, state.azimuth);
  gl.uniform1i(U.uSingleLobe, state.singleLobe ? 1 : 0);
  gl.uniform1i(U.uDebugTangent, state.debugTangent ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  frames++;
  if (now - fpsT > 500) {
    els.fps.textContent = `${Math.round((frames * 1000) / (now - fpsT))} FPS`;
    frames = 0; fpsT = now;
    updateDiagnostics();
  }
  requestAnimationFrame(frame);
}
bind();
syncUI();
updateDiagnostics();
requestAnimationFrame(frame);
window.__aniso = { state, syncUI, updateDiagnostics };
