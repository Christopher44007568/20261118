// GLSL mirror of src/terrain.js. The integer hash is bit-exact between
// WebGL2 uint arithmetic and JS Math.imul, so GPU and CPU heights agree.

import { CHUNK_SIZE } from './terrain.js';

export const TERRAIN_GLSL = /* glsl */ `
uint hash2u(int ix, int iz) {
  uint h = uint(ix) * 374761393u + uint(iz) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}
float hashf(int ix, int iz) {
  return float(hash2u(ix, iz) & 0xFFFFFFu) / 16777216.0;
}
float valueNoise(vec2 p) {
  int ix = int(floor(p.x));
  int iz = int(floor(p.y));
  vec2 f = p - vec2(float(ix), float(iz));
  vec2 s = f * f * (3.0 - 2.0 * f);
  float a = hashf(ix, iz), b = hashf(ix + 1, iz);
  float c = hashf(ix, iz + 1), d = hashf(ix + 1, iz + 1);
  return a + (b - a) * s.x + (c - a) * s.y + (a - b - c + d) * s.x * s.y;
}
float fbm(vec2 p, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * valueNoise(p);
    norm += amp;
    p = p * 2.0 + vec2(13.7, -7.1);
    amp *= 0.5;
  }
  return sum / norm;
}
float ridged(vec2 p, int octaves) {
  float sum = 0.0, amp = 0.55, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    float n = valueNoise(p);
    float r = 1.0 - abs(2.0 * n - 1.0);
    sum += amp * r * r;
    norm += amp;
    p = p * 2.1 + vec2(31.3, 17.9);
    amp *= 0.5;
  }
  return sum / norm;
}
float terrainHeight(vec2 p) {
  float continent = fbm(p * 0.0012 + vec2(3.1, -1.7), 4);
  float mount = ridged(p * 0.0035 + vec2(7.3, -2.1), 5);
  float t = clamp((continent - 0.42) / 0.30, 0.0, 1.0);
  float mask = t * t * (3.0 - 2.0 * t);
  float detail = fbm(p * 0.018 + vec2(11.0, 5.0), 3);
  return (continent - 0.5) * 56.0 + mask * mount * mount * 230.0 + (detail - 0.5) * 12.0;
}
`;

// Vertex shader: geomorphing toward the next coarser level. Boundary
// vertices follow per-edge rules (SELF: morph toward L+1 snap with the
// agreed edge factor; FOLLOW: interpolate onto the coarser neighbour's live
// edge). Interior morph targets that reference boundary points use the
// boundary point's LIVE position, so a fully-morphed fine mesh always
// coincides with the coarser mesh even while edges are morphing.
export const TERRAIN_VERT = /* glsl */ `
precision highp float;
precision highp int;
in vec2 aPos;
in vec2 aMorphA;
in vec2 aMorphB;
uniform vec2 uOffset;
uniform float uMorphT;
uniform float uStep;
uniform vec4 uEdgeT;
uniform ivec4 uEdgeMode;
uniform mat4 modelViewMatrix, projectionMatrix;
uniform mat3 normalMatrix;
out vec3 vWorld;
out vec3 vNormal;
${TERRAIN_GLSL}
const float CS = ${CHUNK_SIZE.toFixed(1)};
vec3 surf(vec2 local) {
  vec2 w = uOffset + local;
  return vec3(w.x, terrainHeight(w), w.y);
}
bool onBoundary(vec2 q) {
  return q.x < 0.5 || q.x > CS - 0.5 || q.y < 0.5 || q.y > CS - 0.5;
}
vec3 snapL1(vec2 q, vec2 dir, float coord) {
  float parity = mod(coord / uStep, 2.0);
  if (parity < 0.5) return surf(q);
  return (surf(q - dir * uStep) + surf(q + dir * uStep)) * 0.5;
}
vec3 snapL2(vec2 q, vec2 dir, float coord) {
  float span = 4.0 * uStep;
  float lo = floor(coord / span) * span;
  float hi = min(lo + span, CS);
  float w = hi > lo ? (coord - lo) / (hi - lo) : 0.0;
  return mix(surf(q - dir * (coord - lo)), surf(q + dir * (hi - coord)), w);
}
vec3 boundaryPos(vec2 q) {
  vec2 dir;
  float coord;
  int e;
  if (q.x < 0.5) { dir = vec2(0.0, 1.0); coord = q.y; e = 0; }
  else if (q.x > CS - 0.5) { dir = vec2(0.0, 1.0); coord = q.y; e = 1; }
  else if (q.y < 0.5) { dir = vec2(1.0, 0.0); coord = q.x; e = 2; }
  else { dir = vec2(1.0, 0.0); coord = q.x; e = 3; }
  float et = uEdgeT[e];
  vec3 s1 = snapL1(q, dir, coord);
  if (uEdgeMode[e] == 1) {
    return mix(s1, snapL2(q, dir, coord), et);
  }
  return mix(surf(q), s1, et);
}
vec3 livePos(vec2 q) {
  return onBoundary(q) ? boundaryPos(q) : surf(q);
}
void main() {
  vec3 world;
  if (onBoundary(aPos)) {
    world = boundaryPos(aPos);
  } else {
    vec3 m = (livePos(aMorphA) + livePos(aMorphB)) * 0.5;
    world = mix(surf(aPos), m, uMorphT);
  }
  float e = 1.0;
  vec3 p = surf(aPos);
  vec3 px = surf(aPos + vec2(e, 0.0));
  vec3 pz = surf(aPos + vec2(0.0, e));
  vNormal = normalize(normalMatrix * normalize(cross(pz - p, px - p)));
  vWorld = world;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  float h = vWorld.y;
  float slope = 1.0 - n.y;
  vec3 grass = vec3(0.32, 0.46, 0.22);
  vec3 rock  = vec3(0.45, 0.40, 0.36);
  vec3 snow  = vec3(0.90, 0.92, 0.95);
  vec3 sand  = vec3(0.55, 0.50, 0.38);
  vec3 col = mix(grass, sand, smoothstep(-14.0, -4.0, h));
  col = mix(col, rock, smoothstep(0.25, 0.55, slope));
  col = mix(col, snow, smoothstep(120.0, 170.0, h) * (1.0 - smoothstep(0.5, 0.8, slope)));
  float diff = max(dot(n, normalize(uSunDir)), 0.0);
  vec3 lit = col * (0.35 + 0.75 * diff);
  float fogF = smoothstep(uFogNear, uFogFar, distance(uCamPos, vWorld));
  outColor = vec4(mix(lit, uFogColor, fogF), 1.0);
}
`;

export const WIREFRAME_FRAG = /* glsl */ `
precision highp float;
out vec4 outColor;
uniform vec3 uColor;
void main() { outColor = vec4(uColor, 1.0); }
`;
