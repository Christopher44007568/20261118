// Run / wave animation clips (keyframed local rotations) and a crossfader.
import { Quat } from './math.js';
import { sampleClip, blendPoses } from './rig.js';

const D2R = Math.PI / 180;
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

// Compose rotations applied in the order given, e.g. rot(30, X, -60, Z).
function rot(...axisDeg) {
  let q = Quat.identity();
  for (let i = 0; i < axisDeg.length; i += 2) {
    const axis = axisDeg[i + 1];
    q = Quat.multiply(Quat.axisAngle(axis, axisDeg[i] * D2R), q);
  }
  return q;
}

const q = (t, ...axisDeg) => ({ t, q: rot(...axisDeg) });
const v = (t, x, y, z) => ({ t, v: [x, y, z] });

// --- Run cycle: 0.75 s, legs alternate, arms counter-swing, hips bob. ---
export const RUN = {
  name: 'run',
  duration: 0.75,
  tracks: {
    rootPos: [v(0, 0, -0.02, 0), v(0.1875, 0, 0.015, 0), v(0.375, 0, -0.02, 0),
              v(0.5625, 0, 0.015, 0), v(0.75, 0, -0.02, 0)],
    hips:      [q(0, 5, Y), q(0.375, -5, Y), q(0.75, 5, Y)],
    spine:     [q(0, 10, X)],
    chest:     [q(0, 6, X, 8, Y), q(0.375, 6, X, -8, Y), q(0.75, 6, X, 8, Y)],
    head:      [q(0, -10, X)],
    upperLegL: [q(0, 40, X), q(0.375, -30, X), q(0.75, 40, X)],
    upperLegR: [q(0, -30, X), q(0.375, 40, X), q(0.75, -30, X)],
    lowerLegL: [q(0, -8, X), q(0.19, -15, X), q(0.375, -25, X),
                q(0.56, -75, X), q(0.75, -8, X)],
    lowerLegR: [q(0, -25, X), q(0.1875, -75, X), q(0.375, -8, X),
                q(0.56, -15, X), q(0.75, -25, X)],
    footL:     [q(0, 12, X), q(0.375, -18, X), q(0.75, 12, X)],
    footR:     [q(0, -18, X), q(0.375, 12, X), q(0.75, -18, X)],
    upperArmL: [q(0, -30, X, -60, Z), q(0.375, 35, X, -60, Z),
                q(0.75, -30, X, -60, Z)],
    upperArmR: [q(0, 35, X, 60, Z), q(0.375, -30, X, 60, Z),
                q(0.75, 35, X, 60, Z)],
    lowerArmL: [q(0, -35, Y), q(0.375, -55, Y), q(0.75, -35, Y)],
    lowerArmR: [q(0, 55, Y), q(0.375, 35, Y), q(0.75, 55, Y)],
  },
};

// --- Wave: 1.6 s, right arm raised and waving, relaxed stance. ---
export const WAVE = {
  name: 'wave',
  duration: 1.6,
  tracks: {
    rootPos: [v(0, 0, 0, 0), v(0.8, 0, -0.005, 0), v(1.6, 0, 0, 0)],
    spine:     [q(0, 0, Z), q(0.8, 4, Z), q(1.6, 0, Z)],
    chest:     [q(0, 0, X), q(0.8, 2, X), q(1.6, 0, X)],
    head:      [q(0, 0, Z), q(0.8, -6, Z), q(1.6, 0, Z)],
    upperArmR: [q(0, -90, Z), q(0.4, -70, Z), q(0.8, -90, Z),
                q(1.2, -110, Z), q(1.6, -90, Z)],
    lowerArmR: [q(0, 0, Z), q(0.2, -25, Z), q(0.6, 25, Z),
                q(1.0, -25, Z), q(1.4, 25, Z), q(1.6, 0, Z)],
    handR:     [q(0, 0, Z), q(0.3, -20, Z), q(0.7, 20, Z),
                q(1.1, -20, Z), q(1.5, 20, Z), q(1.6, 0, Z)],
    upperArmL: [q(0, -70, Z)],
    lowerArmL: [q(0, -10, Z)],
    upperLegL: [q(0, 6, X)],
    upperLegR: [q(0, -2, X)],
    lowerLegL: [q(0, -10, X)],
    lowerLegR: [q(0, -10, X)],
    footL:     [q(0, 4, X)],
    footR:     [q(0, 4, X)],
  },
};

export const CLIPS = { run: RUN, wave: WAVE };

// Crossfader: blends from the active clip to a target over `fadeTime`.
export class Crossfader {
  constructor(fadeTime = 0.4) {
    this.current = 'run';
    this.target = 'run';
    this.fadeTime = fadeTime;
    this.fadeElapsed = fadeTime;
    this.timeCurrent = 0;
    this.timeTarget = 0;
  }

  // Switch clips; no-op if already there or already fading to it.
  play(name) {
    if (!CLIPS[name] || name === this.target) return;
    this.current = this.target;
    this.timeCurrent = this.timeTarget;
    this.target = name;
    this.timeTarget = 0;
    this.fadeElapsed = 0;
  }

  get blending() {
    return this.fadeElapsed < this.fadeTime;
  }

  update(dt) {
    this.timeCurrent += dt;
    this.timeTarget += dt;
    if (this.blending) this.fadeElapsed += dt;
    const poseA = sampleClip(CLIPS[this.current], this.timeCurrent);
    if (!this.blending) return poseA;
    const poseB = sampleClip(CLIPS[this.target], this.timeTarget);
    const f = Math.min(1, this.fadeElapsed / this.fadeTime);
    const s = f * f * (3 - 2 * f); // smoothstep fade curve
    return blendPoses(poseA, poseB, s);
  }
}
