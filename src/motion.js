import * as THREE from 'three';

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (from, to, t) => from + (to - from) * t;
const smoothstep = (from, to, value) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const smootherstep = (t) => {
  const value = clamp01(t);
  return value * value * value * (value * (value * 6 - 15) + 10);
};

export const WALK_PERIOD = 1.46;
export const AIR_PERIOD = 4.2;

function sampleWalk(time, side) {
  const offset = side === 'right' ? 0.03 : 0.53;
  const phase = (time / WALK_PERIOD + offset) % 1;
  const stance = 0.58;

  let z;
  let height;
  let pitch;
  if (phase < stance) {
    const u = phase / stance;
    z = lerp(0.57, -0.61, u);
    height = 0.17;
    pitch = u > 0.76 ? lerp(0, -13, (u - 0.76) / 0.24) : 0;
  } else {
    const u = (phase - stance) / (1 - stance);
    z = lerp(-0.61, 0.57, smootherstep(u));
    height = 0.17 + Math.sin(Math.PI * u) * 0.45;
    pitch = lerp(-13, 7, smoothstep(0.08, 0.72, u));
  }

  return {
    z,
    y: height,
    pitch: THREE.MathUtils.degToRad(pitch),
    phase,
    stance: phase < stance,
  };
}

function sampleAir(time, side) {
  const phase = (time / AIR_PERIOD) % 1;
  if (side === 'left') {
    return {
      z: -0.12 + Math.sin(time * 2.0) * 0.025,
      y: 1.02 + Math.sin(time * 2.0 + 0.7) * 0.018,
      pitch: THREE.MathUtils.degToRad(-7),
      phase,
      stance: false,
      extension: 0,
    };
  }

  let extension = 0;
  if (phase >= 0.18 && phase < 0.4) {
    extension = smootherstep((phase - 0.18) / 0.22);
  } else if (phase >= 0.4 && phase < 0.54) {
    extension = 1;
  } else if (phase >= 0.54 && phase < 0.82) {
    extension = 1 - smootherstep((phase - 0.54) / 0.28);
  }

  return {
    z: lerp(-0.04, 3.34, extension),
    y: lerp(0.72, 1.56, extension),
    pitch: THREE.MathUtils.degToRad(lerp(2, -15, extension)),
    phase,
    stance: false,
    extension,
  };
}

export function sampleAction({ mode, time, side, hip }) {
  const sample = mode === 'air' ? sampleAir(time, side) : sampleWalk(time, side);
  const swing = mode === 'ground' && !sample.stance ? 1 : 0;

  return {
    mode,
    target: new THREE.Vector3(hip.x, sample.y, sample.z),
    footPitch: sample.pitch,
    phase: sample.phase,
    stance: sample.stance,
    extension: sample.extension ?? 0,
    swing,
  };
}

export function sampleBody(mode, time) {
  if (mode === 'air') {
    return {
      x: Math.sin(time * 1.1) * 0.012,
      y: 0.44 + Math.sin(time * 1.8) * 0.018,
      lean: THREE.MathUtils.degToRad(-5 + Math.sin(time * 1.4) * 1.3),
      bob: Math.sin(time * 1.8) * 0.02,
    };
  }

  const gait = (time / WALK_PERIOD) * Math.PI * 2;
  return {
    x: Math.sin(gait) * 0.017,
    y: 0.012 + Math.cos(gait * 2) * 0.018,
    lean: THREE.MathUtils.degToRad(3.2),
    bob: Math.cos(gait * 2) * 0.025,
  };
}

export class AdaptiveTarget {
  constructor(initial = new THREE.Vector3()) {
    this.current = initial.clone();
    this.previousDesired = initial.clone();
    this.speed = 0;
    this.damping = 0;
    this.initialized = false;
  }

  reset(position) {
    this.current.copy(position);
    this.previousDesired.copy(position);
    this.speed = 0;
    this.damping = 0;
    this.initialized = true;
  }

  update(desired, dt, enabled = true) {
    if (!this.initialized) {
      this.reset(desired);
      return {
        target: this.current.clone(),
        speed: 0,
        damping: 0,
        lag: 0,
      };
    }

    const safeDt = Math.max(dt, 1 / 240);
    const instantaneousSpeed = this.previousDesired.distanceTo(desired) / safeDt;
    const speedBlend = 1 - Math.exp(-11 * safeDt);
    this.speed += (instantaneousSpeed - this.speed) * speedBlend;
    this.previousDesired.copy(desired);

    const targetDamping = enabled
      ? smoothstep(2.65, 6.2, this.speed)
      : 0;
    const dampingBlend = 1 - Math.exp(-9 * safeDt);
    this.damping += (targetDamping - this.damping) * dampingBlend;

    const lambda = lerp(32, 7.5, this.damping);
    this.current.lerp(desired, 1 - Math.exp(-lambda * safeDt));
    if (this.current.distanceToSquared(desired) < 1e-10) {
      this.current.copy(desired);
    }

    return {
      target: this.current.clone(),
      speed: this.speed,
      damping: this.damping,
      lag: this.current.distanceTo(desired),
    };
  }
}
