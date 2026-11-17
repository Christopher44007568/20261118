import * as THREE from 'three';
import { createProbeGrid } from './probes.js';

export const ROOM = { hx: 7, hy: 3.5, hz: 7 }; // 半尺寸，房间 14 x 7 x 14

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#5a5f66' : '#3c4046';
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function wall(w, h, color) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 })
  );
}

// 搭建房间、灯光、装饰与遮挡物。返回场景引用与遮挡体列表。
export function buildRoom(scene) {
  const { hx, hy, hz } = ROOM;
  const occluders = [];

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(hx * 2, hz * 2),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  occluders.push(floor);

  const ceil = wall(hx * 2, hz * 2, 0x2a2c30);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = hy * 2;
  scene.add(ceil);

  const mkWall = (w, h, color, pos, rotY) => {
    const m = wall(w, h, color);
    m.position.set(...pos);
    m.rotation.y = rotY;
    scene.add(m);
    occluders.push(m);
    return m;
  };
  // +x 红墙、+z 蓝墙（房间角落），其余中性灰
  mkWall(hz * 2, hy * 2, 0xb0402f, [hx, hy, 0], -Math.PI / 2);
  mkWall(hx * 2, hy * 2, 0x2f5fb0, [0, hy, hz], Math.PI);
  mkWall(hz * 2, hy * 2, 0x8a8d92, [-hx, hy, 0], Math.PI / 2);
  mkWall(hx * 2, hy * 2, 0x8a8d92, [0, hy, -hz], 0);

  // 遮挡柱：球绕角落运行时会周期性地挡住部分探针视线
  const pillar = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 3.4, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x6b6257, roughness: 0.95 })
  );
  pillar.position.set(4.6, 1.7, 4.6);
  scene.add(pillar);
  occluders.push(pillar);

  // 灯光：角落暖亮光源 + 对角冷暗光源 -> 探针间曝光差异明显
  const warm = new THREE.PointLight(0xffc27a, 220, 0, 2);
  warm.position.set(5.6, 4.6, 5.6);
  scene.add(warm);
  const cool = new THREE.PointLight(0x7aa8ff, 40, 0, 2);
  cool.position.set(-5, 3, -5);
  scene.add(cool);
  scene.add(new THREE.AmbientLight(0xffffff, 0.06));

  // 发光装饰（反射内容）
  const glow = (color, intensity, pos, size) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({
        color: 0x111111,
        emissive: new THREE.Color(color),
        emissiveIntensity: intensity,
      })
    );
    m.position.set(...pos);
    scene.add(m);
    return m;
  };
  glow(0xffb45e, 6, [6.6, 3.2, 6.6], [0.5, 2.2, 0.5]); // 角落灯柱
  glow(0x5e9bff, 3, [-6.5, 2.4, -6.5], [0.5, 1.6, 0.5]);
  glow(0x69f0ae, 2.5, [-6.5, 1.2, 5.5], [0.4, 1.0, 0.4]);
  glow(0xff6e91, 2.5, [5.5, 1.0, -6.5], [0.4, 0.8, 0.4]);

  return { occluders };
}

// 创建探针网格并烘焙 cubemap，估计每个探针的曝光（平均亮度）。
export function buildProbes(scene, renderer, hiddenDuringBake) {
  const grid = createProbeGrid({
    nx: 5,
    ny: 3,
    nz: 5,
    origin: [-6, 0.8, -6],
    spacing: [3, 2.2, 3],
  });

  const RES = 128;
  const cubeCamera = new THREE.CubeCamera(
    0.1,
    80,
    new THREE.WebGLCubeRenderTarget(RES)
  );
  scene.add(cubeCamera);

  const prevHidden = hiddenDuringBake.map((o) => o.visible);
  hiddenDuringBake.forEach((o) => (o.visible = false));

  const probes = grid.positions.map((pos) => {
    const rt = new THREE.WebGLCubeRenderTarget(RES);
    cubeCamera.position.set(pos[0], pos[1], pos[2]);
    cubeCamera.renderTarget = rt;
    cubeCamera.update(renderer, scene);
    return { position: pos, texture: rt.texture, rt, exposure: 1 };
  });

  hiddenDuringBake.forEach((o, i) => (o.visible = prevHidden[i]));

  // 逐面读回像素估计平均亮度作为探针曝光
  const buf = new Uint8Array(RES * RES * 4);
  for (const probe of probes) {
    let lum = 0;
    let n = 0;
    for (let face = 0; face < 6; face++) {
      renderer.readRenderTargetPixels(
        probe.rt,
        0,
        0,
        RES,
        RES,
        buf,
        face
      );
      for (let i = 0; i < buf.length; i += 4) {
        lum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
        n++;
      }
    }
    probe.exposure = Math.max(lum / (n * 255), 0.02);
  }

  return { grid, probes };
}
