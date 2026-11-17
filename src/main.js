import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 基础场景：地面 + 盒子 + 圆柱 + 悬空球
// 注意：renderer 不开启 shadowMap，接触阴影完全来自深度差通道。
// ---------------------------------------------------------------------------

const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false; // 明确不用阴影贴图

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2027);

const CAMERA_LAYER = 0;
const CASTER_LAYER = 1; // 参与接触阴影深度通道的物体

// --- 相机：主视角 + 侧视图（贴近地面看接触线） ---
const mainCam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
mainCam.position.set(5.2, 3.6, 6.4);
mainCam.lookAt(0, 0.4, 0);

const sideCam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
sideCam.position.set(0.3, 0.5, 7.5);
sideCam.lookAt(0.3, 0.35, 0);

let activeCam = mainCam;

// --- 灯光（无阴影贴图） ---
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3227, 0.85));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
sun.position.set(4, 7, 3);
scene.add(sun);

// --- 地面 ---
const GROUND_Y = 0;
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x8a8f96, roughness: 0.95, metalness: 0.0,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_Y;
scene.add(ground);

// --- 物体 ---
const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.1, 1.1, 1.1),
  new THREE.MeshStandardMaterial({ color: 0xc96f4a, roughness: 0.7 }),
);
box.position.set(-2.1, 0.55, 0.2);

const cylinder = new THREE.Mesh(
  new THREE.CylinderGeometry(0.55, 0.55, 1.3, 40),
  new THREE.MeshStandardMaterial({ color: 0x4a7ec9, roughness: 0.6 }),
);
cylinder.position.set(0.1, 0.65, -0.6);

const SPHERE_R = 0.5;
const floater = new THREE.Mesh(
  new THREE.SphereGeometry(SPHERE_R, 48, 32),
  new THREE.MeshStandardMaterial({ color: 0x59b06a, roughness: 0.55 }),
);
let floatGap = 0.0; // 球底离地的缝隙高度（米）
floater.position.set(2.3, GROUND_Y + SPHERE_R + floatGap, 0.4);

for (const m of [box, cylinder, floater]) {
  m.layers.enable(CASTER_LAYER);
  scene.add(m);
}

// 参考网格，便于侧视图观察缝隙
const grid = new THREE.GridHelper(20, 40, 0x33404e, 0x252e39);
grid.position.y = GROUND_Y + 0.001;
scene.add(grid);

// ---------------------------------------------------------------------------
// 接触阴影核心：底面高度通道（深度差，而非阴影贴图）
// 从地面以下用正交相机向上看，只渲染 CASTER_LAYER 物体，
// 把每个纹素看到的"最近底面"的世界高度写入浮点 RT。
// 地面着色时采样该高度：gap = 底面高度 - 地面高度，gap 越小阴影越浓。
// ---------------------------------------------------------------------------

const HEIGHT_RES = 256;                 // 高度通道分辨率（额外深度 pass）
const HEIGHT_EXTENT = 5.0;              // 覆盖世界 XZ 半径（米）
const NO_OCCLUDER = 1e5;                // 清空标记：无遮挡物

const heightRT = new THREE.WebGLRenderTarget(HEIGHT_RES, HEIGHT_RES, {
  type: THREE.FloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: true,
});

const heightCam = new THREE.OrthographicCamera(
  -HEIGHT_EXTENT, HEIGHT_EXTENT, HEIGHT_EXTENT, -HEIGHT_EXTENT, 0.05, 12,
);
heightCam.position.set(0, GROUND_Y - 0.5, 0); // 地面以下，向上看
heightCam.up.set(0, 0, 1); // 使相机 x→世界X、y→世界Z，与 uv 映射一致
heightCam.lookAt(0, GROUND_Y + 1, 0);
heightCam.layers.set(CASTER_LAYER);

// 覆盖材质：把世界高度写入 R 通道
const heightWriteMat = new THREE.ShaderMaterial({
  vertexShader: /* glsl */`
    varying float vWorldY;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldY = wp.y;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    varying float vWorldY;
    void main() { gl_FragColor = vec4(vWorldY, 0.0, 0.0, 1.0); }
  `,
  side: THREE.DoubleSide,
});

const heightScene = new THREE.Scene(); // 复用主场景物体，单独场景避免改 layers 状态
for (const m of [box, cylinder, floater]) heightScene.add(m.clone());
// 克隆体的变换每帧同步
const heightCasters = heightScene.children;

function renderHeightPass() {
  for (let i = 0; i < heightCasters.length; i++) {
    heightCasters[i].position.copy([box, cylinder, floater][i].position);
    heightCasters[i].quaternion.copy([box, cylinder, floater][i].quaternion);
    heightCasters[i].scale.copy([box, cylinder, floater][i].scale);
  }
  const prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(heightRT);
  renderer.setClearColor(new THREE.Color(NO_OCCLUDER, 0, 0), 1);
  renderer.clear();
  heightScene.overrideMaterial = heightWriteMat;
  renderer.render(heightScene, heightCam);
  heightScene.overrideMaterial = null;
  renderer.setRenderTarget(prevRT);
}

