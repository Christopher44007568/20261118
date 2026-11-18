# 近似次表面散射材质 (Approximate Subsurface Scattering)

面向玉石 (jade) 与皮肤 (skin) 色块的实时近似 SSS 材质。透光强度由四个量
共同决定：**几何法线、局部曲率、光学厚度、光方向**。薄边比厚中心更亮，
逆光时颜色从表面色 (surface color) 偏移到散射色 (scatter color)。

## 物理模型

核心实现位于 `src/shaders/sss_common.glsl`，Web 与原生测试共用同一份 GLSL。

- **厚度 (thickness)**：预处理通道分别渲染封闭网格的前面与背面，记录视空间
  线性深度；两者之差即沿视线的光程，再按材质 `thicknessScale` 归一化到
  `0(纸薄边)..1(厚中心)`。Beer–Lambert 消光
  `transmittance = exp(-density * thickness)` 让薄边透光、厚中心变暗。
- **法线与光方向**：`transmissionLight` 把 `N·L` 重映射，使正光 (ndl→+1)
  的透射为 0、逆光 (ndl→-1) 为 1，`wrap` 在明暗交界线附近保留柔和边缘。
  这保证 SSS 只在“光到达背面”时出现。
- **曲率 (curvature)**：由前表面法线缓冲的空间梯度幅值估计，在高曲率的
  轮廓/褶皱处升高，增强薄边与折痕的散射响应。
- **相位函数**：前向 + 各向同性的双瓣混合，控制侧光轮廓的散射分布。
- **颜色偏移**：透射越强，颜色从表面 albedo 向深层散射色混合
  (`mix(surfaceColor, scatterColor, shift)`)。

### 为什么不会变成加色发光

SSS 颜色最终乘以透射辐照度 `transmissionLight` 与光照颜色：没有光到达背面
就没有 SSS 输出。正光下透射项恒为 0，材质只剩正常漫反射/高光；合成时还做了
能量守恒混合与 `min(color, 1)` 上限，杜绝 HDR 溢出式的自发光。

## 调试模式 (`uDebugMode`)

| 值 | 模式 | 含义 |
|----|------|------|
| 0 | final | 最终合成 |
| 1 | thickness | 厚度图，蓝(薄)→绿→红(厚) |
| 2 | scatter | 散射项，强度×散射色调 |
| 3 | normals | 视空间法线 |
| 4 | curvature | 曲率，黑(平坦)→白(高曲率) |
| 5 | diffuse | 仅直接漫反射，用于对比 SSS 贡献 |

## 三种光照测试

- **正光 front**：光在相机一侧，表现为普通漫反射/高光，无边缘辉光。
- **逆光 back**：光在物体后方，薄边透出明亮散射色环，厚中心较暗。
- **侧光 side**：掠射光，阴影侧轮廓出现明亮散射边缘。

## 目录

- `src/shaders/` — 共享 GLSL ES 3.00 着色器（含 `sss_common.glsl`）。
- `src/platform/` — 无窗口 EGL/GLES3 平台层、矩阵、网格、着色器加载。
- `src/sss_render.c` — 离屏渲染器，输出 PNG 与 JSON 探针数据。
- `web/index.html`, `web/viewer.js` — WebGL2 交互查看器（同一套着色器）。
- `test/test_sss.py` — 自动化物理断言。
- `artifacts/` — 渲染输出 PNG。

## 运行

需要 Mesa 软件渲染 (llvmpipe) 与本地 EGL/GLES 库（仓库 `sandbox/headers`
已备好，无需 root）。

```bash
make run          # 离屏渲染全部 材质 × 光照 × 调试模式
python3 test/test_sss.py   # 运行 23 项断言
```

Web 查看器需要通过 HTTP 提供（着色器用 `fetch` 加载）：

```bash
cd web && python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/
```
