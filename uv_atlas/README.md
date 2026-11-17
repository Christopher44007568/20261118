# UV 岛图集打包

该示例把带任意源旋转的矩形、圆形和细长条 UV 岛打包到同一张归一化图集。

## 运行

```bash
python3 -m uv_atlas
```

输出位于 `artifacts/output/`：

- `mapping_m*.json`：每个岛的原 UV、偏移、旋转、缩放、打包后 UV 和指标。
- `validation_m*.json`：从映射 JSON 重新应用后的随机采样与边界/间距验证。
- `atlas_m*.svg`：三类岛的二维布局图。
- `comparison.csv`、`summary.md`：不同边距下的缩放和利用率对比。

也可以单独验证已有映射：

```bash
python3 -m uv_atlas.validate artifacts/output/mapping_m0p005.json /tmp/validation.json
```

## 映射公式

正向映射：

```text
packedUv = R(rotation) * (scale * originalUv) + offset
```

反向映射：

```text
originalUv = R(-rotation) * (packedUv - offset) / scale
```

`scale` 为正的统一缩放，矩阵为纯旋转加平移，不包含镜像，因此 U/V 基向量保持正交、等长且手性不变，材质接缝处的像素方向不会翻转。

## 碰撞和边距

打包器对旋转后的实际凸多边形做线段相交、点包含和最小欧氏距离检测。每个岛必须满足：

- 多边形距离所有边界至少为 `margin`。
- 任意两个多边形之间的最小距离至少为 `margin`。
- 候选旋转只使用刚性旋转，不使用反射。

利用率使用实际多边形面积除以图集面积；映射 JSON 另提供按矩形、圆形、细长条分组的紧外接框利用率。
