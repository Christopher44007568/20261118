#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;

out vec3 vViewPos;
out vec3 vViewNormal;
out vec3 vWorldNormal;
out vec3 vWorldPos;

void main() {
    vec4 viewPos = uView * uModel * vec4(aPosition, 1.0);
    vViewPos = viewPos.xyz;
    vViewNormal = mat3(uView * uModel) * aNormal;
    vWorldNormal = normalize(mat3(uModel) * aNormal);
    vWorldPos = (uModel * vec4(aPosition, 1.0)).xyz;
    gl_Position = uProj * viewPos;
}
