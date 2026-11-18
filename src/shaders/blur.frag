#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uAo;
uniform sampler2D uDepth;
uniform vec2 uTexelSize;
uniform float uDepthEdge;

// Tight 3x3 edge-preserving (bilateral) blur: removes per-pixel sampling
// noise while keeping contact shadows and depth silhouettes intact.
void main() {
  float centerDepth = texture(uDepth, vUv).r;
  float total = 0.0, weightSum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * uTexelSize;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
      float d = texture(uDepth, uv).r;
      float w = (x == 0 && y == 0) ? 4.0 : (abs(x) + abs(y) == 1 ? 2.0 : 1.0);
      // Tighter depth reference so samples across a sloped but continuous
      // surface are averaged, while real silhouettes stay sharp.
      float depthRef = uDepthEdge * max(centerDepth, 1e-4) * 1.5;
      w *= 1.0 - smoothstep(depthRef, depthRef * 2.0, abs(d - centerDepth));
      total += texture(uAo, uv).r * w;
      weightSum += w;
    }
  }
  outColor = vec4(vec3(total / max(weightSum, 1e-4)), 1.0);
}
