export const fullscreenVertex = `#version 300 es
out vec2 vUv;

void main() {
  vec2 point = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = point;
  gl_Position = vec4(point * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const lightingFragment = `#version 300 es
precision highp float;
precision highp int;

const int MAX_LIGHTS = 48;

uniform vec2 uResolution;
uniform float uTileSize;
uniform int uMode;
uniform int uLightCount;
uniform vec4 uLightPositionRadius[MAX_LIGHTS];
uniform vec4 uLightColorIntensity[MAX_LIGHTS];
uniform highp sampler2D uTileCounts;
uniform highp usampler2D uTileIndices;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float softLine(float distance, float width) {
  return 1.0 - smoothstep(0.0, width, abs(distance));
}

float terrainHeight(vec2 p) {
  vec2 gridSpace = (p + vec2(uResolution.x / uResolution.y, 1.0) * 0.5) * 9.0;
  vec2 cell = abs(fract(gridSpace) - 0.5);
  float joint = smoothstep(0.47, 0.5, max(cell.x, cell.y));
  float central = smoothstep(0.34, 0.29, length(p * vec2(1.0, 1.04)));
  float ring = exp(-pow((length(p) - 0.315) * 62.0, 2.0));
  float machinery = exp(-pow((length(p * vec2(1.0, 1.08)) - 0.205) * 92.0, 2.0));
  return joint * 0.0035 + central * 0.017 + ring * 0.006 + machinery * 0.003;
}

vec2 rotate2(vec2 p, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c) * p;
}

float angularLine(vec2 p, float count, float power) {
  float angle = atan(p.y, p.x);
  return pow(max(cos(angle * count), 0.0), power);
}

vec3 lightColorAt(int index) {
  return uLightColorIntensity[index].rgb;
}

vec3 evaluateLight(int index, vec2 p, vec3 normal, vec3 albedo, float aspect) {
  vec4 positionRadius = uLightPositionRadius[index];
  vec2 lightPosition = vec2(
    (positionRadius.x - 0.5) * aspect,
    0.5 - positionRadius.y
  );
  vec2 delta = lightPosition - p;
  float radius = positionRadius.z;
  float distanceToLight = length(delta);
  if (distanceToLight >= radius) {
    return vec3(0.0);
  }

  float radial = 1.0 - distanceToLight / radius;
  float attenuation = radial * radial * (3.0 - 2.0 * radial);
  vec3 lightDirection = normalize(vec3(delta, 0.46 + radius * 0.9));
  float diffuse = max(dot(normal, lightDirection), 0.0);
  vec3 viewDirection = normalize(vec3(-p * 0.18, 1.0));
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float specular = pow(max(dot(normal, halfDirection), 0.0), 38.0);
  float core = 1.0 - smoothstep(radius * 0.018, radius * 0.072, distanceToLight);
  float intensity = uLightColorIntensity[index].a;
  vec3 tint = lightColorAt(index);

  vec3 litSurface = albedo * (0.035 + diffuse * 0.965) + vec3(specular * 0.24);
  return tint * intensity * attenuation * litSurface + tint * core * 2.15;
}

vec3 tiledLighting(vec2 p, vec3 normal, vec3 albedo, float aspect, vec2 fragCoord) {
  vec2 topLeft = vec2(fragCoord.x, uResolution.y - fragCoord.y);
  ivec2 tile = ivec2(ivec2(topLeft / uTileSize));
  int count = int(texelFetch(uTileCounts, tile, 0).r + 0.5);
  vec3 color = vec3(0.0);
  for (int entry = 0; entry < MAX_LIGHTS; entry++) {
    if (entry >= count) {
      break;
    }
    int lightIndex = int(texelFetch(uTileIndices, ivec2(tile.x * MAX_LIGHTS + entry, tile.y), 0).r);
    color += evaluateLight(lightIndex, p, normal, albedo, aspect);
  }
  return color;
}

vec3 referenceLighting(vec2 p, vec3 normal, vec3 albedo, float aspect) {
  vec3 color = vec3(0.0);
  for (int index = 0; index < MAX_LIGHTS; index++) {
    if (index >= uLightCount) {
      break;
    }
    color += evaluateLight(index, p, normal, albedo, aspect);
  }
  return color;
}

