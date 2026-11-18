# tangent_lab — 法线贴图切线空间光照重建实验

纯 C++17 软件渲染器（无第三方依赖，PNG 为内置 store 模式 deflate 写出），
演示并自动验证从法线贴图重建切线空间光照的完整链路。

## 构建与运行

```sh
make test        # 编译并运行全部测试，图像输出到 out/
```

退出码非零即存在失败项；控制台逐条打印 ok/FAIL。

## 三种着色模式（`src/render.h` ShadingMode）

- `NoTangent`：错误基线，把切线空间法线直接当世界法线。
- `Reconstructed`：逐像素由位置/UV 梯度重建 TBN（对应 shader 里
  dFdx/dFdy 的 tangentless normal mapping），无需切线属性。
- `Exported`：逐顶点导出切线（Lengyel 累积 + Gram-Schmidt），
  `w = ±1` 记录手性，`B = w * cross(N, T)`。
- `NaiveNoHandedness`：对照组，重建但强制 `w = +1`，用于展示镜像面
  光照反转。

## 关键实现点

- **镜像 UV**：手性不取 UV 行列式符号（受三角形绕序影响），而取
  `sign(cross(N, T) . B_grad)`（`src/mesh.h` `tangentHandedness`），
  绕序无关且只在真正镜像时为负。镜像 UV 岛接缝处顶点分裂
  （`src/geometry.h` `makePlane(mirrorRightHalf=true)`）。
- **退化 UV**：UV 三角形面积为零 / 切线梯度近零时判定退化
  （`triangleTangentFrame` 返回 false），回退到 Frisvad 正交基
  （`orthonormalBasis`），`safeNormalize` 兜底，保证无 NaN。
- **法线图旋转**：`rotateTangentNormal` 在切线平面内旋转采样法线，
  高光方向随之旋转（测试 3 数值验证）。
- **TBN 可视化**：`VizMode::Tangent/Bitangent/Normal` 输出
  `0.5 + 0.5 * 基向量` 颜色图（`out/tbn_*.png`）。

## 测试（`src/main.cpp`）

1. 三种几何（砖墙=平面+砖块法线图、圆球、平面）× 三种模式对比，
   `out/compare.png`。
2. TBN 基向量可视化（重建/导出 × T/B/N），`out/tbn_*.png`。
3. 法线图旋转 0/45/90/135°，恒定倾斜法线图 + 平面，断言高光质心角度
   每步移动约 45°，`out/rotate_strip.png`。
4. 退化 UV 平面（中段 UV 塌陷为一点）三种模式 + TBN 可视化，断言无
   NaN，`out/degenerate.png`。
5. 镜像 UV 平面（右半 UV 镜像）+ 对称光照，逐镜像像素对比较：
   重建/导出模式最大色差 < 0.03（无反向光照），朴素模式 > 0.05
   （证明测试有效），`out/mirror.png`。
