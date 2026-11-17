#version 330 core

// Base blade mesh (a few verts only).
layout(location=0) in vec3 a_local;   // xz: half-width offsets, y: 0..1 height
layout(location=1) in vec3 a_normal;
// Per-instance, uploaded once per chunk.
layout(location=2) in vec4 i_root_rot;     // xyz root, w yaw
layout(location=3) in vec4 i_height_phase; // x height scale, w wind phase

uniform mat4 u_view_proj;
uniform float u_time;
uniform float u_wind_enabled; // 0 static, 1 dynamic
uniform vec3  u_wind_dir;     // normalized horizontal wind direction
uniform float u_wind_amp;     // world-space bend at the blade tip
uniform float u_fade;         // chunk edge fade 0..1
uniform float u_bush;         // 0 grass blade, 1 bush

out vec3 v_normal;
out float v_height;
out float v_fade;

void main() {
    vec3 root = i_root_rot.xyz;
    float yaw = i_root_rot.w;
    float c = cos(yaw), s = sin(yaw);

    // Rotate the local cross-section around Y, keep the height axis intact.
    vec2 lx = a_local.xz;
    vec2 rx = vec2(c * lx.x - s * lx.y, s * lx.x + c * lx.y);
    float h = a_local.y * i_height_phase.x;
    vec3 world = vec3(root.x + rx.x, root.y + h, root.z + rx.y);

    // Wind: bend weight is v^2 -> exactly 0 at the root (v=0), so the base
    // can never drift; only the upper portion of the blade/bush moves.
    float v = a_local.y;
    float bend_w = v * v;
    float gust = sin(u_time * 2.1 + i_height_phase.w
                     + root.x * 0.12 + root.z * 0.17);
    float flutter = 0.35 * sin(u_time * 5.3 + i_height_phase.w * 1.7);
    float wind = (gust + flutter) * u_wind_amp * u_wind_enabled;
    // Bushes sway around their trunk base with the same root-pinned rule.
    float scale = mix(1.0, 0.55, u_bush);
    world.xz += u_wind_dir.xz * (wind * bend_w * scale);

    v_normal = a_normal;
    v_height = v;
    v_fade = u_fade;
    gl_Position = u_view_proj * vec4(world, 1.0);
}
