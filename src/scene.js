import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const NORMAL_LENGTH = 0.075;
const MAX_NORMAL_GLYPHS = 900;

export function createIsoScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x071017, 0.035);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  camera.position.set(3.18, 1.48, 4.85);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.01, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.enablePan = false;
  controls.minDistance = 3.35;
  controls.maxDistance = 8.2;
  controls.minPolarAngle = Math.PI * 0.18;
  controls.maxPolarAngle = Math.PI * 0.78;
  controls.update();

  addLights(scene);
  addEnvironment(scene);

  const surfaceNets = createLayer(scene, -0.76, {
    color: 0x67dff1,
    emissive: 0x0a3138,
    normalColor: 0x8ef3ff,
    edgeColor: 0x8beafa,
  });
  const marchingCubes = createLayer(scene, 0.76, {
    color: 0xe7a94d,
    emissive: 0x2f1d08,
    normalColor: 0xffce82,
    edgeColor: 0xffc56e,
  });

  let normalVisible = false;
  let edgeVisible = true;
  let frame = 0;

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function animate() {
    frame = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return {
    setMeshes(surfaceNetsMesh, marchingCubesMesh) {
      updateLayer(surfaceNets, surfaceNetsMesh, 4);
      updateLayer(marchingCubes, marchingCubesMesh, 3);
      applyVisibility(surfaceNets);
      applyVisibility(marchingCubes);
    },
    setNormalVisible(visible) {
      normalVisible = visible;
      applyVisibility(surfaceNets);
      applyVisibility(marchingCubes);
    },
    setEdgeVisible(visible) {
      edgeVisible = visible;
      applyVisibility(surfaceNets);
      applyVisibility(marchingCubes);
    },
    resetView() {
      camera.position.set(3.18, 1.48, 4.85);
      controls.target.set(0, -0.01, 0);
      controls.update();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };

  function applyVisibility(layer) {
    layer.edgeLines.visible = edgeVisible;
    layer.normalLines.visible = normalVisible;
  }
}

function createLayer(scene, offsetX, palette) {
  const group = new THREE.Group();
  group.position.x = offsetX;
  scene.add(group);

  const material = new THREE.MeshPhysicalMaterial({
    color: palette.color,
    emissive: palette.emissive,
    emissiveIntensity: 0.28,
    metalness: 0.08,
    roughness: 0.27,
    clearcoat: 0.82,
    clearcoatRoughness: 0.19,
    sheen: 0.45,
    sheenColor: new THREE.Color(palette.color).multiplyScalar(0.35),
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.renderOrder = 1;
  group.add(mesh);

  const edgeLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: palette.edgeColor,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    }),
  );
  edgeLines.renderOrder = 2;
  group.add(edgeLines);

  const normalLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: palette.normalColor,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    }),
  );
  normalLines.renderOrder = 3;
  group.add(normalLines);

  return { group, mesh, edgeLines, normalLines, material };
}

function updateLayer(layer, result, edgeEvery) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(result.positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(result.normals, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
  geometry.computeBoundingSphere();
  layer.mesh.geometry.dispose();
  layer.mesh.geometry = geometry;

  const edgePositions = buildEdgePositions(result, edgeEvery);
  replaceLineGeometry(layer.edgeLines, edgePositions);
  replaceLineGeometry(
    layer.normalLines,
    buildNormalPositions(result),
  );
}

function buildEdgePositions(result, edgeEvery) {
  const faceSize = result.kind === "surface-nets" ? 4 : 3;
  const faces = result.faces ?? result.indices;
  const values = [];
  for (let face = 0; face < faces.length / faceSize; face += 1) {
    if (face % edgeEvery !== 0) continue;
    const offset = face * faceSize;
    for (let edge = 0; edge < faceSize; edge += 1) {
      const a = faces[offset + edge] * 3;
      const b = faces[offset + ((edge + 1) % faceSize)] * 3;
      values.push(
        result.positions[a],
        result.positions[a + 1],
        result.positions[a + 2],
        result.positions[b],
        result.positions[b + 1],
        result.positions[b + 2],
      );
    }
  }
  return new Float32Array(values);
}

function buildNormalPositions(result) {
  const stride = Math.max(1, Math.ceil(result.vertexCount / MAX_NORMAL_GLYPHS));
  const values = [];
  for (let vertex = 0; vertex < result.vertexCount; vertex += stride) {
    const offset = vertex * 3;
    const x = result.positions[offset];
    const y = result.positions[offset + 1];
    const z = result.positions[offset + 2];
    values.push(
      x,
      y,
      z,
      x + result.normals[offset] * NORMAL_LENGTH,
      y + result.normals[offset + 1] * NORMAL_LENGTH,
      z + result.normals[offset + 2] * NORMAL_LENGTH,
    );
  }
  return new Float32Array(values);
}

function replaceLineGeometry(lines, positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  lines.geometry.dispose();
  lines.geometry = geometry;
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xb9eff4, 0x071016, 2.1));

  const key = new THREE.DirectionalLight(0xf3fbf5, 4.3);
  key.position.set(3.8, 6.4, 3.5);
  scene.add(key);

  const cool = new THREE.PointLight(0x57d8ef, 20, 7, 2);
  cool.position.set(-3.2, 0.4, 2.4);
  scene.add(cool);

  const warm = new THREE.PointLight(0xffb45c, 15, 6, 2);
  warm.position.set(3.2, -0.7, -1.7);
  scene.add(warm);

  const rim = new THREE.DirectionalLight(0x73a8ff, 2.1);
  rim.position.set(-2.6, 1.8, -4.1);
  scene.add(rim);
}

function addEnvironment(scene) {
  const grid = new THREE.GridHelper(4.8, 24, 0x274957, 0x142d37);
  grid.position.y = -0.79;
  grid.material.transparent = true;
  grid.material.opacity = 0.3;
  grid.material.depthWrite = false;
  scene.add(grid);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 1.605, 96),
    new THREE.MeshBasicMaterial({
      color: 0x70c1ce,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.position.y = -0.785;
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);

  const points = [];
  let seed = 947;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 80; i += 1) {
    points.push(
      (random() - 0.5) * 5.8,
      random() * 2.8 - 0.7,
      (random() - 0.5) * 4.5 - 0.8,
    );
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: 0x80cad3,
      size: 0.012,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  );
  scene.add(dust);
}
