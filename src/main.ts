import "./style.css";
import { WebGLRenderer, type CameraView, type DebugState, type SceneRenderMetrics } from "./renderer";
import { createScenes, type CameraPose, type DemoScene } from "./scenes";
import { AppUi, type CameraPreset } from "./ui";
import { verifyShadowMask, type ShadowVerification } from "./verification";
import { vec3, type Vec3 } from "./math";

interface OrbitState {
  target: Vec3;
  distance: number;
  azimuth: number;
  elevation: number;
  near: number;
  far: number;
}

interface DemoSnapshot {
  webgl2: boolean;
  scene: number;
  sceneTitle: string;
  camera: CameraView;
  debug: DebugState;
  metrics: SceneRenderMetrics;
  verification: ShadowVerification | null;
  openEdges: number;
  nonManifoldEdges: number;
}

const FOV_Y = (47 * Math.PI) / 180;
const canvas = document.querySelector<HTMLCanvasElement>("#gl")!;
const uiRoot = document.querySelector<HTMLElement>("#ui")!;

function orbitFromPose(pose: CameraPose): OrbitState {
  const offset = vec3.sub(pose.position, pose.target);
  const distance = Math.max(vec3.length(offset), 0.1);
  return {
    target: [...pose.target],
    distance,
    azimuth: Math.atan2(offset[0], offset[2]),
    elevation: Math.asin(Math.max(-1, Math.min(1, offset[1] / distance))),
    near: pose.near,
    far: pose.far,
  };
}

function orbitCamera(orbit: OrbitState): CameraView {
  const horizontal = Math.cos(orbit.elevation) * orbit.distance;
  return {
    position: [
      orbit.target[0] + Math.sin(orbit.azimuth) * horizontal,
      orbit.target[1] + Math.sin(orbit.elevation) * orbit.distance,
      orbit.target[2] + Math.cos(orbit.azimuth) * horizontal,
    ],
    target: [...orbit.target],
    near: orbit.near,
    far: orbit.far,
    fovY: FOV_Y,
  };
}

function verificationCounts(scene: DemoScene): { open: number; nonManifold: number } {
  let open = 0;
  let nonManifold = 0;
  for (const mesh of scene.invalid) {
    for (const violation of mesh.validation.violations) {
      if (violation.kind === "open") open += 1;
      if (violation.kind === "non-manifold") nonManifold += 1;
    }
  }
  return { open, nonManifold };
}

