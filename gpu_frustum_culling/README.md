# GPU Frustum Culling → Indirect Draw (Vulkan)

在 GPU 上对一万个实例做包围球视锥裁剪，把可见实例索引压缩进 storage
buffer，并由计算着色器直接写 `VkDrawIndexedIndirectCommand`，随后用
`vkCmdDrawIndexedIndirect` 只绘制可见实例。

## 设计要点

- **一次性上传**：`InstanceData[]`（10000 个，320 KB）只在启动时通过
  staging buffer 上传一次。相机移动时每帧只更新小 UBO（视图投影矩阵 +
  6 个视锥平面 + 开关位）并重跑 compute 查询，实例数组永远不重传。
  材质/几何不变时没有任何实例数据上传流量。
- **GPU 裁剪**：`shaders/cull.comp` 每个 invocation 处理一个实例，对 6 个
  平面做包围球测试；可见时 `atomicAdd` 抢占槽位，把实例索引写入
  `VisibleIndices`，同一个原子计数器即 indirect 命令的 `instanceCount`。
- **间接绘制**：顶点着色器用 `gl_InstanceIndex` 查 `VisibleIndices` 还原
  原始实例。indirect 命令的 `indexCount/firstIndex/...` 是静态字段，只写
  一次；每帧只 `vkCmdFillBuffer` 清零 `instanceCount` 这一个 dword。
- **零可见实例**：`instanceCount == 0` 的 indirect draw 在 Vulkan 规范中
  是合法 no-op，命令直接跳过，不会产生校验错误或崩溃。测试用远平面外的
  相机验证这一点，并连跑两帧确认计数器清零正确。
- **用户开关**：UBO 中的 `gpuCullingEnabled` 为 0 时 compute 放行全部
  实例，可直接对比裁剪开/关的绘制数量与画面差异。
- **同步**：compute 写可见索引/indirect 计数后，用 buffer memory barrier
  转到 `INDIRECT_COMMAND_READ` / 顶点着色器读取阶段。

## 目录

- `shaders/cull.comp` — 视锥裁剪 compute（local size 256）
- `shaders/cube.vert` / `cube.frag` — 索引驱动的立方体渲染
- `src/vk_core.cpp` — 设备、缓冲、管线与每帧录制
- `src/reference_culler.cpp` — 独立的 CPU 参考实现（Gribb-Hartmann 平面提取）
- `src/main.cpp` — 10000 实例场景与 7 组测试

## 构建与运行

```bash
make          # 需要 glslangValidator 与 vulkan 头文件
./run.sh      # 自动选择 ICD；容器内默认 lavapipe
```

启用 Khronos 校验层（需已解压到 `~/local`）：

```bash
ENABLE_VALIDATION=1 ./run.sh
```

## 测试内容（28 项断言）

1. GPU 与 CPU 参考实现的可见数量、索引集合完全一致，无重复、无越界。
2. indirect 命令字段正确：`indexCount=36`，`instanceCount` 等于可见数，
   其余静态字段为 0。
3. 相机移动后只重跑查询即可得到新可见集；回到原相机结果可复现，全程不
   重传实例数组。
4. 裁剪开关：关闭时 10000 个实例全部进入 draw，开启时数量严格减少。
5. 零可见：indirect 计数为 0，draw 为规范定义的 no-op，无校验错误。
6. GPU 耗时：时间戳查询分别统计裁剪、绘制与整帧，100 帧平均/最小值。

> 当前容器没有 `/dev/dri`，通过 lavapipe（CPU 实现的 Vulkan 1.4 驱动）
> 运行，API 用法与真实 GPU 完全一致；换装有物理 GPU 的机器直接构建运行
> 即可，耗时会低一到两个数量级。
