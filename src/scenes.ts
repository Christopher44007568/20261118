import {
  createConcavePrism,
  createCube,
  createCubePair,
  createGround,
  createNonManifoldFan,
  createOpenBox,
} from "./geometry";
import { prepareMesh, type PreparedMesh } from "./mesh";
import type { Vec3 } from "./math";

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  near: number;
  far: number;
}

export interface DemoScene {
  id: number;
  title: string;
  subtitle: string;
  lightPosition: Vec3;
  defaultCamera: CameraPose;
  insideCamera: CameraPose;
  nearCamera: CameraPose;
  ground: PreparedMesh;
  casters: PreparedMesh[];
  receivers: PreparedMesh[];
  invalid: PreparedMesh[];
}

const far = 220;

function pose(position: Vec3, target: Vec3, near = 0.05): CameraPose {
  return { position, target, near, far };
}

function validate(meshes: PreparedMesh[]): PreparedMesh[] {
  return meshes.filter((mesh) => !mesh.validation.closed);
}

export function createScenes(): DemoScene[] {
  const ground = prepareMesh(createGround(28));
  const cube = prepareMesh(createCube([0, 1.05, -0.3], 0.88));
  const concave = prepareMesh(createConcavePrism([0, 0, -0.15], 2.15, 0.96));
  const pair = createCubePair().map(prepareMesh);
  const open = prepareMesh(createOpenBox([-1.65, 1.05, 0.35], 0.82));
  const nonManifold = prepareMesh(createNonManifoldFan([1.35, 1.2, -0.2]));

  return [
    {
      id: 1,
      title: "立方体",
      subtitle: "单点光源 · 6 条轮廓边 · 有限远封口",
      lightPosition: [3.4, 5.6, 2.5],
      defaultCamera: pose([5.5, 4.5, 7.6], [0, 0.9, 0]),
      insideCamera: pose([-2.4, 0.6, -2.4], [0, 1.05, -0.3], 0.035),
      nearCamera: pose([3.5, 3.4, 3.9], [0, 0.65, -0.4], 4.8),
      ground,
      casters: [cube],
      receivers: [ground, cube],
      invalid: [],
    },
    {
      id: 2,
      title: "凹形封闭网格",
      subtitle: "L 形棱柱 · 凹轮廓与多段远封口",
      lightPosition: [3.2, 6.2, 2.8],
      defaultCamera: pose([5.9, 5.0, 8.0], [0, 1.0, 0]),
      insideCamera: pose([-2.0, 0.5, -2.6], [0, 1.0, -0.15], 0.035),
      nearCamera: pose([4.0, 3.8, 4.5], [0, 0.9, -0.2], 2.7),
      ground,
      casters: [concave],
      receivers: [ground, concave],
      invalid: [],
    },
    {
      id: 3,
      title: "两个相交阴影体",
      subtitle: "双立方体 · 模板并集计数 · 相交处无重复漏光",
      lightPosition: [4.2, 5.3, 0.55],
      defaultCamera: pose([5.6, 4.4, 8.2], [0, 0.95, 0]),
      insideCamera: pose([-3.0, 0.7, -1.0], [0, 1.2, 0], 0.035),
      nearCamera: pose([3.8, 3.7, 4.7], [0, 0.9, -0.1], 2.55),
      ground,
      casters: pair,
      receivers: [ground, ...pair],
      invalid: [],
    },
    {
      id: 4,
      title: "缺陷网格拒绝",
      subtitle: "开放边与非流形边被定位 · 不生成任何阴影体",
      lightPosition: [2.8, 5.8, 2.4],
      defaultCamera: pose([5.5, 4.6, 7.8], [0, 1.0, 0]),
      insideCamera: pose([5.5, 4.6, 7.8], [0, 1.0, 0]),
      nearCamera: pose([5.5, 4.6, 7.8], [0, 1.0, 0]),
      ground,
      casters: [],
      receivers: [ground],
      invalid: validate([open, nonManifold]),
    },
  ];
}
