// GLSL sources. The decode math is a line-for-line port of the CPU reference
// in src/octahedron.js, src/quant.js and src/compress.js.

export const VERT_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosQ;    // 3 x UNORM16
layout(location = 1) in vec2 aOct;     // 2 x SNORM8 (oct16)
layout(location = 2) in vec2 aUvQ;     // 2 x UNORM16
layout(location = 3) in float aSign;  // tangent handedness {-1,+1}
layout(location = 4) in vec3 aRefNormal; // source float normal (visualization only)

uniform vec3 uAabbMin;
uniform vec3 uAabbMax;
uniform mat4 uViewProj;

out vec3 vNormal;
out vec3 vTangent;
out vec2 vUv;
flat out float vSign;
out vec3 vRefNormal;

vec3 reconstructTangent(vec3 n, float handedness) {
  vec3 up = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, n));
  vec3 bitangent = normalize(
    handedness >= 0.0 ? cross(n, t) : cross(t, n));
  return normalize(cross(bitangent, n));
}

void main() {
  vec3 range = uAabbMax - uAabbMin;
  vec3 position = uAabbMin + aPosQ * range;

  // Octahedron decode (matches octDecodeRaw on the CPU). aOct is already
  // normalized to [-1,1] by the vertex format for both oct16 and oct32.
  float vz = 1.0 - abs(aOct.x) - abs(aOct.y);
  vec2 xy = aOct;
  if (vz < -1e-7) {
    float ox = aOct.x;
    float oy = aOct.y;
    xy = vec2(
      (1.0 - abs(oy)) * (ox >= 0.0 ? 1.0 : -1.0),
      (1.0 - abs(ox)) * (oy >= 0.0 ? 1.0 : -1.0));
    vz = 1.0 - abs(xy.x) - abs(xy.y);
  }
  vec3 normal = normalize(vec3(xy, vz));

  vNormal = normal;
  vTangent = reconstructTangent(normal, aSign);
  vSign = aSign;
  vUv = aUvQ;
  vRefNormal = aRefNormal;
  gl_Position = uViewProj * vec4(position, 1.0);
}
`;

export const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vTangent;
in vec2 vUv;
flat in float vSign;
in vec3 vRefNormal;

uniform vec3 uLightDir;
uniform int uMode;         // 0 original 1 decoded 2 normal heat
uniform int uHeatMetric;   // 0 normal angle 1 color distance
uniform float uHeatMax;

out vec4 outColor;

vec3 lambert(vec3 n) {
  float ndl = max(dot(n, uLightDir), 0.0);
  return vec3(0.18 + 0.82 * ndl, 0.22 + 0.72 * ndl, 0.32 + 0.60 * ndl);
}

// Blue -> green -> red ramp over a normalized [0,1] magnitude.
vec3 heatRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.05, 0.10, 0.70), vec3(0.10, 0.80, 0.30), smoothstep(0.0, 0.5, t));
  return mix(c, vec3(0.90, 0.10, 0.10), smoothstep(0.5, 1.0, t));
}

void main() {
  vec3 refN = normalize(vRefNormal);
  vec3 refCol = lambert(refN);
  vec3 decCol = lambert(normalize(vNormal));
  if (uMode == 0) {
    outColor = vec4(refCol, 1.0);
    return;
  }
  if (uMode == 1) {
    outColor = vec4(decCol, 1.0);
    return;
  }
  float magnitude;
  if (uHeatMetric == 0) {
    float cosA = clamp(dot(refN, normalize(vNormal)), -1.0, 1.0);
    magnitude = degrees(acos(cosA));
  } else {
    magnitude = distance(refCol, decCol);
  }
  outColor = vec4(heatRamp(magnitude / max(uHeatMax, 1e-6)), 1.0);
}
`;
