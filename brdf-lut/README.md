# Environment BRDF LUT（split-sum 预计算查找表）

预计算 GGX 法线分布 + Smith 高度相关几何遮蔽的环境 BRDF 积分
（Karis split-sum 第二部分），存入 RG 双通道查找表：

```
specularIBL = prefilteredEnv(R) * (F0 * lut.r + lut.g)
```

- 横轴 `u = NdotV`，纵轴 `v = roughness`，纹素中心映射 `(i+0.5)/N`
- 着色器一次双线性采样即可，粗糙度变化时 C0 连续
- 查表坐标 clamp 到 `[0.5/N, 1-0.5/N]`，配合 `CLAMP_TO_EDGE` 不会越界

## 构建与运行

```sh
make run          # 生成 LUT + 三组材质对照渲染 + out/report.txt
./brdf_lut 512 2048 8192   # 尺寸 / LUT每纹素采样数 / 参考每像素采样数
```

## 文件

- `src/env_brdf.h` — Hammersley、GGX 重要性采样、Smith 可见性项、蒙特卡洛积分
- `src/lut.h` — LUT 生成与边界安全的双线性采样
- `src/compare.h` — 球体对照渲染（LUT 路径 vs 每像素 8192 次数值积分）
- `src/png_writer.h` — 无依赖 PNG 写出（RGB8 / LA16）
- `shaders/pbr_lut.frag` — 运行时 PBR 着色器；定义 `USE_NUMERIC_REF`
  可切换为实时数值积分对照路径
- `out/env_brdf_lut.png` — 16-bit LA 无损 LUT（L=scale, A=bias）
- `out/mat{1,2,3}_{lut,ref,diff_x10}.png` — 三组材质对照图与 ×10 放大误差图

## 实测结果（512×512，2048 采样/纹素）

| 指标 | 数值 |
|---|---|
| 生成时间 | ~8.6 s（单线程，-O2） |
| 纹理尺寸 | 512×512 RG16F（1.0 MiB；RG8 为 512 KiB） |
| 边界检查 | PASS（越界 UV clamp 到边缘纹素） |
| 粗糙度连续性 | 4096 步最大相邻差 0.0039（双线性 C0） |

三组材质 LUT vs 数值参考（亮度，线性空间）：

| 材质 | 最大绝对误差 | 最大相对误差 | NdotV≥0.05 最大误差 | 平均误差 |
|---|---|---|---|---|
| 抛光金 r=0.08 | 0.256（NdotV≈0.01 轮廓处） | 0.80% | 0.0026 | 0.00014 |
| 半糙塑料 r=0.45 | 0.064（NdotV≈0.01） | 0.68% | 0.0023 | 0.00008 |
| 粗糙铝 r=0.85 | 0.298（NdotV≈0.01） | 0.95% | 0.0272 | 0.00049 |

最大绝对误差集中在球体轮廓（NdotV→0）的极端掠射角，此处环境亮度
含太阳高光（HDR ~24）且 LUT 边缘纹素斜率最大；常规着色范围
（NdotV≥0.05）内误差 ≤0.027，相对误差 <1%，对照图视觉一致。
