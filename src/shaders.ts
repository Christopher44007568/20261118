export const fullscreenVertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2(
    (gl_VertexID == 1) ? 3.0 : -1.0,
    (gl_VertexID == 2) ? 3.0 : -1.0
  );
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

export const backgroundFragment = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 top = vec3(0.105, 0.125, 0.19);
  vec3 bottom = vec3(0.025, 0.032, 0.055);
  vec3 base = mix(bottom, top, smoothstep(0.0, 1.0, vUv.y));
  float glow = exp(-length((vUv - vec2(0.83, 0.78)) * vec2(1.4, 1.0)) * 4.0);
  base += vec3(0.08, 0.065, 0.04) * glow;
  float vignette = smoothstep(1.15, 0.3, length(vUv - 0.5));
  outColor = vec4(base * mix(0.66, 1.0, vignette), 1.0);
}`;

export const meshVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProjection;
out vec3 vWorldPosition;
out vec3 vNormal;
void main() {
  vWorldPosition = aPosition;
  vNormal = aNormal;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

export const meshFragment = `#version 300 es
precision highp float;
in vec3 vWorldPosition;
in vec3 vNormal;
uniform vec3 uBaseColor;
uniform vec3 uLightPosition;
uniform vec3 uCameraPosition;
uniform float uGround;
uniform float uLightPower;
uniform float uOverlay;
uniform float uOpacity;
out vec4 outColor;

void main() {
  if (uOverlay > 0.5) {
    outColor = vec4(uBaseColor, uOpacity);
    return;
  }

  vec3 normal = normalize(vNormal);
  vec3 toLightVector = uLightPosition - vWorldPosition;
  float lightDistanceSq = max(dot(toLightVector, toLightVector), 0.0001);
  vec3 toLight = toLightVector * inversesqrt(lightDistanceSq);
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  float diffuse = max(dot(normal, toLight), 0.0);
  float attenuation = uLightPower / (1.0 + 0.045 * lightDistanceSq);
  vec3 lightColor = vec3(1.0, 0.82, 0.62);
  vec3 halfVector = normalize(toLight + viewDirection);
  float specular = pow(max(dot(normal, halfVector), 0.0), 42.0) * 0.11;
  float viewFill = max(dot(normal, viewDirection), 0.0) * 0.075;
  vec3 color = uBaseColor * (0.18 + viewFill + diffuse * attenuation * lightColor);
  color += lightColor * specular * attenuation;
  color = min(color, vec3(1.0));

  if (uGround > 0.5) {
    vec2 cell = abs(fract(vWorldPosition.xz + 0.5) - 0.5);
    float edge = min(cell.x, cell.y);
    float width = max(fwidth(edge) * 1.2, 0.012);
    float grid = 1.0 - smoothstep(0.012, 0.012 + width, edge);
    color = mix(color, color * 1.18 + vec3(0.012, 0.016, 0.022), grid * 0.55);
    float distanceFade = smoothstep(22.0, 8.0, length(vWorldPosition.xz));
    color *= mix(0.72, 1.0, distanceFade);
  }
  outColor = vec4(color, 1.0);
}`;

export const volumeFragment = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

export const colorVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProjection;
void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

export const colorFragment = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

export const solidFragment = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;
