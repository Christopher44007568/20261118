export const vertexShader = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const fragmentShader = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform mat3 u_cameraBasis;
uniform vec3 u_cameraPos;
uniform float u_focal;
uniform float u_envRotation;
uniform float u_exposure;
uniform int u_toneMode;
uniform int u_showDiffuse;
uniform int u_showSpecular;
uniform int u_showDirect;
uniform int u_showIBL;
uniform int u_showNormal;
uniform float u_normalStrength;
uniform vec3 u_baseColor[3];
uniform vec2 u_materialProps[3];
uniform int u_statsPass;

out vec4 fragColor;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float FLOOR_Y = -1.31;

vec3 gSphereCenters[3] = vec3[3](
  vec3(-2.36, -0.13, 0.0),
  vec3(0.0, -0.13, 0.0),
  vec3(2.36, -0.13, 0.0)
);
float gSphereRadius = 1.04;

float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}

vec3 rotateEnvironment(vec3 direction) {
  float c = cos(u_envRotation);
  float s = sin(u_envRotation);
  return vec3(c * direction.x + s * direction.z, direction.y, -s * direction.x + c * direction.z);
}

vec3 keyDirection() {
  return normalize(rotateEnvironment(vec3(-0.46, 0.66, 0.59)));
}

vec3 backDirection() {
  return normalize(rotateEnvironment(vec3(0.54, 0.69, -0.48)));
}

vec3 stripDirection() {
  return normalize(rotateEnvironment(vec3(-0.81, 0.16, 0.31)));
}

float directionalLobe(vec3 direction, vec3 lobeDirection, float sharpness) {
  return exp(sharpness * (max(dot(direction, lobeDirection), 0.0) - 1.0));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 clampHDR(vec3 color) {
  return max(color, vec3(0.0));
}

vec3 linearToSRGB(vec3 color) {
  vec3 low = color * 12.92;
  vec3 high = 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), color));
}

vec3 acesFilmic(vec3 color) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
}

vec3 displayTransform(vec3 hdr) {
  vec3 exposed = hdr * exp2(u_exposure);
  vec3 mapped = u_toneMode == 0 ? acesFilmic(exposed) : clamp(exposed, 0.0, 1.0);
  vec3 encoded = linearToSRGB(mapped);
  float dither = (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  return clamp(encoded + dither, 0.0, 1.0);
}

vec3 environmentBackground(vec3 worldDirection) {
  vec3 direction = rotateEnvironment(worldDirection);
  float height = saturate(direction.y * 0.5 + 0.5);
  vec3 col = mix(vec3(0.055, 0.062, 0.071), vec3(0.225, 0.255, 0.285), smoothstep(0.28, 0.86, height));
  col = mix(vec3(0.105, 0.107, 0.108), col, smoothstep(0.44, 0.53, height));
  col += vec3(0.055, 0.038, 0.025) * exp(-abs(direction.y + 0.035) * 13.0);

  float backGlow = directionalLobe(direction, backDirection(), 7.0);
  float backCore = directionalLobe(direction, backDirection(), 34.0);
  col += vec3(2.25, 2.19, 2.06) * backGlow;
  col += vec3(3.8, 3.9, 3.85) * backCore;

  float strip = directionalLobe(direction, stripDirection(), 22.0);
  col += vec3(0.42, 0.63, 0.92) * strip * 0.52;

  float horizonBand = exp(-abs(direction.y) * 18.0);
  col += vec3(0.10, 0.085, 0.072) * horizonBand;
  return max(col, vec3(0.0));
}

vec3 environmentRadiance(vec3 worldDirection, float roughness) {
  vec3 direction = rotateEnvironment(worldDirection);
  float r = clamp(roughness, 0.025, 1.0);
  float r2 = r * r;

  vec3 col = environmentBackground(worldDirection);

  float keySharpness = clamp(2.0 / (r2 + 0.012), 3.2, 420.0);
  float keyLobe = directionalLobe(direction, keyDirection(), keySharpness);
  float keyEnergy = mix(12.0, 1.45, smoothstep(0.015, 0.95, r));
  col += vec3(1.0, 0.975, 0.93) * keyLobe * keyEnergy;

  float stripSharpness = mix(70.0, 5.0, smoothstep(0.02, 0.9, r));
  float stripLobe = directionalLobe(direction, stripDirection(), stripSharpness);
  col += vec3(0.34, 0.52, 0.8) * stripLobe * mix(0.62, 0.12, r);

  float rimDirection = directionalLobe(direction, backDirection(), mix(22.0, 2.5, r));
  col += vec3(0.85, 0.8, 0.69) * rimDirection * mix(0.36, 0.06, r);
  return max(col, vec3(0.0));
}

vec3 environmentDiffuse(vec3 normal) {
  vec3 n = rotateEnvironment(normal);
  vec3 key = keyDirection();
  vec3 back = backDirection();
  float up = saturate(n.y * 0.5 + 0.5);
  vec3 col = mix(vec3(0.052, 0.06, 0.069), vec3(0.235, 0.27, 0.3), smoothstep(0.18, 0.92, up));
  col += vec3(0.045, 0.033, 0.023) * exp(-abs(n.y + 0.04) * 7.0);

  float keyCos = saturate(dot(n, key));
  float backCos = saturate(dot(n, back));
  col += vec3(0.94, 0.9, 0.83) * pow(keyCos, 1.45) * 0.62;
  col += vec3(0.52, 0.46, 0.38) * pow(backCos, 2.0) * 0.38;
  col += vec3(0.08, 0.11, 0.16) * pow(saturate(dot(n, stripDirection())), 1.7);
  return col;
}

float distributionGGX(float noH, float alpha) {
  float a2 = alpha * alpha;
  float denominator = noH * noH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * denominator * denominator, 1e-7);
}

