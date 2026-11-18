# 岩层材质实验室 (Rock Strata Material Lab)

在 WebAssembly 中程序化生成岩层 PBR 贴图（反照率 / 粗糙度 / 法线 / 高度 / 孔隙遮罩），
并在 WebGL2 中以球体与平面两种几何实时预览。

## 运行

```bash
npm install
npm run build      # AssemblyScript -> dist/rockgen.wasm (+ 拷贝到 web/)
npm run serve      # http://localhost:8000/web/
npm run validate   # 无缝性 / 法线对齐 / mip 稳定性检查 + 导出两套 seed 的 PNG
npm run compare    # 斜光对比渲染（近处 mip0 vs 远处 mip3）
npm run preview    # 无头 Chromium 截图冒烟测试
```

## 结构一致性（颜色与法线不错位）

`assembly/rockgen.ts` 中每个像素只计算一次共享场：周期 fBm 域扭曲的层理带、
周期 Voronoi (F2-F1) 裂缝、细节/颗粒/孔隙噪声。五张图全部由这同一组场导出；
法线是对最终高度场做**环绕感知 Sobel** 得到的，因此与高度、反照率严格对齐
（验证：法线重投影平均角误差 < 1.5°，仅受 8bit 量化限制）。

## 四边平铺连续

所有噪声格点以整数周期取模（`noise.ts` 的 `wrapi`），层理层索引对层数取模，
因此 u/v 方向跨缝梯度与内部梯度统计一致（比值 ≈ 1.0）。

## 铺瓦与远处细节层

贴图上传后 `generateMipmap` 建 10 级 mip 链，`LINEAR_MIPMAP_LINEAR` +
各向异性过滤（最高 8x）。提高铺瓦次数或拉远相机时，硬件按像素足迹自动
选择更低细节层——不是整体模糊。面板中 “Mip 层级调试” 通道可实时看到
LOD 分布（蓝=近 → 品红=远）。

## 导出与对比

- UI 按钮 “导出当前 seed / 导出两套 seed” 直接下载 PNG。
- `npm run validate` 把 seed 1234 与 9876 的五张图写入 `artifacts/textures/`。
- `npm run compare` 输出 `artifacts/compare_seed*_oblique.png`
  （方位角 35°、高度角 25° 斜光；左=近 mip0，右=远 mip3），并检查：
  亮度与 N·L 的相关系数（法线方向正确性）、受光照渲染的跨缝梯度比
  （接缝不可见）、近→远平均亮度漂移 < 5%（远处采样稳定）。
