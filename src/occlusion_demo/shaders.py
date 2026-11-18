"""演示使用的 GLSL 着色器源码。"""

# 每实例属性：i_model(mat4)、i_color(vec3)、i_kind(float 选择简单法线/光照)
MESH_VS = """
#version 450 core

layout(location = 0) in vec3 in_pos;
layout(location = 1) in vec3 in_normal;

layout(location = 2) in mat4 i_model;
layout(location = 6) in vec3 i_color;

uniform mat4 u_view;
uniform mat4 u_proj;

out vec3 v_normal;
out vec3 v_world;
out vec3 v_color;

void main() {
    vec4 world = i_model * vec4(in_pos, 1.0);
    v_world = world.xyz;
    v_normal = mat3(i_model) * in_normal;
    v_color = i_color;
    gl_Position = u_proj * u_view * world;
}
"""

MESH_FS = """
#version 450 core

in vec3 v_normal;
in vec3 v_world;
in vec3 v_color;

uniform vec3 u_light_dir;
uniform vec3 u_camera_pos;

out vec4 f_color;

void main() {
    vec3 n = normalize(v_normal);
    vec3 l = normalize(u_light_dir);
    float diffuse = max(dot(n, l), 0.0);
    float ambient = 0.35;
    vec3 view_dir = normalize(u_camera_pos - v_world);
    vec3 half_vec = normalize(l + view_dir);
    float spec = 0.25 * pow(max(dot(n, half_vec), 0.0), 24.0);
    vec3 color = v_color * (ambient + 0.75 * diffuse) + vec3(spec);
    f_color = vec4(color, 1.0);
}
"""

# 全屏带纹理四边形（HUD 叠加层与差异图）
QUAD_VS = """
#version 450 core

layout(location = 0) in vec2 in_pos;
layout(location = 1) in vec2 in_uv;

out vec2 v_uv;

void main() {
    v_uv = in_uv;
    gl_Position = vec4(in_pos, 0.0, 1.0);
}
"""

QUAD_FS = """
#version 450 core

in vec2 v_uv;

uniform sampler2D u_tex;
uniform float u_alpha;

out vec4 f_color;

void main() {
    vec4 tex = texture(u_tex, v_uv);
    f_color = vec4(tex.rgb, tex.a * u_alpha);
}
"""

# 差异图：A 与 B 不同处显示为洋红色
DIFF_FS = """
#version 450 core

in vec2 v_uv;

uniform sampler2D u_tex_a;
uniform sampler2D u_tex_b;
uniform float u_threshold;
uniform vec2 u_texel;

out vec4 f_color;

void main() {
    vec3 a = texture(u_tex_a, v_uv).rgb;
    vec3 b = texture(u_tex_b, v_uv).rgb;
    float d = max(abs(a.r - b.r), max(abs(a.g - b.g), abs(a.b - b.b)));
    bool hit = d > u_threshold;
    // 3x3 邻域膨胀，让孤立的亚像素差异在压缩视频中依然可见。
    for (int x = -1; x <= 1 && !hit; ++x) {
        for (int y = -1; y <= 1 && !hit; ++y) {
            vec2 off = vec2(float(x), float(y)) * u_texel;
            vec3 aa = texture(u_tex_a, v_uv + off).rgb;
            vec3 bb = texture(u_tex_b, v_uv + off).rgb;
            float dd = max(abs(aa.r - bb.r), max(abs(aa.g - bb.g), abs(aa.b - bb.b)));
            hit = dd > u_threshold;
        }
    }
    if (hit) {
        f_color = vec4(1.0, 0.0, 0.85, 1.0);
    } else {
        f_color = vec4(a * 0.55, 1.0);
    }
}
"""
