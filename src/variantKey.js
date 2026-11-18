// 变体键：program（材质着色器族）+ 光照 + 阴影 + 贴花 + 透明模式
// 字段顺序固定并做合法性校验，保证同一变体永远生成同一个字符串键。

export const LIGHTING = Object.freeze(['lit', 'unlit']);
export const SHADOW = Object.freeze(['on', 'off']);
export const DECAL = Object.freeze(['none', 'decaled']);
export const TRANSPARENT = Object.freeze(['opaque', 'alphaTest', 'blend']);

const ENUMS = Object.freeze({
  lighting: LIGHTING,
  shadow: SHADOW,
  decal: DECAL,
  transparent: TRANSPARENT,
});

export class ShaderCompileError extends Error {
  constructor(key, cause) {
    super(`shader 编译失败: ${key}${cause ? ` (${cause})` : ''}`);
    this.name = 'ShaderCompileError';
    this.key = key;
  }
}

export function makeVariant(input) {
  const variant = {
    program: String(input.program),
    lighting: input.lighting,
    shadow: input.shadow,
    decal: input.decal,
    transparent: input.transparent,
  };
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(variant[field])) {
      throw new TypeError(`非法变体字段 ${field}=${variant[field]}，允许值: ${allowed.join('/')}`);
    }
  }
  return Object.freeze(variant);
}

export function variantKey(variant) {
  return [
    `pg=${variant.program}`,
    `L=${variant.lighting}`,
    `S=${variant.shadow}`,
    `D=${variant.decal}`,
    `T=${variant.transparent}`,
  ].join('|');
}

// 错误变体回退目标：同一 program 的最保守管线（无光照/阴影/贴花/透明）
export function fallbackVariant(variant) {
  return makeVariant({
    program: variant.program,
    lighting: 'unlit',
    shadow: 'off',
    decal: 'none',
    transparent: 'opaque',
  });
}

export function describeKey(key) {
  return key.replaceAll('|', '  ');
}
