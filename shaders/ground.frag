#version 330 core
in vec3 v_tint;
in vec3 v_world;
out vec4 frag;
void main() {
    // Subtle slope-independent shading keeps the terrain silhouette readable
    // in the coverage/density validation screenshots.
    float shade = 0.85 + 0.15 * sin(v_world.x * 0.05) * cos(v_world.z * 0.05);
    frag = vec4(v_tint * shade, 1.0);
}
