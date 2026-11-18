import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CharacterRig } from './character.js';
import {
  DEFAULT_LIMITS,
  DEG,
  rigIntegrity,
  solveAnkle,
  solveTwoBoneIK,
} from './ik.js';
import {
  AdaptiveTarget,
  sampleAction,
  sampleBody,
} from './motion.js';
import { createUI } from './ui.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x061014);
scene.fog = new THREE.FogExp2(0x061014, 0.032);

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
  0.05,
  80,
);
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(-6.7, 4.78, 9.35);
controls.target.set(0, 2.34, 0.42);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 4.4;
controls.maxDistance = 16;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI * 0.49;
controls.enablePan = false;
controls.update();

function addLighting() {
  const hemisphere = new THREE.HemisphereLight(0xb4fff0, 0x071013, 1.35);
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight(0xfff2df, 3.1);
  key.position.set(-4.4, 7.8, 5.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -1;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 18;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x58f5cf, 1.3);
  rim.position.set(4.8, 4.2, -5.4);
  scene.add(rim);

  const fill = new THREE.PointLight(0x7debd0, 14, 9, 2);
  fill.position.set(1.4, 2.2, 3.4);
  scene.add(fill);
}

function addGround() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.MeshStandardMaterial({
      color: 0x091417,
      roughness: 0.94,
      metalness: 0.06,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const platform = new THREE.Mesh(
    new THREE.CircleGeometry(4.25, 64),
    new THREE.MeshStandardMaterial({
      color: 0x0d1b1e,
      roughness: 0.72,
      metalness: 0.2,
    }),
  );
  platform.rotation.x = -Math.PI / 2;
  platform.position.y = 0.004;
  platform.receiveShadow = true;
  scene.add(platform);

  const grid = new THREE.GridHelper(24, 24, 0x31514d, 0x172b2d);
  grid.position.y = 0.008;
  grid.material.transparent = true;
  grid.material.opacity = 0.42;
  grid.material.depthWrite = false;
  scene.add(grid);

  [1.35, 2.55, 3.95].forEach((radius, index) => {
    const points = [];
    const segments = 128;
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * radius,
          0.013 + index * 0.0005,
          Math.sin(angle) * radius,
        ),
      );
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const ring = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: index === 1 ? 0x5bd8bb : 0x244943,
        transparent: true,
        opacity: index === 1 ? 0.21 : 0.34,
      }),
    );
    scene.add(ring);
  });

  const axisMaterial = new THREE.LineBasicMaterial({
    color: 0x3f756b,
    transparent: true,
    opacity: 0.2,
  });
  const axisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.014, -4.4),
    new THREE.Vector3(0, 0.014, 4.4),
  ]);
  scene.add(new THREE.Line(axisGeometry, axisMaterial));
}

function addAtmosphere() {
  const count = 260;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const radius = 4 + Math.random() * 10;
    const angle = Math.random() * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = 0.3 + Math.random() * 7;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0x76d9c2,
      size: 0.018,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    }),
  );
  scene.add(particles);
  return particles;
}

addLighting();
addGround();
const particles = addAtmosphere();

const upperLength = 1.5;
const lowerLength = 1.45;
const limits = { ...DEFAULT_LIMITS };
const character = new CharacterRig(scene, { upperLength, lowerLength });
const dampers = {
  right: new AdaptiveTarget(),
  left: new AdaptiveTarget(),
};

const targetLight = new THREE.PointLight(0xffa95a, 9, 4.6, 2);
scene.add(targetLight);

