import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  boneQuaternion,
  footQuaternion,
} from './ik.js';

const POLE = new THREE.Vector3(0, 0, 1);

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.12,
    ...options,
  });
}

function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.18, 'rgba(255,190,105,0.55)');
  gradient.addColorStop(0.52, 'rgba(255,160,60,0.13)');
  gradient.addColorStop(1, 'rgba(255,150,50,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeTextSprite(text, color = '#ffbd72') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.font = '600 20px "SFMono-Regular", Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = 'rgba(6,15,18,0.7)';
  context.fillRect(28, 16, 200, 32);
  context.strokeStyle = 'rgba(255,184,105,0.35)';
  context.strokeRect(28, 16, 200, 32);
  context.fillStyle = color;
  context.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.78, 0.195, 1);
  return sprite;
}

function addSegmentMesh(parent, length, radius) {
  const geometry = new THREE.CapsuleGeometry(radius, Math.max(length - radius * 2, 0.05), 8, 18);
  const mesh = new THREE.Mesh(geometry, standardMaterial(0xd9ddd7, { roughness: 0.38 }));
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);

  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.44, Math.max(length - 0.18, 0.1), 0.016),
    standardMaterial(0x7df7d2, {
      roughness: 0.26,
      metalness: 0.4,
      emissive: 0x1ac39d,
      emissiveIntensity: 0.55,
    }),
  );
  strip.position.set(0, -length / 2, radius + 0.012);
  mesh.add(strip);
  return mesh;
}

