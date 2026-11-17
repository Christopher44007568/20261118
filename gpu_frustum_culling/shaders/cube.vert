#version 450

// Indirect-rendered cubes. gl_InstanceIndex indexes into the compacted
// VisibleIndices buffer, so only culled-visible instances are drawn.

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;

struct InstanceData {
    vec4 center;
    vec4 color;
};

layout(set = 0, binding = 0) readonly buffer Instances {
    InstanceData instances[];
};

layout(set = 0, binding = 1) readonly buffer VisibleIndices {
    uint visibleIndices[];
};

layout(std140, set = 0, binding = 3) uniform CullParams {
    mat4 viewProj;
    vec4 frustumPlanes[6];
    uint totalInstances;
    uint gpuCullingEnabled;
    uint pad0;
    uint pad1;
};

layout(location = 0) out vec3 outColor;
layout(location = 1) out vec3 outNormal;

void main() {
    uint originalInstanceId = visibleIndices[gl_InstanceIndex];
    InstanceData inst = instances[originalInstanceId];

    vec3 worldPos = inPosition * inst.center.w + inst.center.xyz;
    gl_Position = viewProj * vec4(worldPos, 1.0);
    outColor = inst.color.rgb;
    outNormal = inNormal;
}
