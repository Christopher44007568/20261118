// All GLSL sources for the motion-blur pipeline.

export const GBUFFER_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
uniform mat4 uViewProj;     // current frame view*proj
uniform mat4 uPrevViewProj; // previous frame view*proj
uniform mat4 uModel;        // current object transform
uniform mat4 uPrevModel;    // previous frame object transform
out vec3 vColor;
out vec3 vNormal;
out vec4 vClipCurr;
out vec4 vClipPrevCam;  // current world pos through previous camera -> pure camera motion
out vec4 vClipPrevFull; // previous world pos through previous camera -> camera + object motion
void main() {
  vec4 worldCurr = uModel * vec4(aPos, 1.0);
  vec4 worldPrev = uPrevModel * vec4(aPos, 1.0);
  vColor = aColor;
  vNormal = mat3(uModel) * aNormal;
  vClipCurr = uViewProj * worldCurr;
  vClipPrevCam = uPrevViewProj * worldCurr;
  vClipPrevFull = uPrevViewProj * worldPrev;
  gl_Position = vClipCurr;
}`;

// MRT: 0 = lit color, 1 = velocity (rg = camera px, ba = object px), 2 = object id
export const GBUFFER_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vNormal;
in vec4 vClipCurr;
in vec4 vClipPrevCam;
in vec4 vClipPrevFull;
uniform vec2 uResolution;
uniform vec3 uLightDir;
uniform float uObjectId;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oVel;
layout(location=2) out vec4 oId;
void main() {
  float ndl = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
  oColor = vec4(vColor * (0.28 + 0.72 * ndl), 1.0);
  vec2 ndcC = vClipCurr.xy / vClipCurr.w * 0.5 + 0.5;
  vec2 ndcPC = vClipPrevCam.xy / vClipPrevCam.w * 0.5 + 0.5;
  vec2 ndcPF = vClipPrevFull.xy / vClipPrevFull.w * 0.5 + 0.5;
  vec2 velCam = (ndcPC - ndcC) * uResolution; // px, current->previous
  vec2 velObj = (ndcPF - ndcPC) * uResolution; // px, object-only component
  oVel = vec4(velCam, velObj);
  oId = vec4(uObjectId, 0.0, 0.0, 1.0);
}`;

export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Disocclusion: reproject current depth into previous frame, compare against
// previous depth. Mismatch => occlusion relation changed this frame.
export const OCCLUSION_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDepthCurr;
uniform sampler2D uDepthPrev;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform float uHasPrev;
out vec4 oVis;
void main() {
  float vis = 1.0;
  if (uHasPrev < 0.5) { oVis = vec4(vis, 0.0, 0.0, 1.0); return; }
  float d = texture(uDepthCurr, vUv).r;
  vec4 world = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  world /= world.w;
  vec4 pc = uPrevViewProj * world;
  vec3 p = pc.xyz / pc.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z < 0.0 || p.z > 1.0) {
    vis = 0.0;
  } else {
    float pd = texture(uDepthPrev, p.xy).r;
    if (pd < p.z - 0.004) vis = 0.0; // something closer occupied this pixel last frame
  }
  oVis = vec4(vis, 0.0, 0.0, 1.0);
}`;

// Directional motion blur along the reconstructed velocity. Sample range is
// shortened where the occlusion test failed so trails do not bleed across
// disoccluded edges. Alpha stores normalized blur range (for debug/metrics).
export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uColor;
uniform sampler2D uVel;
uniform sampler2D uVis;
uniform vec2 uResolution;
uniform float uMaxBlur; // px
out vec4 oColor;
void main() {
  vec4 v = texture(uVel, vUv);
  vec2 vel = v.xy + v.zw; // camera + object
  float vis = texture(uVis, vUv).r;
  float len = length(vel);
  float range = min(len, uMaxBlur) * mix(0.2, 1.0, vis);
  vec3 acc = texture(uColor, vUv).rgb;
  float w = 1.0;
  if (range > 0.5) {
    vec2 dir = vel / max(len, 1e-5);
    for (int i = 1; i < 12; i++) {
      float t = float(i) / 11.0 * 2.0 - 1.0; // -1..1 symmetric
      vec2 off = dir * (range * 0.5 * t) / uResolution;
      acc += texture(uColor, vUv + off).rgb;
      w += 1.0;
    }
  }
  oColor = vec4(acc / w, range / uMaxBlur);
}`;

// Temporal resolve: blend blurred frame with history. Weight drops on
// disocclusion and high speed. Alpha = history weight (debug/metrics).
export const RESOLVE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uBlur;
uniform sampler2D uHistory;
uniform sampler2D uVel;
uniform sampler2D uVis;
uniform float uHasHistory;
out vec4 oColor;
void main() {
  vec3 cur = texture(uBlur, vUv).rgb;
  vec3 hist = texture(uHistory, vUv).rgb;
  vec4 v = texture(uVel, vUv);
  float speed = length(v.xy + v.zw);
  float vis = texture(uVis, vUv).r;
  float w = 0.88 * vis * clamp(1.0 - speed / 40.0, 0.0, 1.0) * uHasHistory;
  oColor = vec4(mix(cur, hist, w), w);
}`;

// Final blit with debug view modes.
export const BLIT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uResolve; // rgb = final, a = history weight
uniform sampler2D uVel;
uniform sampler2D uBlur;
uniform int uMode; // 0 composite, 1 velocity, 2 blur buffer, 3 history weight, 4 motion split
uniform float uVelScale;
out vec4 oColor;
void main() {
  vec4 r = texture(uResolve, vUv);
  if (uMode == 0) { oColor = vec4(r.rgb, 1.0); return; }
  vec4 v = texture(uVel, vUv);
  if (uMode == 1) {
    vec2 vel = (v.xy + v.zw) * uVelScale;
    oColor = vec4(abs(vel.x), abs(vel.y), length(vel) * 0.5, 1.0);
    return;
  }
  if (uMode == 2) { oColor = vec4(texture(uBlur, vUv).rgb, 1.0); return; }
  if (uMode == 3) { oColor = vec4(vec3(r.a), 1.0); return; }
  // motion split: red = camera motion, green = object motion
  float cam = length(v.xy) * uVelScale;
  float obj = length(v.zw) * uVelScale;
  oColor = vec4(cam, obj, 0.0, 1.0);
}`;