function addJoint(parent, radius, active) {
  const joint = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 2),
    standardMaterial(0x233237, { roughness: 0.25, metalness: 0.7 }),
  );
  joint.castShadow = true;
  parent.add(joint);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.13, 0.012, 6, 32),
    standardMaterial(active ? 0x78f5cf : 0x61706f, {
      metalness: 0.6,
      emissive: active ? 0x27b893 : 0x0b1516,
      emissiveIntensity: active ? 0.8 : 0.1,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  joint.add(ring);
  return joint;
}

class LegRig {
  constructor({ scene, root, side, x, upperLength, lowerLength, active }) {
    this.scene = scene;
    this.side = side;
    this.active = active;
    this.upperLength = upperLength;
    this.lowerLength = lowerLength;

    this.hipAnchor = new THREE.Group();
    this.hipAnchor.position.set(x, 2.96, 0);
    root.add(this.hipAnchor);

    this.thighPivot = new THREE.Group();
    this.hipAnchor.add(this.thighPivot);
    this.thighMesh = addSegmentMesh(this.thighPivot, upperLength, 0.125);
    addJoint(this.thighPivot, 0.145, active);

    this.kneePivot = new THREE.Group();
    this.kneePivot.position.y = -upperLength;
    this.thighPivot.add(this.kneePivot);
    this.kneeJoint = addJoint(this.kneePivot, 0.14, active);
    this.shinMesh = addSegmentMesh(this.kneePivot, lowerLength, 0.098);

    this.anklePivot = new THREE.Group();
    this.anklePivot.position.y = -lowerLength;
    this.kneePivot.add(this.anklePivot);
    this.ankleJoint = addJoint(this.anklePivot, 0.09, active);

    this.foot = this.createFoot(active);
    this.foot.position.set(0, -0.035, 0.19);
    this.anklePivot.add(this.foot);

    this.skeletonLine = this.createSkeletonLine(active);
    this.errorLine = this.createErrorLine();
    this.poleGuide = this.createPoleGuide(active);
    this.targetMarker = this.createTargetMarker(active);
    this.smoothedMarker = this.createSmoothedMarker(active);
    this.hipWorld = new THREE.Vector3();
    this.targetPosition = new THREE.Vector3();
    this.smoothedPosition = new THREE.Vector3();
  }

  createFoot(active) {
    const group = new THREE.Group();
    const shoe = new THREE.Mesh(
      new RoundedBoxGeometry(0.31, 0.18, 0.67, 4, 0.065),
      standardMaterial(active ? 0xe1e3da : 0xaeb6b1, {
        roughness: 0.34,
        metalness: 0.18,
      }),
    );
    shoe.position.set(0, -0.035, 0.02);
    shoe.castShadow = true;
    shoe.receiveShadow = true;
    group.add(shoe);

    const sole = new THREE.Mesh(
      new RoundedBoxGeometry(0.285, 0.045, 0.58, 3, 0.018),
      standardMaterial(0x152126, { roughness: 0.72, metalness: 0.08 }),
    );
    sole.position.set(0, -0.135, 0.03);
    sole.castShadow = true;
    group.add(sole);

    const toe = new THREE.Mesh(
      new RoundedBoxGeometry(0.24, 0.09, 0.12, 3, 0.035),
      standardMaterial(active ? 0x78f5cf : 0x667b73, {
        roughness: 0.28,
        metalness: 0.3,
        emissive: active ? 0x1cae8b : 0x081311,
        emissiveIntensity: active ? 0.65 : 0.15,
      }),
    );
    toe.position.set(0, -0.03, 0.3);
    group.add(toe);
    return group;
  }

  createSkeletonLine(active) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(9), 3),
    );
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: active ? 0x78f5cf : 0x506561,
        transparent: true,
        opacity: active ? 0.8 : 0.32,
        depthTest: false,
      }),
    );
    line.renderOrder = 5;
    this.scene.add(line);
    return line;
  }

  createErrorLine() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(6), 3),
    );
    const material = new THREE.LineDashedMaterial({
      color: 0xffa75b,
      dashSize: 0.055,
      gapSize: 0.04,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 4;
    this.scene.add(line);
    return line;
  }

  createPoleGuide(active) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(6), 3),
    );
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0x78f5cf,
        transparent: true,
        opacity: active ? 0.5 : 0.1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.frustumCulled = false;
    this.scene.add(line);
    return line;
  }

  createTargetMarker(active) {
    const group = new THREE.Group();
    const color = active ? 0xffb35e : 0x84928c;
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(active ? 0.07 : 0.045, 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    group.add(core);

    for (let index = 0; index < 3; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(active ? 0.17 : 0.1, 0.007, 5, 36),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: active ? 0.72 : 0.2,
        }),
      );
      if (index === 1) ring.rotation.x = Math.PI / 2;
      if (index === 2) ring.rotation.y = Math.PI / 2;
      group.add(ring);
    }

    if (active) {
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeGlowTexture(),
          color: 0xffb15a,
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.scale.setScalar(1.18);
      group.add(glow);
      const label = makeTextSprite('TARGET');
      label.position.y = 0.36;
      group.add(label);
    }

    group.traverse((child) => {
      if (child.isMesh || child.isSprite) {
        child.material.depthTest = false;
        child.renderOrder = 12;
        if (child.isSprite) child.renderOrder = 11;
      }
    });
    this.scene.add(group);
    return group;
  }

  createSmoothedMarker(active) {
    const marker = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.055, 1),
      new THREE.MeshBasicMaterial({
        color: 0x78f5cf,
        wireframe: true,
        transparent: true,
        opacity: active ? 0.55 : 0.12,
      }),
    );
    marker.visible = false;
    this.scene.add(marker);
    return marker;
  }

  getHipWorld() {
    this.hipAnchor.getWorldPosition(this.hipWorld);
    return this.hipWorld;
  }

  apply(solution, ankleSolution, target, smoothedTarget, lag) {
    const thighWorld = boneQuaternion(solution.thighDirection, POLE);
    const shinWorld = boneQuaternion(solution.shinDirection, POLE);
    const ankleWorld = footQuaternion(ankleSolution);

    this.thighPivot.quaternion.copy(thighWorld);
    this.kneePivot.quaternion
      .copy(thighWorld)
      .invert()
      .multiply(shinWorld);
    this.anklePivot.quaternion
      .copy(shinWorld)
      .invert()
      .multiply(ankleWorld);

    this.targetPosition.copy(target);
    this.smoothedPosition.copy(smoothedTarget);
    this.targetMarker.position.copy(target);
    this.smoothedMarker.position.copy(smoothedTarget);
    this.smoothedMarker.visible = lag > 0.008 && this.active;

    const positions = this.skeletonLine.geometry.attributes.position;
    positions.setXYZ(0, solution.hip.x, solution.hip.y, solution.hip.z);
    positions.setXYZ(1, solution.knee.x, solution.knee.y, solution.knee.z);
    positions.setXYZ(2, solution.ankle.x, solution.ankle.y, solution.ankle.z);
    positions.needsUpdate = true;

    const errorPositions = this.errorLine.geometry.attributes.position;
    errorPositions.setXYZ(
      0,
      solution.ankle.x,
      solution.ankle.y,
      solution.ankle.z,
    );
    errorPositions.setXYZ(1, target.x, target.y, target.z);
    errorPositions.needsUpdate = true;
    this.errorLine.visible = solution.targetError > 0.004;
    this.errorLine.computeLineDistances();

    const polePositions = this.poleGuide.geometry.attributes.position;
    polePositions.setXYZ(
      0,
      solution.knee.x,
      solution.knee.y,
      solution.knee.z,
    );
    polePositions.setXYZ(
      1,
      solution.knee.x,
      solution.knee.y + 0.07,
      solution.knee.z + 0.34,
    );
    polePositions.needsUpdate = true;
  }

  animateMarker(time) {
    const pulse = 1 + Math.sin(time * 3.4) * 0.08;
    this.targetMarker.scale.setScalar(pulse);
    const rings = this.targetMarker.children.filter(
      (child) => child.geometry?.type === 'TorusGeometry',
    );
    rings.forEach((ring, index) => {
      ring.rotation.z = time * (index % 2 === 0 ? 0.45 : -0.32);
    });
  }
}

