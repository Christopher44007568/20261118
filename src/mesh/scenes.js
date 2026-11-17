import { createBox } from './box.js';

const SCENES = {
  disjoint: {
    id: 'disjoint',
    label: '相离',
    caption: '两个封闭盒体互不接触',
    accent: '#67e8f9',
    build: () => ({
      a: createBox({ center: [-1.65, 0, 0], size: [1.8, 2.2, 2.2] }),
      b: createBox({ center: [1.65, 0, 0], size: [1.8, 2.2, 2.2] }),
    }),
  },
  intersecting: {
    id: 'intersecting',
    label: '相交',
    caption: '盒体交叉并带旋转，产生非共面交线',
    accent: '#fbbf24',
    build: () => ({
      a: createBox({ center: [-0.48, 0, 0], size: [2.35, 2.1, 2.1] }),
      b: createBox({
        center: [0.52, 0.12, 0.08],
        size: [2.15, 2.25, 2.1],
        rotation: [0.08, -0.12, 0.43],
      }),
    }),
  },
  coplanar: {
    id: 'coplanar',
    label: '共面接触',
    caption: '接触面使用相反对角线，覆盖共面交叉三角形',
    accent: '#fb7185',
    build: () => ({
      a: createBox({
        center: [-0.5, 0, 0],
        size: [2, 2.4, 2.4],
        flipDiagonals: [5],
      }),
      b: createBox({
        center: [1.5, -0.15, 0.1],
        size: [2, 2, 2],
        flipDiagonals: [4],
      }),
    }),
  },
};

export const SCENE_ORDER = ['disjoint', 'intersecting', 'coplanar'];

export function getScene(id) {
  const definition = SCENES[id] ?? SCENES.intersecting;
  return { ...definition, ...definition.build() };
}

export const OPERATIONS = [
  { id: 'union', label: '并集', symbol: 'A ∪ B' },
  { id: 'difference', label: '差集', symbol: 'A − B' },
  { id: 'intersection', label: '交集', symbol: 'A ∩ B' },
];
