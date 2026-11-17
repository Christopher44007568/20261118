// 参考副本：运行时实际加载 js/shaders.js 中的同名内联 WGSL（内容保持一致）

struct Uniforms {
  viewProj : mat4x4<f32>,
  planes : array<vec4<f32>, 6>,
  totalCount : u32,
  candidateCount : u32,
  _pad0 : u32,
  _pad1 : u32,
};

struct InstanceData {
  model : mat4x4<f32>,
  cx : f32, cy : f32, cz : f32,
  hx : f32, hy : f32, hz : f32,
  r : f32, g : f32, b : f32,
  category : u32,
};

struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
};

struct VertexOutput {
  @builtin(position) clip : vec4<f32>,
  @location(0) color : vec3<f32>,
  @location(1) normalW : vec3<f32>,
};

@group(0) @binding(0) var<uniform> uni : Uniforms;
@group(0) @binding(1) var<storage, read> instances : array<InstanceData>;
@group(0) @binding(2) var<storage, read> visibleIndices : array<u32>;

@vertex
fn vsMain(in : VertexInput, @builtin(instance_index) instanceIndex : u32) -> VertexOutput {
  let instanceId = visibleIndices[instanceIndex];
  let it = instances[instanceId];
  let worldPos = it.model * vec4<f32>(in.position, 1.0);
  var out : VertexOutput;
  out.clip = uni.viewProj * worldPos;
  out.color = vec3<f32>(it.r, it.g, it.b);
  // 法线只受模型矩阵的旋转部分影响（本场景无缩放）
  out.normalW = normalize((it.model * vec4<f32>(in.normal, 0.0)).xyz);
  return out;
}

@fragment
fn fsMain(in : VertexOutput) -> @location(0) vec4<f32> {
  let lightDir = normalize(vec3<f32>(-0.4, 0.9, 0.6));
  let lit = clamp(dot(normalize(in.normalW), lightDir), 0.28, 1.0);
  return vec4<f32>(in.color * lit, 1.0);
}