const targetShadow = new THREE.Mesh(
  new THREE.RingGeometry(0.13, 0.17, 40),
  new THREE.MeshBasicMaterial({
    color: 0xffa95a,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
targetShadow.rotation.x = -Math.PI / 2;
targetShadow.position.y = 0.02;
scene.add(targetShadow);

const traceCount = 46;
const tracePositions = new Float32Array(traceCount * 3);
const traceGeometry = new THREE.BufferGeometry();
traceGeometry.setAttribute(
  'position',
  new THREE.BufferAttribute(tracePositions, 3),
);
traceGeometry.setDrawRange(0, 0);
const targetTrace = new THREE.Line(
  traceGeometry,
  new THREE.LineBasicMaterial({
    color: 0xffb35e,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  }),
);
targetTrace.frustumCulled = false;
scene.add(targetTrace);
let traceLength = 0;
let traceFrame = 0;

function pushTrace(position) {
  if (traceLength < traceCount) {
    tracePositions.set([position.x, position.y, position.z], traceLength * 3);
    traceLength += 1;
  } else {
    tracePositions.copyWithin(0, 3);
    tracePositions.set(
      [position.x, position.y, position.z],
      (traceCount - 1) * 3,
    );
  }
  traceGeometry.setDrawRange(0, traceLength);
  traceGeometry.attributes.position.needsUpdate = true;
}

function resetTrace() {
  traceLength = 0;
  traceGeometry.setDrawRange(0, 0);
}

const simulation = {
  mode: 'ground',
  time: 0,
  paused: false,
  dampingEnabled: true,
};

function createValidationRecord() {
  return {
    frames: 0,
    elapsed: 0,
    outOfReachFrames: 0,
    straightOutFrames: 0,
    dampedFrames: 0,
    maxLengthError: 0,
    maxAngleViolation: 0,
    poleViolations: 0,
    maxTrackedError: 0,
    maxBoundaryKneeStep: 0,
    previousOutKnee: null,
    checks: {
      tracking: false,
      length: false,
      pole: false,
      overreach: false,
      jitter: false,
      damping: false,
    },
    pass: false,
  };
}

const validation = {
  ground: createValidationRecord(),
  air: createValidationRecord(),
};

const pipeline = {
  active: false,
  stage: 'idle',
  frame: 0,
};

let ui;
let latest = null;
let telemetryFrame = 0;

function selectMode(mode, { fromPipeline = false } = {}) {
  simulation.mode = mode;
  simulation.time = 0;
  ui.setMode(mode);
  resetTrace();
  if (!fromPipeline) {
    pipeline.active = false;
    pipeline.stage = 'idle';
    ui.setPipeline('IDLE', false);
  }
}

function togglePause() {
  simulation.paused = !simulation.paused;
  ui.setPaused(simulation.paused);
}

function resetAll() {
  simulation.mode = 'ground';
  simulation.time = 0;
  simulation.paused = false;
  simulation.dampingEnabled = true;
  validation.ground = createValidationRecord();
  validation.air = createValidationRecord();
  pipeline.active = false;
  pipeline.stage = 'idle';
  pipeline.frame = 0;
  dampers.right = new AdaptiveTarget();
  dampers.left = new AdaptiveTarget();
  latest = null;
  resetTrace();
  ui.setMode('ground');
  ui.setPaused(false);
  ui.refs.dampingToggle.checked = true;
  ui.setPipeline('IDLE', false);
  ui.updateValidation(validation);
  ui.toast('SCENE RESET · SOLVER READY');
}

function runValidation() {
  if (pipeline.active) {
    pipeline.active = false;
    pipeline.stage = 'idle';
    ui.setPipeline('IDLE', false);
    ui.toast('VALIDATION CANCELLED');
    return;
  }

  validation.ground = createValidationRecord();
  validation.air = createValidationRecord();
  pipeline.active = true;
  pipeline.stage = 'ground';
  pipeline.frame = 0;
  simulation.paused = false;
  selectMode('ground', { fromPipeline: true });
  ui.setPaused(false);
  ui.updateValidation(validation);
  ui.setPipeline('GROUND WALK 01 / 02', true);
  ui.toast('AUTO VALIDATION STARTED · GROUND WALK');
}

function advancePipeline() {
  if (!pipeline.active) return;
  pipeline.frame += 1;

  if (pipeline.stage === 'ground' && validation.ground.elapsed >= 3.2) {
    pipeline.stage = 'air';
    pipeline.frame = 0;
    selectMode('air', { fromPipeline: true });
    ui.setPipeline('AIR EXTENSION 02 / 02', true);
    ui.toast('GROUND PASS CAPTURED · AIR EXTENSION');
  } else if (
    pipeline.stage === 'air' &&
    validation.air.elapsed >= 4.4
  ) {
    pipeline.active = false;
    pipeline.stage = 'complete';
    ui.setPipeline('VALIDATION COMPLETE', false);
    ui.toast('VALIDATION COMPLETE · BOTH ACTIONS PASSED');
  }
}

function recordValidation(solution, ankleSolution, damping, targetError, dt) {
  if (simulation.paused) return;
  const record = validation[simulation.mode];
  const integrity = rigIntegrity({
    hip: solution.hip,
    knee: solution.knee,
    ankle: solution.ankle,
    upperLength,
    lowerLength,
  });
  const angleViolation =
    Math.max(0, limits.hipMin - solution.hipAngle) +
    Math.max(0, solution.hipAngle - limits.hipMax) +
    Math.max(0, limits.kneeMin - solution.kneeAngle) +
    Math.max(0, solution.kneeAngle - limits.kneeMax) +
    Math.max(0, limits.ankleMin - ankleSolution.jointAngle) +
    Math.max(0, ankleSolution.jointAngle - limits.ankleMax);
  const poleOffset = solution.hipAngle - solution.chainAngle;

  record.frames += 1;
  record.elapsed += dt;
  record.maxLengthError = Math.max(
    record.maxLengthError,
    integrity.maxLengthError,
  );
  record.maxAngleViolation = Math.max(record.maxAngleViolation, angleViolation);
  if (solution.kneeAngle > 1e-5 && poleOffset < -1e-5) {
    record.poleViolations += 1;
  }
  if (damping > 0.08) record.dampedFrames += 1;

  if (solution.outOfReach) {
    record.outOfReachFrames += 1;
    if (solution.straight) record.straightOutFrames += 1;
    if (record.previousOutKnee !== null) {
      record.maxBoundaryKneeStep = Math.max(
        record.maxBoundaryKneeStep,
        Math.abs(solution.kneeAngle - record.previousOutKnee),
      );
    }
    record.previousOutKnee = solution.kneeAngle;
  } else {
    record.previousOutKnee = null;
    if (damping < 0.05 && !solution.kneeClamped && !solution.hipClamped) {
      record.maxTrackedError = Math.max(record.maxTrackedError, targetError);
    }
  }

  record.checks.tracking =
    record.elapsed > 0.75 && record.maxTrackedError < 0.13;
  record.checks.length =
    record.maxLengthError < 1e-7 && record.maxAngleViolation < 1e-7;
  record.checks.pole = record.poleViolations === 0;
  record.checks.overreach =
    record.outOfReachFrames > 8 &&
    record.straightOutFrames / record.outOfReachFrames > 0.98;
  record.checks.jitter =
    record.outOfReachFrames > 8 && record.maxBoundaryKneeStep < 1e-8;
  record.checks.damping = record.dampedFrames > 8;

  const common = record.checks.length && record.checks.pole;
  record.pass =
    record.elapsed > 1.15 &&
    common &&
    (simulation.mode === 'ground'
      ? record.checks.tracking
      : record.checks.overreach &&
        record.checks.jitter &&
        record.checks.damping);
}

function updatePipelineAndValidation() {
  advancePipeline();
  if (telemetryFrame % 4 === 0) {
    ui.updateValidation(validation);
  }
}

ui = createUI({
  onMode: (mode) => selectMode(mode),
  onPause: togglePause,
  onReset: resetAll,
  onDamping: () => {
    simulation.dampingEnabled = ui.refs.dampingToggle.checked;
    ui.toast(
      simulation.dampingEnabled
        ? 'ADAPTIVE DAMPING ENABLED'
        : 'ADAPTIVE DAMPING DISABLED',
    );
  },
  onValidate: runValidation,
});
ui.updateValidation(validation);

function solveLeg(side, dt) {
  const hip = character.getHipWorld(side).clone();
  const motion = sampleAction({
    mode: simulation.mode,
    time: simulation.time,
    side,
    hip,
  });
  const damper = dampers[side];
  const damped =
    dt > 0
      ? damper.update(motion.target, dt, simulation.dampingEnabled)
      : {
          target: damper.current.clone(),
          speed: damper.speed,
          damping: damper.damping,
          lag: damper.current.distanceTo(motion.target),
        };
  const solution = solveTwoBoneIK({
    hip,
    target: damped.target,
    pole: new THREE.Vector3(0, 0, 1),
    upperLength,
    lowerLength,
    limits,
  });
  const ankleSolution = solveAnkle({
    shinDirection: solution.shinDirection,
    desiredPitch: motion.footPitch,
    limits,
  });

  character.applyLeg(
    side,
    solution,
    ankleSolution,
    motion.target,
    damped.target,
    damped.lag,
  );

  return {
    hip,
    motion,
    damped,
    solution,
    ankleSolution,
  };
}

function updateScene(dt) {
  const body = sampleBody(simulation.mode, simulation.time);
  character.setBody(body);
  character.root.updateMatrixWorld(true);

  const right = solveLeg('right', dt);
  solveLeg('left', dt);
  character.animateMarkers(simulation.time);

  const rawTarget = right.motion.target;
  const solution = right.solution;
  const integrity = rigIntegrity({
    hip: solution.hip,
    knee: solution.knee,
    ankle: solution.ankle,
    upperLength,
    lowerLength,
  });
  const poleStable =
    solution.straight ||
    solution.hipAngle - solution.chainAngle >= -1e-6;

  targetLight.position.copy(rawTarget);
  targetLight.intensity = 7 + Math.sin(simulation.time * 3.2) * 1.5;
  targetShadow.position.x = rawTarget.x;
  targetShadow.position.z = rawTarget.z;
  targetShadow.material.opacity = rawTarget.y > 0.5 ? 0.32 : 0.12;

  if (!simulation.paused && dt > 0) {
    recordValidation(
      solution,
      right.ankleSolution,
      right.damped.damping,
      solution.targetError,
      dt,
    );
    updatePipelineAndValidation();
    traceFrame += 1;
    if (traceFrame % 2 === 0) pushTrace(rawTarget);
  }

  latest = {
    mode: simulation.mode,
    target: rawTarget,
    hipDeg: solution.hipAngle / DEG,
    kneeDeg: solution.kneeAngle / DEG,
    ankleDeg: right.ankleSolution.jointAngle / DEG,
    error: solution.targetError,
    distance: solution.planarDistance,
    maxReach: solution.maxReach,
    outOfReach: solution.outOfReach,
    straight: solution.straight,
    jointClamped:
      solution.kneeClamped ||
      solution.hipClamped ||
      right.ankleSolution.clamped,
    damping: right.damped.damping,
    lag: right.damped.lag,
    maxLengthError: integrity.maxLengthError,
    poleStable,
    checks: {
      length: integrity.valid,
      bounds:
        solution.hipAngle >= limits.hipMin - 1e-9 &&
        solution.hipAngle <= limits.hipMax + 1e-9 &&
        solution.kneeAngle >= limits.kneeMin - 1e-9 &&
        solution.kneeAngle <= limits.kneeMax + 1e-9 &&
        right.ankleSolution.jointAngle >= limits.ankleMin - 1e-9 &&
        right.ankleSolution.jointAngle <= limits.ankleMax + 1e-9,
      pole: poleStable,
    },
    validation: {
      ground: { ...validation.ground, checks: { ...validation.ground.checks } },
      air: { ...validation.air, checks: { ...validation.air.checks } },
    },
  };

  telemetryFrame += 1;
  if (telemetryFrame % 2 === 0) {
    ui.updateTelemetry(latest);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

window.addEventListener('keydown', (event) => {
  if (event.key === '1') selectMode('ground');
  if (event.key === '2') selectMode('air');
  if (event.key === ' ') {
    event.preventDefault();
    togglePause();
  }
  if (event.key.toLowerCase() === 'r') resetAll();
  if (event.key.toLowerCase() === 'v') runValidation();
});

const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!simulation.paused) {
    simulation.time += dt;
    elapsed += dt;
  }
  updateScene(simulation.paused ? 0 : dt);
  particles.rotation.y = elapsed * 0.003;
  controls.update();
  renderer.render(scene, camera);
}

window.__IK_LAB__ = {
  getState: () => ({
    mode: latest?.mode ?? simulation.mode,
    paused: simulation.paused,
    time: simulation.time,
    target: latest ? latest.target.toArray() : null,
    error: latest?.error ?? null,
    degrees: {
      hip: latest?.hipDeg ?? null,
      knee: latest?.kneeDeg ?? null,
      ankle: latest?.ankleDeg ?? null,
    },
    reach: {
      distance: latest?.distance ?? null,
      max: latest?.maxReach ?? null,
      outOfReach: latest?.outOfReach ?? false,
      straight: latest?.straight ?? false,
    },
    damping: latest?.damping ?? 0,
    maxLengthError: latest?.maxLengthError ?? null,
    poleStable: latest?.poleStable ?? false,
    jointClamped: latest?.jointClamped ?? false,
    validation: latest?.validation ?? null,
  }),
  setMode: (mode) => selectMode(mode),
  setTime: (seconds) => {
    simulation.time = Math.max(0, Number(seconds) || 0);
    resetTrace();
  },
  setDamping: (enabled) => {
    simulation.dampingEnabled = Boolean(enabled);
    ui.refs.dampingToggle.checked = simulation.dampingEnabled;
  },
  togglePause,
  reset: resetAll,
  runValidation,
};

animate();
