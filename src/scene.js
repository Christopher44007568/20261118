import { makeVariant, variantKey } from './variantKey.js';

// 材质只声明自己的两个属性（贴花/透明）；光照与阴影是全局渲染设置。
// 完整变体键 = program + 全局光照 + 全局阴影 + 材质贴花 + 材质透明。

export const MATERIALS = Object.freeze([
  { id: 'stone',    label: '石材墙面', program: 'pbrStandard', decal: 'none',    transparent: 'opaque',    groups: ['plaza', 'westWing'] },
  { id: 'metal',    label: '金属栏杆', program: 'pbrStandard', decal: 'none',    transparent: 'opaque',    groups: ['plaza', 'tower'] },
  { id: 'glass',    label: '玻璃幕墙', program: 'pbrStandard', decal: 'none',    transparent: 'blend',     groups: ['plaza', 'tower', 'westWing'] },
  { id: 'foliage',  label: '植被叶片', program: 'foliage',      decal: 'none',    transparent: 'alphaTest', groups: ['plaza', 'westWing'] },
  { id: 'signage',  label: '招牌贴花', program: 'pbrStandard', decal: 'decaled', transparent: 'opaque',    groups: ['plaza', 'tower'] },
  { id: 'banner',   label: '半透旗帜', program: 'cloth',       decal: 'decaled', transparent: 'blend',     groups: ['westWing'] },
  { id: 'hologram', label: '全息投影', program: 'hologram',    decal: 'decaled', transparent: 'blend',     groups: ['tower'] },
  { id: 'grate',    label: '镂空格栅', program: 'pbrStandard', decal: 'none',    transparent: 'alphaTest', groups: ['tower', 'westWing'] },
]);

export const CAMERAS = Object.freeze([
  { id: 'plaza',   label: '主广场视角' },
  { id: 'tower',   label: '高塔俯视' },
  { id: 'westWing', label: '西翼视角' },
]);

export const DEFAULT_RENDER_SETTINGS = Object.freeze({
  lighting: 'lit',
  shadow: 'on',
});

export function visibleMaterials(cameraId) {
  return MATERIALS.filter((material) => material.groups.includes(cameraId));
}

export function variantFor(material, renderSettings) {
  return makeVariant({
    program: material.program,
    lighting: renderSettings.lighting,
    shadow: renderSettings.shadow,
    decal: material.decal,
    transparent: material.transparent,
  });
}

export function requiredVariantKeys(cameraId, renderSettings) {
  return visibleMaterials(cameraId).map((material) => variantKey(variantFor(material, renderSettings)));
}

// 预热集合：当前相机下所有实际可见材质 × 当前全局渲染设置
export function buildWarmupSet(cameraId, renderSettings) {
  return visibleMaterials(cameraId).map((material) => variantFor(material, renderSettings));
}
