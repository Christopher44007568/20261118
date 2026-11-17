# 原生 WebGPU 两阶段可见性裁剪

纯 WebGPU 实现的两阶段视锥裁剪 Demo，无任何图形引擎依赖。

## 架构

1. **阶段一 · CPU 世界 AABB 剔除（js/culler.js + js/math.js）**
   - 动态实例（旋转网格）每帧由 8 个局部角点经模型矩阵变换，重新计算世界 AABB。
   - 用 Gribb-Hartmann 方法从 view-projection 矩阵提取 6 个视锥平面。
   - 对每个实例做 AABB-视锥平面测试，产出候选索引并写入 storage buffer。
   - 所有浮点运算经 `Math.fround`，与 WGSL 的 `f32` 逐运算对齐。
2. **阶段二 · Compute Shader 视锥测试（js/shaders.js `cullWGSL`）**
   - 仅遍历 CPU 候选，对每个候选再做一次相同的 AABB-视锥测试。
   - 通过者用 `atomicAdd` 占用槽位，把实例索引写回 `visibleIndices`。
   - 第二个 compute pass（`finalizeWGSL`）把可见数写入 `drawIndirect` 参数。
3. **渲染（renderWGSL）**
   - `drawIndirect` 按 GPU 可见数实例化绘制，顶点着色器经 `instance_index` 查可见索引。
   - 回读采用多帧解耦的 staging 槽 + `onSubmittedWorkDone`，不阻塞渲染队列。

## 场景构成（共 152 个实例）

- 静态网格 121 个（11×11 方阵）
- 旋转网格 20 个（绕 Y 轴自转并环绕原点）
- 大遮挡体 1 个（边长 7 的立方体）
- 被遮挡小模型 10 个（位于遮挡体后方、视锥之内，仅靠深度测试被遮挡）

相机 `far=120` 覆盖整个场景，对象尺寸固定；通过收紧相机位置让部分实例落出视锥来产生真实裁剪，
**没有用缩小对象或拉远近平面来掩盖漏裁**。遮挡小模型不做遮挡剔除，因此仍计入可见集合。

## 界面

HUD 实时显示：当前相机、实例总数、CPU 候选数、GPU 可见数、CPU 剔除耗时、每帧总耗时、
CPU/GPU 可见集合一致性（含漏裁/多裁详情）。

## 运行与测试

```bash
# 1. Node 逻辑测试（f32 数学、AABB、三相机裁剪统计）
npm run test:math

# 2. 启动静态服务器（ES module 需要 http 源）
npm run serve
# 浏览器打开 http://localhost:8124/

# 3. 端到端测试（需要带远程调试端口的 Chrome）
#    Chrome: --headless=new --remote-debugging-port=9222 --disable-gpu-sandbox
npm run test:e2e
```

`index.html?test` 会自动依次切换三个相机各跑 40 帧，并把
`window.__TEST_RESULT__` 置为三相机的一致性报告；E2E 通过 CDP 断言
`ok === true`、无 GPU 校验错误、且每个相机都发生了真实裁剪。
