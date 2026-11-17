#version 330 core
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_tint;
uniform mat4 u_view_proj;
out vec3 v_tint;
out vec3 v_world;
void main() {
    v_world = a_pos;
    v_tint = a_tint;
    gl_Position = u_view_proj * vec4(a_pos, 1.0);
}
