// 两阶段可见性裁剪引擎
// 阶段一(CPU)：世界 AABB 视锥测试 -> 候选索引
// 阶段二(GPU Compute)：对候选再做相同视锥测试 -> 可见索引 + indirect draw

import { f32, extractFrustumPlanes, aabbInFrustum, perspective, lookAt, mulMat4 } from './math.js';
import { INSTANCE_STRIDE, writeInstance } from './gpu.js';

// mat4(16 float) + planes[6](24 float) + 元数据(4 float) = 44 float，缓冲按 16 字节对齐取 96 float
export const UNIFORM_SIZE = 384;
const COUNTER_SIZE = 16;
const INDIRECT_SIZE = 16;

export class VisibilityEngine {
  constructor(device, pipelines, instances, cube) {
    this.device = device;
    this.pipelines = pipelines;
    this.instances = instances;
    this.cube = cube;
    this.max = instances.length;

    this.uniform = device.createBuffer({ size: UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.instanceBuffer = device.createBuffer({
      size: this.max * INSTANCE_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.candidateBuffer = device.createBuffer({
      size: this.max * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.visibleBuffer = device.createBuffer({
      size: this.max * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.counterBuffer = device.createBuffer({
      size: COUNTER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.indirectBuffer = device.createBuffer({
      size: INDIRECT_SIZE,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.cullBindGroup = device.createBindGroup({
      layout: pipelines.cull.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
        { binding: 2, resource: { buffer: this.candidateBuffer } },
        { binding: 3, resource: { buffer: this.visibleBuffer } },
        { binding: 4, resource: { buffer: this.counterBuffer } },
      ],
    });
    this.finalizeBindGroup = device.createBindGroup({
      layout: pipelines.finalize.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.counterBuffer } },
        { binding: 1, resource: { buffer: this.indirectBuffer } },
      ],
    });
    this.renderBindGroup = device.createBindGroup({
      layout: pipelines.render.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
        { binding: 2, resource: { buffer: this.visibleBuffer } },
      ],
    });

    // 多帧解耦回读：渲染侧只拷贝到 staging，异步侧负责 map/unmap
    this.slotCount = 8;
    this.readbackSlots = Array.from({ length: this.slotCount }, () => ({
      buffer: device.createBuffer({
        size: this.max * 4 + COUNTER_SIZE,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      busy: false,
      frame: -1,
      cpuSet: null,
      cpuCount: 0,
    }));
    this.drainReadback();
    this.frameIndex = 0;

    this.cpuCandidates = [];
    this.cpuVisible = [];
    this.gpuVisible = [];
    this.lastConsistency = null;
  }

  buildViewProj(camera, aspect) {
    const proj = perspective(f32((50 * Math.PI) / 180), f32(aspect), 0.5, 120);
    const view = lookAt(camera.eye, camera.center, camera.up);
    return mulMat4(proj, view);
  }

  // 阶段一：CPU 世界 AABB 视锥剔除
  cpuCull(planes) {
    const candidates = [];
    const visible = [];
    for (const inst of this.instances) {
      if (aabbInFrustum(inst.world.center, inst.world.half, planes)) {
        candidates.push(inst.id);
        visible.push(inst.id);
      }
    }
    this.cpuCandidates = candidates;
    this.cpuVisible = visible;
    return candidates;
  }

  frame(camera, aspect, encoder) {
    const vp = this.buildViewProj(camera, aspect);
    const planes = extractFrustumPlanes(vp);
    const candidates = this.cpuCull(planes);

    // 上传实例与候选
    for (const inst of this.instances) {
      writeInstance(this.device, this.instanceBuffer, inst.id * 28, inst);
    }
    const candidateArray = new Uint32Array(this.max);
    candidateArray.set(candidates, 0);
    this.device.queue.writeBuffer(this.candidateBuffer, 0, candidateArray);

    // 与 WGSL Uniforms 对齐：mat4(16f) + planes[6](24f) + 元数据(4f)
    const uniformData = new Float32Array(UNIFORM_SIZE / 4);
    uniformData.set(vp, 0);
    const meta = new Uint32Array(uniformData.buffer);
    meta[40] = this.max;
    meta[41] = candidates.length;
    for (let i = 0; i < 6; i++) {
      uniformData.set(planes[i], 16 + i * 4);
    }
    this.device.queue.writeBuffer(this.uniform, 0, uniformData);

    // 计数器清零
    this.device.queue.writeBuffer(this.counterBuffer, 0, new Uint32Array(4));

    // 阶段二：compute 视锥测试 + indirect 参数生成
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.cull);
    pass.setBindGroup(0, this.cullBindGroup);
    pass.dispatchWorkgroups(Math.ceil(candidates.length / 64));
    pass.setPipeline(this.pipelines.finalize);
    pass.setBindGroup(0, this.finalizeBindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();

    this.queueReadback(encoder);
    this.frameIndex++;
    return { candidateCount: candidates.length };
  }

  // 渲染侧：把当前结果拷贝到一个空闲 staging（仅 copy，不 map）
  queueReadback(encoder) {
    const slot = this.readbackSlots.find((s) => !s.busy);
    if (!slot) return;
    encoder.copyBufferToBuffer(this.visibleBuffer, 0, slot.buffer, 0, this.max * 4);
    encoder.copyBufferToBuffer(this.counterBuffer, 0, slot.buffer, this.max * 4, COUNTER_SIZE);
    slot.frame = this.frameIndex;
    slot.cpuSet = new Set(this.cpuVisible);
    slot.cpuCount = this.cpuVisible.length;
    slot.busy = true;
  }

  // 异步消费侧：等 GPU 完成已提交工作后再 map，与渲染提交完全解耦
  async drainReadback() {
    for (;;) {
      await this.device.queue.onSubmittedWorkDone();
      await new Promise((r) => setTimeout(r, 0));
      for (const slot of this.readbackSlots) {
        if (!slot.busy || slot.buffer.mapState !== 'unmapped') continue;
        await slot.buffer.mapAsync(GPUMapMode.READ);
        const raw = new Uint32Array(slot.buffer.getMappedRange());
        const gpuCount = raw[this.max];
        const gpuSet = new Set(raw.slice(0, gpuCount));
        const missing = [...slot.cpuSet].filter((id) => !gpuSet.has(id));
        const extra = [...gpuSet].filter((id) => !slot.cpuSet.has(id));
        this.gpuVisible = [...gpuSet].sort((a, b) => a - b);
        this.lastConsistency = {
          frame: slot.frame,
          cpuCount: slot.cpuCount,
          gpuCount,
          match: missing.length === 0 && extra.length === 0,
          missing,
          extra,
        };
        slot.buffer.unmap();
        slot.busy = false;
      }
    }
  }
}
