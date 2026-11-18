#version 300 es
precision highp float;
uniform vec3 uAlbedo;
in float vViewDepth;
layout(location = 0) out vec4 outColor;   // rgb = albedo
layout(location = 1) out float outDepth; // view-space linear depth (positive)
void main() {
  outColor = vec4(uAlbedo, 1.0);
  // Hardware depth keeps hidden-surface correctness; this target carries
  // linear depth for stable position/normal reconstruction.
  outDepth = vViewDepth;
}
