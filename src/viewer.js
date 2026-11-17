import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const OPERATION_COLORS = {
  union: 0x62e6c8,
  difference: 0xff8a6a,
  intersection: 0xc7a0ff,
};

function makeGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(mesh.positions), 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeGhost(mesh, color) {
  const geometry = makeGeometry(mesh);
  const group = new THREE.Group();
  const surface = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    }),
  );
  group.add(surface, wire);
  group.renderOrder = -1;
  return group;
}

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '三角网格布尔运算结果');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;

    this.scene.add(new THREE.HemisphereLight(0xd8f3ff, 0x172533, 2.6));
    const key = new THREE.DirectionalLight(0xfff4df, 4.4);
    key.position.set(5, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6aa8ff, 2.1);
    rim.position.set(-6, 3, -5);
    this.scene.add(rim);

    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.grid = new THREE.GridHelper(24, 48, 0x2b6170, 0x182d37);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.52;
    this.scene.add(this.grid);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.2 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.receiveShadow = true;
    this.scene.add(this.shadow);

    this.showInputs = true;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();
  }

  resize() {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  clearContent() {
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      child.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose());
        } else {
          object.material?.dispose();
        }
      });
    }
  }

  setScene({ resultMesh, inputA, inputB, operation, bounds, accent }) {
    this.clearContent();
    const aGhost = makeGhost(inputA, 0x54c7e8);
    const bGhost = makeGhost(inputB, 0xf28cb5);
    aGhost.visible = this.showInputs;
    bGhost.visible = this.showInputs;
    this.content.add(aGhost, bGhost);
    this.inputGhosts = [aGhost, bGhost];

    if (resultMesh.indices.length > 0) {
      const geometry = makeGeometry(resultMesh);
      const material = new THREE.MeshStandardMaterial({
        color: OPERATION_COLORS[operation] ?? 0x62e6c8,
        metalness: 0.18,
        roughness: 0.3,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.content.add(mesh);
      this.result = mesh;
    } else {
      this.result = null;
    }

    const floorY = bounds ? bounds.min[1] - 0.05 : -1.7;
    this.grid.position.y = floorY;
    this.shadow.position.y = floorY - 0.002;
    this.frameBounds(bounds, accent);
  }

  frameBounds(bounds, accent) {
    if (!bounds) return;
    this.lastBounds = bounds;
    const center = new THREE.Vector3(
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      (bounds.min[2] + bounds.max[2]) * 0.5,
    );
    const radius = Math.max(
      Math.hypot(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      ) * 0.5,
      0.7,
    );
    const direction = new THREE.Vector3(1.25, 0.82, 1.45).normalize();
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.24;
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.35;
    this.controls.maxDistance = distance * 4;
    this.controls.update();
    this.scene.fog = new THREE.FogExp2(0x071117, 0.018 / Math.max(radius, 0.5));
    document.documentElement.style.setProperty('--accent', accent ?? '#62e6c8');
  }

  setInputVisibility(visible) {
    this.showInputs = visible;
    for (const ghost of this.inputGhosts ?? []) ghost.visible = visible;
  }

  resetView() {
    if (this.lastBounds) this.frameBounds(this.lastBounds);
  }

  animate = () => {
    this.animationFrame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
