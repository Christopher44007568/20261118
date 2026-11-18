#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outNormal;

uniform sampler2D uDepth;      // R32F linear view depth
uniform vec2 uTexelSize;       // 1 / resolution
uniform mat4 uProj;            // projection (for unit-ray coefficients)
uniform float uDepthEdge;      // relative depth-discontinuity threshold

vec3 viewPosition(vec2 uv) {
  float z = texture(uDepth, uv).r;
  // Unit-depth view ray (z = -1) from projection coefficients, scaled by
  // linear depth. Avoids the near-plane factor in an inverse unproject.
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 ray = vec3(ndc.x / uProj[0][0], ndc.y / uProj[1][1], -1.0);
  return ray * z;
}

void main() {
  vec2 px = uTexelSize;
  vec3 p  = viewPosition(vUv);
  vec3 pr  = viewPosition(vUv + vec2(px.x, 0.0));
  vec3 pl  = viewPosition(vUv - vec2(px.x, 0.0));
  vec3 pt  = viewPosition(vUv + vec2(0.0, px.y));
  vec3 pb  = viewPosition(vUv - vec2(0.0, px.y));

  float z = max(texture(uDepth, vUv).r, 1e-4);
  // Neighbours across a depth discontinuity belong to another surface and
  // must not define this pixel's normal (edge guard, avoids flat-normals
  // bleeding onto curved geometry near silhouettes).
  bvec2 sx = bvec2(
    abs(pr.z - p.z) < uDepthEdge * z,
    abs(pl.z - p.z) < uDepthEdge * z
  );
  bvec2 sy = bvec2(
    abs(pt.z - p.z) < uDepthEdge * z,
    abs(pb.z - p.z) < uDepthEdge * z
  );

  vec3 dx = sx.x ? (pr - p) : (p - pl);
  if (!sx.x && !sx.y) dx = pr - pl;
  vec3 dy = sy.x ? (pt - p) : (p - pb);
  if (!sy.x && !sy.y) dy = pt - pb;

  vec3 n = normalize(cross(dy, dx));
  // View space looks down -Z; force the normal toward the viewer.
  if (n.z > 0.0) n = -n;

  // Encode signed normal into [0,1] RGB.
  outNormal = vec4(n * 0.5 + 0.5, 1.0);
}