float geometrySmith(float noV, float noL, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  float gv = noV / (noV * (1.0 - k) + k);
  float gl = noL / (noL * (1.0 - k) + k);
  return gv * gl;
}

vec3 fresnelSchlick(float cosTheta, vec3 f0) {
  return f0 + (1.0 - f0) * pow(saturate(1.0 - cosTheta), 5.0);
}

vec3 fresnelSchlickRoughness(float cosTheta, vec3 f0, float roughness) {
  return f0 + (max(vec3(1.0 - roughness), f0) - f0) * pow(saturate(1.0 - cosTheta), 5.0);
}

vec2 sphericalUV(vec3 normal) {
  float u = atan(normal.z, normal.x) / TAU + 0.5;
  float v = asin(clamp(normal.y, -1.0, 1.0)) / PI + 0.5;
  return vec2(u, v);
}

float proceduralHeight(vec2 uv) {
  float broad = sin(uv.x * 78.0 + sin(uv.y * 17.0) * 2.8);
  float crossWave = sin(uv.y * 132.0 + uv.x * 21.0);
  float fine = sin((uv.x + uv.y) * 245.0 + cos(uv.y * 31.0) * 1.5);
  return broad * 0.52 + crossWave * 0.29 + fine * 0.12;
}

vec3 perturbLocalNormal(vec3 geometricNormal) {
  if (u_showNormal == 0 || u_normalStrength <= 0.001) {
    return geometricNormal;
  }

  vec3 up = abs(geometricNormal.y) < 0.94 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(up, geometricNormal));
  vec3 bitangent = normalize(cross(geometricNormal, tangent));
  vec2 uv = sphericalUV(geometricNormal);
  float epsilon = 0.0012;
  float center = proceduralHeight(uv);
  float du = (proceduralHeight(uv + vec2(epsilon, 0.0)) - center) / epsilon;
  float dv = (proceduralHeight(uv + vec2(0.0, epsilon)) - center) / epsilon;
  vec2 slope = vec2(du, dv) * 0.0021 * u_normalStrength;
  return normalize(geometricNormal - tangent * slope.x - bitangent * slope.y);
}

bool intersectSphere(vec3 origin, vec3 direction, vec3 center, float radius, out float distance) {
  vec3 oc = origin - center;
  float b = dot(oc, direction);
  float c = dot(oc, oc) - radius * radius;
  float h = b * b - c;
  if (h < 0.0) {
    distance = 1e20;
    return false;
  }
  float root = sqrt(h);
  float nearHit = -b - root;
  float farHit = -b + root;
  distance = nearHit > 0.001 ? nearHit : farHit;
  return distance > 0.001;
}

float sphereSoftShadow(vec3 origin, vec3 direction, vec3 center, float radius) {
  vec3 oc = origin - center;
  float b = dot(oc, direction);
  float c = dot(oc, oc) - radius * radius;
  float h = b * b - c;
  if (h < 0.0 || b > 0.0) {
    return 1.0;
  }
  float separation = sqrt(h);
  return smoothstep(0.0, radius * 0.92, separation);
}