function boot(): void {
  const scenes = createScenes();
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer(canvas);
  } catch (error) {
    uiRoot.innerHTML = `<div class="toast">无法启动 WebGL2：<br>${String(error)}</div>`;
    return;
  }
  let sceneIndex = 0;
  let scene = scenes[0]!;
  let orbit = orbitFromPose(scene.defaultCamera);
  let camera = orbitCamera(orbit);
  let debug: DebugState = {
    showVolume: false,
    showStencil: false,
    showSilhouette: false,
  };
  let metrics: SceneRenderMetrics = renderer.setScene(scene);
  let verification: ShadowVerification | null = null;
  let dirty = true;
  let verificationQueued = true;
  let verificationTimer: number | null = null;
  let lastVerification = 0;

  const ui = new AppUi(uiRoot, scenes, {
    onScene: (index) => selectScene(index),
    onDebug: (key) => toggleDebug(key),
    onPreset: (preset) => setPreset(preset),
  });
  ui.setScene(sceneIndex, scene, metrics);
  ui.setCamera(camera);
  ui.setDebug(debug);
  scheduleVerification(0);

  function currentCamera(): CameraView {
    return orbitCamera(orbit);
  }

  function requestRender(verify = false): void {
    dirty = true;
    if (verify) scheduleVerification(150);
  }

  function scheduleVerification(delay: number): void {
    verificationQueued = true;
    if (verificationTimer !== null) window.clearTimeout(verificationTimer);
    verificationTimer = window.setTimeout(() => {
      dirty = true;
      verificationTimer = null;
    }, delay);
  }

  function performVerification(): void {
    const mask = renderer.renderShadowMask(camera);
    verification = verifyShadowMask(scene, camera, mask);
    lastVerification = performance.now();
    verificationQueued = false;
    ui.setVerification(verification);
  }

  function selectScene(index: number): void {
    if (index < 0 || index >= scenes.length) return;
    sceneIndex = index;
    scene = scenes[index]!;
    metrics = renderer.setScene(scene);
    orbit = orbitFromPose(scene.defaultCamera);
    camera = currentCamera();
    verification = null;
    ui.setScene(sceneIndex, scene, metrics);
    ui.setCamera(camera);
    ui.setVerification(null, true);
    ui.showError(null);
    requestRender(true);
  }

  function setPreset(preset: CameraPreset): void {
    const pose =
      preset === "inside"
        ? scene.insideCamera
        : preset === "near"
          ? scene.nearCamera
          : scene.defaultCamera;
    orbit = orbitFromPose(pose);
    camera = currentCamera();
    ui.setScene(sceneIndex, scene, metrics);
    ui.setCamera(camera);
    requestRender(true);
  }

  function toggleDebug(key: keyof DebugState, force?: boolean): void {
    debug = { ...debug, [key]: force ?? !debug[key] };
    ui.setDebug(debug);
    requestRender();
  }

  function resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(window.innerWidth * ratio));
    const height = Math.max(1, Math.floor(window.innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      dirty = true;
    }
  }

  let dragPointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (event) => {
    dragPointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== dragPointer) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    orbit.azimuth -= dx * 0.006;
    orbit.elevation = Math.max(
      -0.12,
      Math.min(1.38, orbit.elevation + dy * 0.005),
    );
    camera = currentCamera();
    ui.setCamera(camera);
    requestRender(true);
  });
  const finishDrag = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointer) return;
    dragPointer = null;
    canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      orbit.distance = Math.max(1.1, Math.min(24, orbit.distance * Math.exp(event.deltaY * 0.0012)));
      camera = currentCamera();
      ui.setCamera(camera);
      requestRender(true);
    },
    { passive: false },
  );
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.code.startsWith("Digit")) {
      const index = Number(event.code.slice(5)) - 1;
      if (index >= 0 && index < scenes.length) {
        selectScene(index);
        return;
      }
    }
    if (event.code === "KeyV") toggleDebug("showVolume");
    if (event.code === "KeyS") toggleDebug("showSilhouette");
    if (event.code === "KeyT") toggleDebug("showStencil");
    if (event.code === "KeyI") setPreset("inside");
    if (event.code === "KeyN") setPreset("near");
    if (event.code === "KeyR") setPreset("default");
    if (event.code === "Digit0" || event.code === "Escape") {
      debug = { showVolume: false, showStencil: false, showSilhouette: false };
      ui.setDebug(debug);
      requestRender();
    }
  });
  window.addEventListener("resize", resize);
  resize();

  function snapshot(): DemoSnapshot {
    const counts = verificationCounts(scene);
    return {
      webgl2: true,
      scene: sceneIndex,
      sceneTitle: scene.title,
      camera,
      debug,
      metrics,
      verification,
      openEdges: counts.open,
      nonManifoldEdges: counts.nonManifold,
    };
  }

  function renderFrame(now: number): void {
    resize();
    if (dirty) {
      camera = currentCamera();
      renderer.render(camera, debug);
      if (verificationQueued && now - lastVerification >= 80) {
        performVerification();
      }
      dirty = false;
    }
    if (verificationQueued && verificationTimer === null && !dirty) {
      dirty = true;
    }
    requestAnimationFrame(renderFrame);
  }
  requestAnimationFrame(renderFrame);

  interface DemoApi {
    selectScene: (index: number) => void;
    setPreset: (preset: CameraPreset) => void;
    setDebug: (key: keyof DebugState, value: boolean) => void;
    verifyNow: () => ShadowVerification;
    getState: () => DemoSnapshot;
    renderer: WebGLRenderer;
  }
  const api: DemoApi = {
    selectScene,
    setPreset,
    setDebug: (key, value) => toggleDebug(key, value),
    verifyNow: () => {
      camera = currentCamera();
      renderer.render(camera, debug);
      performVerification();
      return verification!;
    },
    getState: snapshot,
    renderer,
  };
  (window as Window & { __shadowDemo?: DemoApi }).__shadowDemo = api;
}

boot();
