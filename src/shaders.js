// GLSL ES 3.00 sources for the CSM demo.

export const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() {
  gl_Position = uLightVP * uModel * vec4(aPos, 1.0);
}`;

export const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

export const MAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat4 uLightVP[3];
out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vShadowCoord[3];
out float vViewDepth;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorldPos = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vec4 viewPos = uView * world;
  vViewDepth = -viewPos.z;
  for (int i = 0; i < 3; i++) {
    vShadowCoord[i] = uLightVP[i] * world;
  }
  gl_Position = uProj * viewPos;
}`;

export const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;

in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vShadowCoord[3];
in float vViewDepth;

uniform sampler2DShadow uShadowMap[3];
uniform vec4 uSplits;        // view-depth split boundaries (x,y,z used)
uniform vec3 uLightDir;      // normalized, points toward the scene
uniform vec3 uCamPos;
uniform vec3 uBaseColor;
uniform float uBlendBand;    // fraction of cascade range used for blending
uniform float uMapRes[3];
uniform float uDepthRange[3]; // light-space depth range per cascade (for bias)
uniform int uDebugMode;      // 0=off 1=cascade tint 2=blend band highlight

out vec4 fragColor;

const vec3 CASCADE_TINT[3] = vec3[3](
  vec3(1.0, 0.25, 0.25),   // near: red
  vec3(0.25, 1.0, 0.25),   // mid:  green
  vec3(0.35, 0.45, 1.0)    // far:  blue
);

float cascadeStart(int i) { return i == 0 ? 0.0 : (i == 1 ? uSplits.x : uSplits.y); }
float cascadeEnd(int i)   { return i == 0 ? uSplits.x : (i == 1 ? uSplits.y : uSplits.z); }

// 3x3 PCF on a hardware-compare depth texture.
float pcf(sampler2DShadow map, float res, vec4 sc, float bias) {
  vec3 p = sc.xyz / sc.w;
  p = p * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float refZ = p.z - bias;
  vec2 texel = vec2(1.0 / res);
  float sum = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec2 uv = p.xy + vec2(float(x), float(y)) * texel;
      sum += texture(map, vec3(uv, refZ));
    }
  }
  return sum / 9.0;
}

// Sampler arrays need constant indices in GLSL ES 3.0 -> explicit if-chain.
float cascadeShadow(int i, float biasWorld) {
  if (i == 0) return pcf(uShadowMap[0], uMapRes[0], vShadowCoord[0], biasWorld / uDepthRange[0]);
  if (i == 1) return pcf(uShadowMap[1], uMapRes[1], vShadowCoord[1], biasWorld / uDepthRange[1]);
  return pcf(uShadowMap[2], uMapRes[2], vShadowCoord[2], biasWorld / uDepthRange[2]);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(-uLightDir);
  float ndl = max(dot(N, L), 0.0);

  // Cascade selection by view-space depth.
  int idx = vViewDepth < uSplits.x ? 0 : (vViewDepth < uSplits.y ? 1 : 2);

  // Slope-scaled depth bias, normalized by each cascade's depth range.
  float slope = clamp(tan(acos(clamp(ndl, 0.0, 1.0))), 0.0, 4.0);
  float biasWorld = 0.02 + 0.06 * slope; // world units along light dir

  float shadow = cascadeShadow(idx, biasWorld);

  // Seam handling: inside the trailing blend band, blend with the next cascade.
  float blendT = 0.0;
  if (idx < 2) {
    float start = cascadeStart(idx);
    float end = cascadeEnd(idx);
    float band = (end - start) * uBlendBand;
    blendT = clamp((vViewDepth - (end - band)) / band, 0.0, 1.0);
    if (blendT > 0.0) {
      float nextShadow = cascadeShadow(idx + 1, biasWorld);
      shadow = mix(shadow, nextShadow, blendT);
    }
  }

  vec3 ambient = uBaseColor * 0.25;
  vec3 diffuse = uBaseColor * ndl * 0.9;
  vec3 color = ambient + diffuse * shadow;

  if (uDebugMode == 1) {
    color = mix(color, CASCADE_TINT[idx], 0.45);
  } else if (uDebugMode == 2) {
    color = mix(color, CASCADE_TINT[idx], 0.45);
    if (blendT > 0.0 && blendT < 1.0) color = mix(color, vec3(1.0, 1.0, 0.0), 0.5);
  }

  fragColor = vec4(color, 1.0);
}`;