vec3 shadeSphere(vec3 position, vec3 geometricNormal, vec3 rayDirection, int materialIndex) {
  vec3 baseColor = u_baseColor[materialIndex];
  float roughness = clamp(u_materialProps[materialIndex].x, 0.03, 1.0);
  float metalness = clamp(u_materialProps[materialIndex].y, 0.0, 1.0);
  float alpha = max(roughness * roughness, 0.0018);
  vec3 normal = perturbLocalNormal(geometricNormal);
  vec3 viewDirection = -rayDirection;
  float noV = max(dot(normal, viewDirection), 0.001);
  vec3 f0 = mix(vec3(0.04), baseColor, metalness);
  vec3 result = vec3(0.0);
  vec3 lightColor = vec3(3.25, 3.3, 3.35);
  vec3 lightDirection = keyDirection();
  float noL = saturate(dot(normal, lightDirection));

  if (u_showDirect == 1 && noL > 0.0) {
    vec3 halfVector = normalize(lightDirection + viewDirection);
    float noH = saturate(dot(normal, halfVector));
    float voH = saturate(dot(viewDirection, halfVector));
    vec3 fresnel = fresnelSchlick(voH, f0);
    float distribution = distributionGGX(noH, alpha);
    float geometry = geometrySmith(noV, noL, roughness);
    vec3 specular = (distribution * geometry * fresnel) / max(4.0 * noV * noL, 1e-6);
    vec3 diffuseWeight = (vec3(1.0) - fresnel) * (1.0 - metalness);

    if (u_showDiffuse == 1) {
      result += diffuseWeight * baseColor / PI * lightColor * noL;
    }
    if (u_showSpecular == 1) {
      result += specular * lightColor * noL;
    }
  }

  if (u_showIBL == 1) {
    vec3 reflected = reflect(-viewDirection, normal);
    vec3 environment = environmentRadiance(reflected, roughness);
    vec3 fresnel = fresnelSchlickRoughness(noV, f0, roughness);
    vec3 diffuseWeight = (vec3(1.0) - fresnel) * (1.0 - metalness);

    if (u_showDiffuse == 1) {
      result += diffuseWeight * baseColor * environmentDiffuse(normal);
    }
    if (u_showSpecular == 1) {
      result += environment * fresnel * mix(0.88, 0.7, roughness);
    }
  }

  return max(result, vec3(0.0));
}

vec3 shadeFloor(vec3 position, vec3 rayDirection) {
  vec3 normal = vec3(0.0, 1.0, 0.0);
  vec3 baseColor = vec3(0.145, 0.132, 0.12);
  float radial = length(position.xz - vec2(-0.35, 0.2));
  baseColor *= mix(1.06, 0.56, smoothstep(0.2, 6.8, radial));
  vec3 lightDirection = keyDirection();
  float noL = saturate(dot(normal, lightDirection));
  float shadow = 1.0;
  for (int i = 0; i < 3; i++) {
    shadow *= sphereSoftShadow(position + normal * 0.004, lightDirection, gSphereCenters[i], gSphereRadius * 1.02);
  }

  vec3 result = vec3(0.0);
  if (u_showDiffuse == 1) {
    vec3 diffuse = baseColor / PI * vec3(2.55, 2.6, 2.65) * noL * shadow;
    result += diffuse + baseColor * environmentDiffuse(normal) * 0.74;
  }
  if (u_showSpecular == 1 && u_showIBL == 1) {
    vec3 reflected = reflect(rayDirection, normal);
    result += environmentRadiance(reflected, 0.58) * 0.035;
  }
  return result;
}

void main() {
  vec2 screen = (gl_FragCoord.xy * 2.0 - u_resolution) / u_resolution.y;
  vec3 rayDirection = normalize(u_cameraBasis * vec3(screen, u_focal));
  vec3 rayOrigin = u_cameraPos;
  float nearest = 1e20;
  int materialIndex = -1;

  for (int i = 0; i < 3; i++) {
    float hitDistance;
    if (intersectSphere(rayOrigin, rayDirection, gSphereCenters[i], gSphereRadius, hitDistance)) {
      if (hitDistance < nearest) {
        nearest = hitDistance;
        materialIndex = i;
      }
    }
  }

  float floorDistance = 1e20;
  if (rayDirection.y < -0.0001) {
    float floorHit = (FLOOR_Y - rayOrigin.y) / rayDirection.y;
    if (floorHit > 0.001) {
      floorDistance = floorHit;
    }
  }

  vec3 hdr;
  float materialMask = 0.0;
  if (materialIndex >= 0 && nearest < floorDistance) {
    vec3 position = rayOrigin + rayDirection * nearest;
    vec3 geometricNormal = normalize(position - gSphereCenters[materialIndex]);
    hdr = shadeSphere(position, geometricNormal, rayDirection, materialIndex);
    materialMask = float(materialIndex + 1);
  } else if (floorDistance < 1e19) {
    vec3 position = rayOrigin + rayDirection * floorDistance;
    hdr = shadeFloor(position, rayDirection);
  } else {
    hdr = environmentBackground(rayDirection);
  }

  if (u_statsPass == 1) {
    fragColor = vec4(clamp(hdr, 0.0, 65504.0), materialMask);
  } else {
    fragColor = vec4(displayTransform(hdr), 1.0);
  }
}
`;
