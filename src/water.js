'use strict';

/* Two hydrodynamic regimes — values mirror the study panel. */
const REGIMES = {
  current: {
    label: 'current', speed: 2.2, distortion: 0.055, wavelength: 0.62,
    mix: 0.82, choppy: 1.0
  },
  calm: {
    label: 'calm', speed: 0.1, distortion: 0.007, wavelength: 1.18,
    mix: 0.93, choppy: 0.35
  }
};

function buildWaterMesh(gl) {
  const nx = 96, nz = 64;
  const halfX = 80, nearZ = 26, farZ = -24;
  const verts = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = -halfX + (i / nx) * halfX * 2;
      const z = nearZ + (j / nz) * (farZ - nearZ);
      verts.push(x, 0, z, 0, 1, 0, 0.13, 0.24, 0.2);
    }
  }
  const indices = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1, d = a + (nx + 1), c = d + 1;
      // CCW winding so the upward-facing (+Y) surface survives back-face cull.
      indices.push(a, b, d, b, c, d);
    }
  }
  return GLU.mesh(gl, {
    verts, indices, stride: 9,
    attribs: [
      { loc: 0, size: 3, offset: 0 },
      { loc: 1, size: 3, offset: 3 },
      { loc: 2, size: 3, offset: 6 }
    ]
  });
}

const WATER_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
uniform mat4 uViewProj;
uniform mat4 uMirrorVP;
out vec3 vWorld;
out vec3 vBaseColor;
out vec4 vMirrorClip;
void main(){
  vWorld = aPos;
  vBaseColor = aColor;
  vMirrorClip = uMirrorVP * vec4(aPos, 1.0);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const WATER_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vBaseColor;
in vec4 vMirrorClip;
uniform sampler2D uReflection;
uniform float uTime;
uniform vec3 uEye;
uniform float uSpeed;
uniform float uDistortion;
uniform float uWavelength;
uniform float uMix;
uniform float uChoppy;
uniform int uNoDistortion;
uniform int uNoGlint;
out vec4 frag;

/* Sum of directional sine waves -> analytic normal (no texture fetch). */
vec3 waveNormal(vec2 p){
  vec3 n = vec3(0.0);
  float t = uTime * uSpeed;
  // Distortion scales the visible normal slope; calm water keeps it tiny,
  // fast current sharpens the chop noticeably.
  float amp = uDistortion * 2.6;
  float freq = 6.2831853 / uWavelength;
  vec2 dir1 = normalize(vec2(0.92, 0.38));
  vec2 dir2 = normalize(vec2(-0.55, 0.83));
  vec2 dir3 = normalize(vec2(0.25, -0.97));
  float p1 = dot(p, dir1) * freq + t * 1.7;
  float p2 = dot(p, dir2) * freq * 1.6 + t * 2.1;
  float p3 = dot(p, dir3) * freq * 2.6 + t * 2.7;
  n.x += cos(p1) * dir1.x * amp;
  n.z += cos(p1) * dir1.y * amp;
  n.x += cos(p2) * dir2.x * amp * 0.6;
  n.z += cos(p2) * dir2.y * amp * 0.6;
  n.x += cos(p3) * dir3.x * amp * 0.35 * uChoppy;
  n.z += cos(p3) * dir3.y * amp * 0.35 * uChoppy;
  return normalize(vec3(-n.x, 1.0, -n.z));
}

void main(){
  vec3 n = waveNormal(vWorld.xz);
  if(uNoDistortion == 1) n = vec3(0.0, 1.0, 0.0);

  // Planar mirror UV from the mirror camera, then perturb along the normal.
  vec2 ndc = vMirrorClip.xy / vMirrorClip.w;
  // Clamp the base projection first: grid corners outside the mirror frustum
  // still map to a valid edge texel instead of an out-of-range fetch.
  vec2 mirrorUV = clamp(ndc * 0.5 + 0.5, vec2(0.002), vec2(0.998));

  // Distance to the lake boundary: fade perturbation to zero near shores so
  // bank reflections can never be dragged outside the water surface.
  float edgeX = smoothstep(78.0, 60.0, abs(vWorld.x));
  float edgeZ = smoothstep(26.0, 12.0, vWorld.z) * smoothstep(24.0, 8.0, -vWorld.z);
  float edgeGate = edgeX * edgeZ;
  vec2 perturb = vec2(n.x, n.z) * 0.05 * edgeGate;
  if(uNoDistortion == 1) perturb = vec2(0.0);
  vec2 uv = mirrorUV + perturb;

  // Double clamp: first keep inside the mirror texture, then converge any
  // out-of-range sample back toward its unperturbed coordinate.
  vec2 clamped = clamp(uv, vec2(0.002), vec2(0.998));
  uv = mix(mirrorUV, clamped, edgeGate);

  // The mirror eye views the scene upside-down relative to the main camera,
  // so its framebuffer is sampled with a vertically flipped coordinate.
  // Calibration: a buoy at texture v lands on the water point whose mirror
  // projection is at 1-v, hence the explicit 1-uv.y flip.
  vec3 refl = texture(uReflection, vec2(uv.x, 1.0 - uv.y)).rgb;

  vec3 viewDir = normalize(uEye - vWorld);
  // Schlick Fresnel: grazing angles (distant water) approach full reflection,
  // while near/vertical views reveal the deep water body.
  float ndv = max(dot(n, viewDir), 0.0);
  float fresnel = 0.02 + (1.0 - 0.02) * pow(1.0 - ndv, 5.0);
  // Keep reflection dominant so mirrored banks stay legible; uMix biases
  // between a glassy mirror and a deeper, more absorptive water body.
  fresnel = clamp(fresnel, 0.18, 1.0) * (0.7 + 0.3 * uMix);

  vec3 deep = vec3(0.045, 0.10, 0.09);
  vec3 shallow = vBaseColor * 0.55;
  float depthTint = clamp((vWorld.z + 24.0) / 50.0, 0.0, 1.0);
  vec3 waterCol = mix(deep, shallow, depthTint * 0.45);

  // Sun glint driven by the same wave normal (debug toggle available).
  vec3 lightDir = normalize(vec3(-0.35, 0.75, 0.45));
  vec3 halfV = normalize(lightDir + viewDir);
  float glint = pow(max(dot(n, halfV), 0.0), 90.0) * 0.55 * uChoppy;
  if(uNoGlint == 1) glint = 0.0;

  vec3 color = mix(waterCol, refl, clamp(fresnel, 0.0, 1.0));
  color += vec3(1.0, 0.95, 0.78) * glint;
  if(uNoGlint == 2) color = refl;
  frag = vec4(color, 1.0);
}`;

window.REGIMES = REGIMES;
window.buildWaterMesh = buildWaterMesh;
window.WATER_VS = WATER_VS;
window.WATER_FS = WATER_FS;
