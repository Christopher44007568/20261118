#version 300 es
// Geometry prep fragment shader.
//
// Two prep renders share this shader:
//   * back-face pass  (CullFace = FRONT): stores the far/back surface depth
//   * front-face pass (CullFace = BACK) : stores the near/front surface depth
// The lighting pass reconstructs both view positions and converts their
// separation into an optical thickness in world units, normalised by a
// material-specific scale.
precision highp float;

in vec3 vViewPos;
in vec3 vViewNormal;
in vec3 vWorldPos;

layout(location = 0) out vec4 outViewPos;   // xyz view pos, w = linear depth
layout(location = 1) out vec4 outNormal;    // xyz view normal, w unused

void main() {
    // Store positive linear eye-space depth: the far/back surface always has
    // a larger value than the near/front surface, so backDepth-frontDepth is
    // a non-negative optical path length.
    float linearDepth = -vViewPos.z;
    outViewPos = vec4(vViewPos, linearDepth);
    outNormal = vec4(normalize(vViewNormal), 1.0);
}
