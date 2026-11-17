#version 330 core
in vec3 v_normal;
in float v_height;
in float v_fade;
uniform float u_bush;
uniform vec3 u_cam_pos;
out vec4 frag;
void main() {
    // Vertical gradient: darker soil-toned base, brighter tip/foliage.
    vec3 grass_lo = vec3(0.10, 0.20, 0.06);
    vec3 grass_hi = vec3(0.32, 0.52, 0.16);
    vec3 bush_lo  = vec3(0.16, 0.12, 0.06);
    vec3 bush_hi  = vec3(0.22, 0.34, 0.10);
    vec3 lo = mix(grass_lo, bush_lo, u_bush);
    vec3 hi = mix(grass_hi, bush_hi, u_bush);
    vec3 col = mix(lo, hi, v_height);
    float ndl = clamp(dot(normalize(v_normal),
                          normalize(vec3(0.4, 0.8, 0.3))), 0.35, 1.0);
    col *= ndl;
    // Alpha fade at chunk borders prevents whole-chunk pop-in.
    float alpha = mix(1.0, v_fade, 0.85);
    if (alpha < 0.02) discard;
    frag = vec4(col, alpha);
}
