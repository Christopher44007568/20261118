// All GLSL ES 3.00 shaders.

export const gbufferVert = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMat;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vUv = aUv;
  gl_Position = uProj * uView * world;
}`;

// Three MRT attachments: world pos / packed (normal.xy, roughness) / albedo.
export const gbufferFrag = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
uniform vec3 uAlbedo;
uniform float uRoughness;
layout(location=0) out vec4 outPos;
layout(location=1) out vec4 outNormalRough;
layout(location=2) out vec4 outAlbedo;
void main() {
  vec3 n = normalize(vNormal);
  outPos = vec4(vWorldPos, 1.0);
  outNormalRough = vec4(n.xy * 0.5 + 0.5, uRoughness, 1.0);
  outAlbedo = vec4(uAlbedo, 1.0);
}`;

// Shared PBR-ish shading: Lambert diffuse + GGX specular + ambient.
// Identical code is injected into the deferred and forward fragment shaders
// so the two renderers differ only in where their inputs come from.
export const lightingLib = `
struct Surface { vec3 worldPos; vec3 normal; vec3 albedo; float roughness; };
uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform vec3 uAmbient;

float distributionGGX(float NoH, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159265 * d * d, 1e-5);
}

vec3 shadeSurface(Surface s) {
  vec3 N = normalize(s.normal);
  vec3 V = normalize(uCamPos - s.worldPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);
  float NoL = max(dot(N, L), 0.0);
  float NoV = max(dot(N, V), 0.0);
  float NoH = max(dot(N, H), 0.0);
  vec3 radiance = uLightColor * uLightIntensity;
  vec3 diffuse = s.albedo / 3.14159265 * NoL * radiance;
  float rough = clamp(s.roughness, 0.04, 1.0);
  // Fresnel (Schlick) with neutral F0 for dielectric + tinted specular.
  vec3 F0 = mix(vec3(0.04), s.albedo, 0.15);
  vec3 fresnel = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);
  float k = (rough + 1.0);
  float vis = 0.25 / max(NoV * NoV * (k * k - 1.0) + 1.0, 1e-4);
  vec3 specular = distributionGGX(NoH, rough) * fresnel * vis
                * NoL * radiance;
  vec3 ambient = s.albedo * uAmbient;
  return diffuse + specular + ambient;
}`;

export const quadVert = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQuad;
out vec2 vUv;
void main() {
  vUv = aQuad * 0.5 + 0.5;
  gl_Position = vec4(aQuad, 0.0, 1.0);
}`;

export const blitFrag = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  // Simple gamma-ish tone mapping for display of the HDR color target.
  c = c / (c + vec3(1.0));
  c = pow(c, vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}`;

export const deferredFrag = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPosTex;
uniform sampler2D uNormalTex;
uniform sampler2D uAlbedoTex;
uniform sampler2D uDepth;
${lightingLib}
out vec4 outColor;
void main() {
  float depth = texture(uDepth, vUv).r;
  if (depth >= 1.0) {
    outColor = vec4(0.02, 0.025, 0.04, 1.0);
    return;
  }
  vec4 nr = texture(uNormalTex, vUv);
  Surface s;
  s.worldPos = texture(uPosTex, vUv).xyz;
  s.normal = vec3(nr.xy * 2.0 - 1.0, 0.0);
  s.normal.z = sqrt(max(1.0 - dot(s.normal.xy, s.normal.xy), 0.0));
  s.albedo = texture(uAlbedoTex, vUv).rgb;
  s.roughness = nr.z;
  outColor = vec4(shadeSurface(s), 1.0);
}`;

// Debug visualisation of each G-Buffer channel.
export const debugFrag = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPosTex;
uniform sampler2D uNormalTex;
uniform sampler2D uAlbedoTex;
uniform sampler2D uDepth;
uniform int uMode; // 0 pos 1 normal 2 albedo 3 roughness 4 depth
out vec4 outColor;
void main() {
  float depth = texture(uDepth, vUv).r;
  if (depth >= 1.0) { outColor = vec4(0.02, 0.025, 0.04, 1.0); return; }
  if (uMode == 0) {
    vec3 p = texture(uPosTex, vUv).xyz;
    outColor = vec4(fract(p * 0.25 + 0.5), 1.0);
  } else if (uMode == 1) {
    vec3 n = texture(uNormalTex, vUv).xyz;
    n = vec3(n.xy * 2.0 - 1.0, sqrt(max(1.0 - dot(n.xy, n.xy), 0.0)));
    outColor = vec4(n * 0.5 + 0.5, 1.0);
  } else if (uMode == 2) {
    outColor = texture(uAlbedoTex, vUv);
  } else if (uMode == 3) {
    float r = texture(uNormalTex, vUv).z;
    outColor = vec4(vec3(r), 1.0);
  } else {
    outColor = vec4(vec3(1.0 - depth), 1.0);
  }
}`;

// Forward reference: same surface setup and same lighting library.
export const forwardVert = gbufferVert;

export const forwardFrag = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
uniform vec3 uAlbedo;
uniform float uRoughness;
${lightingLib}
out vec4 outColor;
void main() {
  Surface s;
  s.worldPos = vWorldPos;
  s.normal = normalize(vNormal);
  s.albedo = uAlbedo;
  s.roughness = uRoughness;
  outColor = vec4(shadeSurface(s), 1.0);
}`;

// Transparent forward pass: alpha-blended lighting, no G-Buffer writes.
export const transparentFrag = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
uniform vec3 uAlbedo;
uniform float uRoughness;
uniform float uOpacity;
${lightingLib}
out vec4 outColor;
void main() {
  Surface s;
  s.worldPos = vWorldPos;
  s.normal = normalize(vNormal);
  s.albedo = uAlbedo;
  s.roughness = uRoughness;
  vec3 rgb = shadeSurface(s);
  outColor = vec4(rgb, uOpacity);
}`;
