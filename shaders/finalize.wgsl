// 参考副本：运行时实际加载 js/shaders.js 中的同名内联 WGSL（内容保持一致）

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
