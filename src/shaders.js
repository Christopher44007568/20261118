export const LOW_VERTEX = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec3 aTangent;
in vec3 aBitangent;
in vec2 aUv;
uniform mat4 uViewProjection;
out vec3 vNormal;
out vec3 vTangent;
out vec3 vBitangent;
out vec2 vUv;
out vec3 vWorld;
void main() {
  vNormal = aNormal;
  vTangent = aTangent;
  vBitangent = aBitangent;
  vUv = aUv;
  vWorld = aPosition;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

export const LOW_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vTangent;
in vec3 vBitangent;
in vec2 vUv;
in vec3 vWorld;
uniform sampler2D uBake;
uniform vec3 uCamera;
uniform float uUseBake;
uniform float uNormalMix;
out vec4 outColor;

void main() {
  vec3 geom = normalize(vNormal);
  vec4 packed = texture(uBake, vUv);
  vec3 tangentNormal = packed.xyz * 2.0 - 1.0;
  vec3 n = geom;
  if (uUseBake > 0.5) {
    vec3 t = normalize(vTangent);
    vec3 b = normalize(vBitangent);
    n = normalize(t * tangentNormal.x + b * tangentNormal.y + geom * tangentNormal.z);
  }
  vec3 lightDir = normalize(vec3(-0.45, 0.8, 0.55));
  vec3 viewDir = normalize(uCamera - vWorld);
  float diffuse = max(dot(n, lightDir), 0.0);
  float wrap = max(dot(n, lightDir) * 0.5 + 0.5, 0.0);
  float spec = pow(max(dot(reflect(-lightDir, n), viewDir), 0.0), 32.0);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  vec3 base = vec3(0.40, 0.48, 0.62);
  vec3 lit = base * (0.33 + diffuse * 0.9) + vec3(0.17, 0.24, 0.35) * wrap;
  lit += vec3(0.80, 0.88, 1.0) * spec * 0.48;
  lit += vec3(0.18, 0.48, 0.70) * rim * 0.7;
  vec3 normalColor = tangentNormal * 0.5 + 0.5;
  vec3 color = mix(lit, normalColor, uNormalMix);
  outColor = vec4(color, 1.0);
}`;

export const HIGH_VERTEX = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
uniform mat4 uViewProjection;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vNormal = aNormal;
  vWorld = aPosition;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

export const HIGH_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uCamera;
uniform vec3 uColor;
uniform float uAlpha;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCamera - vWorld);
  float fresnel = pow(1.0 - abs(dot(n, v)), 2.0);
  float alpha = uAlpha * (0.35 + fresnel * 2.6);
  outColor = vec4(uColor, alpha);
}`;

export const LINE_VERTEX = `#version 300 es
in vec3 aPosition;
uniform mat4 uViewProjection;
void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

export const LINE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;
