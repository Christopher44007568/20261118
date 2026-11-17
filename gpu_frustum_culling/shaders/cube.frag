#version 450

layout(location = 0) in vec3 inColor;
layout(location = 1) in vec3 inNormal;

layout(location = 0) out vec4 outColor;

void main() {
    vec3 lightDir = normalize(vec3(0.4, 0.8, 0.5));
    float diffuse = clamp(dot(normalize(inNormal), lightDir), 0.0, 1.0);
    outColor = vec4(inColor * (0.35 + 0.65 * diffuse), 1.0);
}
