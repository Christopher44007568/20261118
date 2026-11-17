# 实例化草地/灌木渲染器 — 实施计划

环境: 无 GPU / 无 root。使用本地提取的 OSMesa (llvmpipe, OpenGL 4.5) 做离屏渲染与可复现基准。

## 架构
- `src/gl_*.cpp` 最小 GL 函数加载器 + OSMesa 离屏上下文 + PPM 截图 + 计时
- `src/terrain.*` 程序化高度场（正弦/噪声叠加，确定性）
- `src/grass_field.*` 区块(chunk)管理：
  - 每区块固定 N×N 实例槽，实例属性 = 位置/朝向/高度/风相位（4 vec4 或紧凑布局）
  - 按区块在 CPU 做视锥 AABB 裁剪
  - 边缘过渡：区块激活带 + 缩放/透明度渐变（无整块弹出）
  - 远处密度 LOD：按距离环带降低每区块实例数，配合地面底色保持轮廓连续
- `shaders/` GLSL:
  - 草叶：少量顶点（2 三角形交叉片 + 3~4 段，根部 v=0 固定，风位移按 v^2 只影响上部）
  - 灌木：程序化多面体（icosphere 低模 + 顶点点噪声）
  - 风场：全局风向量 + 每实例相位 + 时间 uniform（动态模式）
- 三种模式:
  1. no-instancing: 每实例一次 draw（基准，证明 draw call 爆炸）
  2. static-instancing: 每可见区块一次 instanced draw，风关闭
  3. dynamic-wind: 同样 instanced，shader 内动态风场
- 基准: 相机沿路径移动，多帧统计 draw call / 提交实例数 / 帧时间（均值、p95）
- 验证:
  - 风位移根部为 0（数值断言）
  - 轮廓连续性：远环带开启/关闭密度时，地平线附近像素覆盖率差异在阈值内
  - 无弹出：相机在边界来回移动，相邻帧新增区块的 alpha/scale 从 0 渐变（记录每帧区块 fade 状态）
