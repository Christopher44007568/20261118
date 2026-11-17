// WGSL 源码以模块字符串内联，避免 file:// 下 fetch 本地文件受限

export const cullWGSL = /* wgsl */ `
// 第二阶段：Compute Shader 对 CPU 候选实例执行视锥测试，写回可见实例索引

struct Uniforms {
  viewProj : mat4x4<f32>,
  planes   : array<vec4<f32>, 6>,
  totalCount : u32,
  candidateCount : u32,
  _pad0 : u32,
  _pad1 : u32,
};

// 显式紧凑布局，与 js/gpu.js 的 28 个 f32 逐字段对应
// 用独立 f32 而非 vec3，规避 WGSL storage 结构体内 vec3 的 16 字节对齐填充
struct InstanceData {
  model : mat4x4<f32>,                       // 0..15
  cx : f32, cy : f32, cz : f32,              // 16..18
  hx : f32, hy : f32, hz : f32,              // 19..21
  r : f32, g : f32, b : f32,                 // 22..24
  category : u32,                            // 25
};

@group(0) @binding(0) var<uniform> uni : Uniforms;
@group(0) @binding(1) var<storage, read> instances : array<InstanceData>;
@group(0) @binding(2) var<storage, read> candidates : array<u32>;
@group(0) @binding(3) var<storage, read_write> visibleIndices : array<u32>;
@group(0) @binding(4) var<storage, read_write> counters : array<atomic<u32>>;

// 与 js/math.js 的 aabbInFrustum 逐运算对应；不使用 dot() 以避免 FMA 收缩差异
fn aabbInFrustum(center : vec3<f32>, half : vec3<f32>) -> bool {
  for (var i = 0u; i < 6u; i++) {
    let p = uni.planes[i];
    let hx = select(-half.x, half.x, p.x > 0.0);
    let hy = select(-half.y, half.y, p.y > 0.0);
    let hz = select(-half.z, half.z, p.z > 0.0);
    let px = p.x * (center.x + hx);
    let py = p.y * (center.y + hy);
    let pz = p.z * (center.z + hz);
    let d = ((px + py) + pz) + p.w;
    if (d < 0.0) {
      return false;
    }
  }
  return true;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let index = gid.x;
  if (index >= uni.candidateCount) {
    return;
  }
  let instanceId = candidates[index];
  let it = instances[instanceId];
  if (aabbInFrustum(vec3<f32>(it.cx, it.cy, it.cz), vec3<f32>(it.hx, it.hy, it.hz))) {
    let slot = atomicAdd(&counters[0], 1u);
    visibleIndices[slot] = instanceId;
  }
}
`;

export const finalizeWGSL = /* wgsl */ `
// 用可见数填充 drawIndirect 参数（vertexCount 与 instanceCount）

struct DrawIndirectArgs {
  vertexCount : u32,
  instanceCount : u32,
  firstVertex : u32,
  firstInstance : u32,
};

struct Counters {
  visibleCount : atomic<u32>,
};

@group(0) @binding(0) var<storage, read_write> counters : Counters;
@group(0) @binding(1) var<storage, read_write> indirect : DrawIndirectArgs;

@compute @workgroup_size(1)
fn main() {
  let count = atomicLoad(&counters.visibleCount);
  indirect.vertexCount = 36u;      // 立方体：12 三角形 * 3
  indirect.instanceCount = count;
  indirect.firstVertex = 0u;
  indirect.firstInstance = 0u;
}
`;

export const renderWGSL = /* wgsl */ `
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
`;
