#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uColor;   // g-buffer albedo
uniform sampler2D uAo;      // r = ao, g = skipped fraction
uniform sampler2D uNormal;  // encoded view normal
uniform sampler2D uDepth;
uniform int uViewMode;      // 0 = composite, 1 = ao only, 2 = boundary debug, 3 = normals
uniform vec3 uLightDirView;

void main() {
  float ao = texture(uAo, vUv).r;
  float depth = texture(uDepth, vUv).r;

  if (depth <= 0.0) {
    outColor = vec4(0.06, 0.07, 0.09, 1.0); // background
    return;
  }

  if (uViewMode == 1) {
    outColor = vec4(vec3(ao), 1.0);
    return;
  }

  if (uViewMode == 2) {
    // Red marks samples that had to skip off-screen data.
    float skipped = texture(uAo, vUv).g;
    outColor = vec4(skipped, ao * 0.6, ao, 1.0);
    return;
  }

  if (uViewMode == 3) {
    outColor = vec4(texture(uNormal, vUv).rgb, 1.0);
    return;
  }

  vec3 albedo = texture(uColor, vUv).rgb;
  vec3 normal = texture(uNormal, vUv).rgb * 2.0 - 1.0;
  float diffuse = max(dot(normalize(normal), normalize(uLightDirView)), 0.0);
  vec3 ambient = albedo * 0.35;
  vec3 direct = albedo * diffuse * 0.75;
  // SSAO modulates the ambient/indirect term only.
  vec3 lit = direct + ambient * ao;
  outColor = vec4(pow(lit, vec3(1.0 / 2.2)), 1.0);
}
