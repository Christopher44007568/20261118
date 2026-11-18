#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat4 uView;
out float vViewDepth;
void main() {
  vec4 viewPos = uView * uModel * vec4(aPosition, 1.0);
  vViewDepth = -viewPos.z; // positive linear depth in front of the camera
  gl_Position = uViewProj * uModel * vec4(aPosition, 1.0);
}