export class CharacterRig {
  constructor(scene, { upperLength = 1.5, lowerLength = 1.45 } = {}) {
    this.scene = scene;
    this.upperLength = upperLength;
    this.lowerLength = lowerLength;
    this.root = new THREE.Group();
    this.root.position.y = 0.012;
    scene.add(this.root);

    this.upperBody = new THREE.Group();
    this.upperBody.position.y = 3.18;
    this.root.add(this.upperBody);

    this.buildBody();

    this.rightLeg = new LegRig({
      scene,
      root: this.root,
      side: 'right',
      x: 0.325,
      upperLength,
      lowerLength,
      active: true,
    });
    this.leftLeg = new LegRig({
      scene,
      root: this.root,
      side: 'left',
      x: -0.325,
      upperLength,
      lowerLength,
      active: false,
    });
  }

  buildBody() {
    const ceramic = standardMaterial(0xdde1db, {
      roughness: 0.38,
      metalness: 0.14,
    });
    const dark = standardMaterial(0x162328, {
      roughness: 0.34,
      metalness: 0.38,
    });
    const accent = standardMaterial(0x78f5cf, {
      roughness: 0.24,
      metalness: 0.5,
      emissive: 0x1cb48f,
      emissiveIntensity: 0.52,
    });

    const pelvis = new THREE.Mesh(
      new RoundedBoxGeometry(0.96, 0.38, 0.54, 5, 0.14),
      dark,
    );
    pelvis.position.y = -0.02;
    pelvis.castShadow = true;
    pelvis.receiveShadow = true;
    this.upperBody.add(pelvis);

    const waist = new THREE.Mesh(
      new RoundedBoxGeometry(0.56, 0.26, 0.34, 4, 0.09),
      ceramic,
    );
    waist.position.y = 0.24;
    waist.castShadow = true;
    this.upperBody.add(waist);

    const torso = new THREE.Mesh(
      new RoundedBoxGeometry(0.78, 0.92, 0.43, 6, 0.15),
      dark,
    );
    torso.position.set(0, 0.78, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.upperBody.add(torso);

    const chestPlate = new THREE.Mesh(
      new RoundedBoxGeometry(0.52, 0.48, 0.045, 4, 0.08),
      ceramic,
    );
    chestPlate.position.set(0, 0.83, 0.225);
    chestPlate.castShadow = true;
    this.upperBody.add(chestPlate);

    const statusBar = new THREE.Mesh(
      new RoundedBoxGeometry(0.25, 0.045, 0.018, 3, 0.018),
      accent,
    );
    statusBar.position.set(0, 0.88, 0.255);
    this.upperBody.add(statusBar);

    const statusDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.025, 20),
      new THREE.MeshBasicMaterial({ color: 0xffb35e }),
    );
    statusDot.position.set(-0.18, 0.73, 0.256);
    this.upperBody.add(statusDot);

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.13, 0.25, 12),
      dark,
    );
    neck.position.y = 1.35;
    neck.castShadow = true;
    this.upperBody.add(neck);

    const head = new THREE.Mesh(
      new RoundedBoxGeometry(0.4, 0.44, 0.4, 5, 0.15),
      ceramic,
    );
    head.position.set(0, 1.68, 0.01);
    head.castShadow = true;
    head.receiveShadow = true;
    this.upperBody.add(head);

    const visor = new THREE.Mesh(
      new RoundedBoxGeometry(0.31, 0.105, 0.035, 4, 0.04),
      new THREE.MeshStandardMaterial({
        color: 0x0b1c20,
        roughness: 0.12,
        metalness: 0.65,
        emissive: 0x0e5449,
        emissiveIntensity: 0.4,
      }),
    );
    visor.position.set(0, 1.69, 0.208);
    this.upperBody.add(visor);

    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.015, 0.008),
      new THREE.MeshBasicMaterial({ color: 0x78f5cf }),
    );
    eye.position.set(0.045, 1.69, 0.23);
    this.upperBody.add(eye);

    this.buildArm(1, ceramic, dark);
    this.buildArm(-1, ceramic, dark);
  }

  buildArm(side, ceramic, dark) {
    const shoulder = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.15, 2),
      ceramic,
    );
    shoulder.position.set(side * 0.48, 1.11, 0);
    shoulder.castShadow = true;
    this.upperBody.add(shoulder);

    const upper = new THREE.Group();
    upper.position.copy(shoulder.position);
    upper.rotation.z = side * 0.13;
    this.upperBody.add(upper);

    const upperArm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.085, 0.43, 6, 12),
      dark,
    );
    upperArm.position.y = -0.3;
    upperArm.castShadow = true;
    upper.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.61;
    elbow.rotation.x = -0.72;
    upper.add(elbow);

    const elbowJoint = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.095, 2),
      ceramic,
    );
    elbowJoint.castShadow = true;
    elbow.add(elbowJoint);

    const forearm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07, 0.4, 6, 12),
      ceramic,
    );
    forearm.position.y = -0.28;
    forearm.castShadow = true;
    elbow.add(forearm);

    const hand = new THREE.Mesh(
      new RoundedBoxGeometry(0.13, 0.2, 0.11, 3, 0.045),
      dark,
    );
    hand.position.y = -0.56;
    hand.castShadow = true;
    elbow.add(hand);
  }

  getHipWorld(side) {
    const leg = side === 'left' ? this.leftLeg : this.rightLeg;
    return leg.getHipWorld();
  }

  setBody({ x = 0, y = 0, lean = 0, bob = 0 }) {
    this.root.position.x = x;
    this.root.position.y = y;
    this.upperBody.position.y = 3.18 + bob;
    this.upperBody.rotation.x = lean;
  }

  applyLeg(side, solution, ankleSolution, target, smoothedTarget, lag) {
    const leg = side === 'left' ? this.leftLeg : this.rightLeg;
    leg.apply(solution, ankleSolution, target, smoothedTarget, lag);
  }

  animateMarkers(time) {
    this.rightLeg.animateMarker(time);
    this.leftLeg.animateMarker(time);
  }
}
