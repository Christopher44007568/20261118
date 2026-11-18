#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // Fullscreen triangle with UV aligned to gl_FragCoord.xy / viewportSize,
  // i.e. origin at the lower-left, so texture(vUv) matches framebuffer px.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