// ---------------------------------------------------------------------------
// 地面材质注入：用高度差计算接触阴影
//   gap  = 遮挡物底面高度 - 地面高度
//   occ  = 1 - smoothstep(0, MAX_GAP, gap)   → 物体越高阴影越淡，超出范围消失
//   每像素 8 次泊松盘采样做软边（额外采样成本来源）
// ---------------------------------------------------------------------------

const SHADOW_TAPS = 8;
const shadowParams = {
  enabled: true,
  maxGap: 0.6,      // 阴影作用范围（米）：缝隙超过该高度则无阴影
  strength: 0.85,   // 最大阴影强度
  kernelRadius: 0.07, // 泊松盘半径（米），决定软边宽度
};

groundMat.onBeforeCompile = (shader) => {
  shader.uniforms.uHeightMap = { value: heightRT.texture };
  shader.uniforms.uExtent = { value: HEIGHT_EXTENT };
  shader.uniforms.uMaxGap = { value: shadowParams.maxGap };
  shader.uniforms.uStrength = { value: shadowParams.strength };
  shader.uniforms.uKernel = { value: shadowParams.kernelRadius };
  shader.uniforms.uEnabled = { value: 1.0 };
  groundMat.userData.shader = shader;

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>',
      '#include <common>\nvarying vec3 vCSWorldPos;')
    .replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvCSWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', /* glsl */`
      #include <common>
      varying vec3 vCSWorldPos;
      uniform sampler2D uHeightMap;
      uniform float uExtent, uMaxGap, uStrength, uKernel, uEnabled;
      float contactOcclusion(vec2 xz) {
        vec2 uv = xz / (2.0 * uExtent) + 0.5;
        if (uv != clamp(uv, 0.0, 1.0)) return 0.0;
        float bottomY = texture2D(uHeightMap, uv).r;
        float gap = bottomY - ${GROUND_Y.toFixed(3)};
        if (gap < 0.0) gap = 0.0;
        return 1.0 - smoothstep(0.0, uMaxGap, gap);
      }
      float contactShadow(vec3 wp) {
        // 8 次泊松盘采样
        const vec2 P[8] = vec2[8](
          vec2(-0.7071,  0.7071), vec2(-0.0000, -0.8750),
          vec2( 0.5303,  0.5303), vec2(-0.6250, -0.0000),
          vec2( 0.0000,  0.3750), vec2(-0.3536, -0.3536),
          vec2( 0.0000,  0.0000), vec2( 0.8750,  0.0000));
        float occ = 0.0;
        for (int i = 0; i < 8; i++)
          occ += contactOcclusion(wp.xz + P[i] * uKernel);
        occ /= 8.0;
        return 1.0 - uStrength * occ * uEnabled;
      }
    `)
    .replace('#include <lights_fragment_end>', /* glsl */`
      #include <lights_fragment_end>
      float cs = contactShadow(vCSWorldPos);
      reflectedLight.directDiffuse *= cs;
      reflectedLight.indirectDiffuse *= cs;
    `);
};

function syncShadowUniforms() {
  const shader = groundMat.userData.shader;
  if (!shader) return;
  shader.uniforms.uMaxGap.value = shadowParams.maxGap;
  shader.uniforms.uStrength.value = shadowParams.strength;
  shader.uniforms.uKernel.value = shadowParams.kernelRadius;
  shader.uniforms.uEnabled.value = shadowParams.enabled ? 1.0 : 0.0;
}

// ---------------------------------------------------------------------------
// 指标：阴影强度 / 遮挡深度 / 额外采样成本
// ---------------------------------------------------------------------------

const probes = [
  { name: 'box',      label: '盒子',   obj: box },
  { name: 'cylinder', label: '圆柱',   obj: cylinder },
  { name: 'floater',  label: '悬空球', obj: floater },
];

const probeBuf = new Float32Array(4);
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// 从高度 RT 回读探针处底面高度，用与着色器相同的公式求强度
function sampleProbe(obj) {
  const u = (obj.position.x + HEIGHT_EXTENT) / (2 * HEIGHT_EXTENT);
  const v = (obj.position.z + HEIGHT_EXTENT) / (2 * HEIGHT_EXTENT);
  const px = Math.min(HEIGHT_RES - 1, Math.max(0, Math.round(u * (HEIGHT_RES - 1))));
  const py = Math.min(HEIGHT_RES - 1, Math.max(0, Math.round(v * (HEIGHT_RES - 1))));
  renderer.readRenderTargetPixels(heightRT, px, py, 1, 1, probeBuf);
  const bottomY = probeBuf[0];
  if (bottomY > NO_OCCLUDER / 2) return { gap: Infinity, intensity: 0 };
  const gap = Math.max(0, bottomY - GROUND_Y);
  const occ = 1 - smoothstep(0, shadowParams.maxGap, gap);
  return { gap, intensity: shadowParams.enabled ? shadowParams.strength * occ : 0 };
}

// 帧耗时对比（开/关接触阴影）→ 额外采样成本
let frameMs = { on: 0, off: 0 };
let frameCount = { on: 0, off: 0 };
let lastFrameStart = 0;

function getMetrics() {
  const perObject = {};
  for (const p of probes) {
    const s = sampleProbe(p.obj);
    perObject[p.name] = {
      label: p.label,
      shadowIntensity: +s.intensity.toFixed(4),
      occlusionDepth: s.gap === Infinity ? null : +s.gap.toFixed(4),
    };
  }
  const avgOn = frameCount.on ? frameMs.on / frameCount.on : 0;
  const avgOff = frameCount.off ? frameMs.off / frameCount.off : 0;
  return {
    objects: perObject,
    cost: {
      heightPassResolution: HEIGHT_RES,
      tapsPerGroundPixel: SHADOW_TAPS,
      extraPasses: 1,
      avgFrameMsOn: +avgOn.toFixed(3),
      avgFrameMsOff: +avgOff.toFixed(3),
      extraMsPerFrame: +(avgOn - avgOff).toFixed(3),
    },
    params: { ...shadowParams },
  };
}

// ---------------------------------------------------------------------------
// HUD / 交互 / 主循环
// ---------------------------------------------------------------------------

const hud = document.getElementById('hud');
let hudTimer = 0;

function updateHUD() {
  const m = getMetrics();
  const lines = ['接触阴影（深度差方式）  强度 | 遮挡深度(缝隙)'];
  for (const p of probes) {
    const o = m.objects[p.name];
    const gap = o.occlusionDepth === null ? '  无遮挡' : o.occlusionDepth.toFixed(3) + ' m';
    lines.push(`${p.label.padEnd(4, '　')}  ${o.shadowIntensity.toFixed(3)} | ${gap}`);
  }
  lines.push(`额外成本  高度通道 ${m.cost.heightPassResolution}² ×1 pass + 地面每像素 ${m.cost.tapsPerGroundPixel} 次采样`);
  lines.push(`帧耗时    开 ${m.cost.avgFrameMsOn} ms / 关 ${m.cost.avgFrameMsOff} ms (Δ ${m.cost.extraMsPerFrame} ms)`);
  lines.push(`视角      ${activeCam === mainCam ? '主视角' : '侧视图'}   阴影 ${shadowParams.enabled ? '开' : '关'}`);
  hud.textContent = lines.join('\n');
}

let autoBob = false;
let bobT = 0;

function setFloatGap(g) {
  floatGap = Math.max(0, g);
  floater.position.y = GROUND_Y + SPHERE_R + floatGap;
}

window.addEventListener('keydown', (e) => {
  if (e.key === '1') activeCam = mainCam;
  if (e.key === '2') activeCam = sideCam;
  if (e.key === ' ') autoBob = !autoBob;
  if (e.key === 's' || e.key === 'S') shadowParams.enabled = !shadowParams.enabled;
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  for (const c of [mainCam, sideCam]) {
    c.aspect = w / h;
    c.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);
resize();

function animate(t) {
  requestAnimationFrame(animate);
  const t0 = performance.now();

  if (autoBob) {
    bobT = t * 0.001;
    setFloatGap(0.55 + 0.55 * Math.sin(bobT * 1.6)); // 0 ~ 1.1 m 往复
  }

  renderHeightPass();
  syncShadowUniforms();
  renderer.render(scene, activeCam);

  const dt = performance.now() - t0;
  const key = shadowParams.enabled ? 'on' : 'off';
  // 跳过前几帧预热
  if (t - lastFrameStart > 0 && t > 1500) {
    frameMs[key] += dt; frameCount[key]++;
  }
  lastFrameStart = t;

  if (t - hudTimer > 250) { hudTimer = t; updateHUD(); }
}
requestAnimationFrame(animate);

// ---------------------------------------------------------------------------
// 测试 API
// ---------------------------------------------------------------------------
window.__demo = {
  ready: true,
  setView(name) { activeCam = name === 'side' ? sideCam : mainCam; },
  setFloatGap,
  setAutoBob(v) { autoBob = !!v; },
  setShadowEnabled(v) { shadowParams.enabled = !!v; },
  resetTiming() { frameMs = { on: 0, off: 0 }; frameCount = { on: 0, off: 0 }; },
  getMetrics,
};