vec3 toneMap(vec3 color) {
  vec3 mapped = 1.0 - exp(-color * 1.32);
  return pow(mapped, vec3(0.4545));
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 p = (fragCoord - uResolution * 0.5) / uResolution.y;
  float aspect = uResolution.x / uResolution.y;

  float texel = 1.6 / uResolution.y;
  float heightL = terrainHeight(p - vec2(texel, 0.0));
  float heightR = terrainHeight(p + vec2(texel, 0.0));
  float heightD = terrainHeight(p - vec2(0.0, texel));
  float heightU = terrainHeight(p + vec2(0.0, texel));
  vec3 normal = normalize(vec3(
    (heightL - heightR) * 30.0,
    (heightD - heightU) * 30.0,
    1.0
  ));

  vec2 gridSpace = (p + vec2(aspect, 1.0) * 0.5) * 9.0;
  vec2 cell = floor(gridSpace);
  vec2 cellUv = fract(gridSpace);
  float checker = mod(cell.x + cell.y, 2.0);
  vec3 albedo = mix(vec3(0.018, 0.027, 0.043), vec3(0.031, 0.045, 0.061), checker);

  float joint = max(
    smoothstep(0.465, 0.5, abs(cellUv.x - 0.5)),
    smoothstep(0.465, 0.5, abs(cellUv.y - 0.5))
  );
  albedo += vec3(0.008, 0.016, 0.02) * joint;

  float radius = length(p * vec2(1.0, 1.04));
  float platform = smoothstep(0.35, 0.29, radius);
  albedo = mix(albedo, vec3(0.045, 0.064, 0.071), platform * 0.8);
  albedo += vec3(0.01, 0.019, 0.02) * smoothstep(0.07, 0.0, radius);

  vec2 spokeP = rotate2(p, 0.26);
  float spokes = angularLine(spokeP, 6.0, 40.0)
    * smoothstep(0.34, 0.31, radius)
    * smoothstep(0.105, 0.135, radius);
  albedo += vec3(0.016, 0.035, 0.038) * spokes;

  float ringA = softLine(radius - 0.318, 0.0035);
  float ringB = softLine(radius - 0.286, 0.0022);
  float ringC = softLine(radius - 0.226, 0.0018);
  vec3 emissive = vec3(0.02, 0.31, 0.29) * ringA * 0.65;
  emissive += vec3(0.48, 0.2, 0.06) * ringB * 0.34;
  emissive += vec3(0.025, 0.11, 0.15) * ringC * 0.45;
  emissive += vec3(0.045, 0.16, 0.18) * spokes * 0.42;

  float crossMask =
    softLine(p.y, 0.006) * smoothstep(0.49, 0.32, abs(p.x)) +
    softLine(p.x, 0.006) * smoothstep(0.49, 0.32, abs(p.y));
  emissive += vec3(0.025, 0.09, 0.1) * crossMask * 0.34;

  float glyph = smoothstep(0.49, 0.5, fract((p.x * 1.13 - p.y * 0.91) * 17.0));
  float glyphBand = smoothstep(0.44, 0.36, abs(p.x * 0.75 + p.y)) * smoothstep(0.34, 0.22, radius);
  emissive += vec3(0.015, 0.055, 0.062) * glyph * glyphBand;

  vec3 ambient = albedo * (0.058 + 0.028 * max(normal.y, 0.0));
  vec3 tiled = (uMode == 0 || uMode == 2)
    ? tiledLighting(p, normal, albedo, aspect, fragCoord)
    : vec3(0.0);
  vec3 reference = (uMode == 1 || uMode == 2)
    ? referenceLighting(p, normal, albedo, aspect)
    : vec3(0.0);

  if (uMode == 2) {
    vec3 delta = abs(tiled - reference);
    vec3 amplified = 1.0 - exp(-delta * 24.0);
    outColor = vec4(amplified * vec3(1.0, 0.19, 0.25), 1.0);
    return;
  }

  vec3 color = uMode == 1 ? reference : tiled;
  color += ambient + emissive;

  float vignette = smoothstep(1.05, 0.25, length(p * vec2(0.85, 1.0)));
  color *= 0.68 + 0.32 * vignette;
  color = toneMap(color);
  float dither = (hash21(fragCoord) - 0.5) / 255.0;
  color += dither;

  outColor = vec4(color, 1.0);
}
`;
