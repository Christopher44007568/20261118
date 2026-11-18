import {
  MORPH_TARGETS,
  applyMorphTargets,
  createFaceMesh,
  makeWeightSet,
  maxVertexDisplacement,
  runStabilityTest,
} from "./morph.js";

const mesh = createFaceMesh();
const targetById = Object.fromEntries(MORPH_TARGETS.map((target) => [target.id, target]));
const state = {
  rawWeights: { smile: 0.55, blink: 0.15, brow: 0.35 },
  singleTarget: "smile",
};

const elements = {
  ranges: Object.fromEntries(
    MORPH_TARGETS.map((target) => [
      target.id,
      document.querySelector(`#${target.id}-range`),
    ]),
  ),
  outputs: Object.fromEntries(
    MORPH_TARGETS.map((target) => [
      target.id,
      document.querySelector(`#${target.id}-output`),
    ]),
  ),
  singleCanvas: document.querySelector("#single-canvas"),
  combinedCanvas: document.querySelector("#combined-canvas"),
  singleName: document.querySelector("#single-name"),
  singlePeak: document.querySelector("#single-peak"),
  combinedPeak: document.querySelector("#combined-peak"),
  clampNotice: document.querySelector("#clamp-notice"),
  metricCombined: document.querySelector("#metric-combined"),
  metricDelta: document.querySelector("#metric-delta"),
  metricSilhouette: document.querySelector("#metric-silhouette"),
  metricFlips: document.querySelector("#metric-flips"),
  metricSafety: document.querySelector("#metric-safety"),
  metricWeights: document.querySelector("#metric-weights"),
  testBadge: document.querySelector("#test-badge"),
  cycleCount: document.querySelector("#cycle-count"),
  positionResidual: document.querySelector("#position-residual"),
  normalResidual: document.querySelector("#normal-residual"),
  stabilityPill: document.querySelector("#stability-pill"),
};

const LIGHT = normalize3(-0.42, 0.64, 0.82);
let animationFrame = 0;
let latestPoses = null;

function normalize3(x, y, z) {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function formatNumber(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function formatResidual(value) {
  if (Math.abs(value) < 1e-9) return "0.0e+0";
  return value.toExponential(1);
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width: rect.width, height: rect.height, ratio };
}

function screenPoint(x, y, camera) {
  return [
    camera.centerX + x * camera.scale,
    camera.centerY - y * camera.scale,
  ];
}

function makeCamera(width, height) {
  return {
    width,
    height,
    centerX: width * 0.5,
    centerY: height * 0.515,
    scale: Math.min(width / 2.68, height / 2.92),
  };
}

function shadeColor(normal, z, warmth) {
  const diffuse = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
  const rim = Math.pow(1 - Math.min(1, Math.abs(normal[2])), 2.4);
  const depth = Math.max(0, Math.min(1, z * 0.45));
  const light = 0.31 + diffuse * 0.72 + depth * 0.08;
  const red = 205 * light + rim * 24 + warmth * 3;
  const green = 142 * light + rim * 9 + warmth * 1;
  const blue = 112 * light + rim * 12;
  return `rgb(${Math.min(255, red) | 0}, ${Math.min(255, green) | 0}, ${Math.min(255, blue) | 0})`;
}

function drawBackdrop(ctx, camera) {
  ctx.clearRect(0, 0, camera.width, camera.height);

  const halo = ctx.createRadialGradient(
    camera.centerX,
    camera.centerY - camera.scale * 0.05,
    camera.scale * 0.2,
    camera.centerX,
    camera.centerY,
    camera.scale * 1.18,
  );
  halo.addColorStop(0, "rgba(221, 173, 136, 0.080)");
  halo.addColorStop(0.52, "rgba(152, 113, 88, 0.025)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, camera.width, camera.height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(
    camera.centerX,
    camera.centerY + camera.scale * 1.30,
    camera.scale * 0.78,
    camera.scale * 0.10,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();

  const neck = ctx.createLinearGradient(
    0,
    camera.centerY + camera.scale * 0.76,
    0,
    camera.height,
  );
  neck.addColorStop(0, "#6a473b");
  neck.addColorStop(0.48, "#382823");
  neck.addColorStop(1, "#151315");
  ctx.fillStyle = neck;
  ctx.beginPath();
  ctx.moveTo(...screenPoint(-0.37, -0.96, camera));
  ctx.lineTo(...screenPoint(-0.33, -1.26, camera));
  ctx.quadraticCurveTo(
    ...screenPoint(-0.78, -1.38, camera),
    ...screenPoint(-1.05, -1.55, camera),
  );
  ctx.lineTo(...screenPoint(1.05, -1.55, camera));
  ctx.quadraticCurveTo(
    ...screenPoint(0.78, -1.38, camera),
    ...screenPoint(0.33, -1.26, camera),
  );
  ctx.lineTo(...screenPoint(0.37, -0.96, camera));
  ctx.closePath();
  ctx.fill();

  const collar = ctx.createLinearGradient(
    camera.centerX,
    camera.centerY + camera.scale * 1.15,
    camera.centerX,
    camera.height,
  );
  collar.addColorStop(0, "rgba(19, 24, 28, 0.9)");
  collar.addColorStop(1, "rgba(11, 14, 18, 0.98)");
  ctx.fillStyle = collar;
  ctx.beginPath();
  ctx.moveTo(...screenPoint(-0.44, -1.28, camera));
  ctx.quadraticCurveTo(
    ...screenPoint(0, -1.53, camera),
    ...screenPoint(0.44, -1.28, camera),
  );
  ctx.lineTo(...screenPoint(0.44, -1.55, camera));
  ctx.lineTo(...screenPoint(-0.44, -1.55, camera));
  ctx.closePath();
  ctx.fill();
}

function drawMeshSurface(ctx, pose, camera) {
  const positions = pose.positions;
  const normals = pose.normals;
  const triangles = mesh.triangles;

  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index] * 3;
    const b = triangles[index + 1] * 3;
    const c = triangles[index + 2] * 3;
    const normal = [
      (normals[a] + normals[b] + normals[c]) / 3,
      (normals[a + 1] + normals[b + 1] + normals[c + 1]) / 3,
      (normals[a + 2] + normals[b + 2] + normals[c + 2]) / 3,
    ];
    const averageZ = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const warmth = (positions[a] + positions[b] + positions[c]) / 3;
    const color = shadeColor(normal, averageZ, warmth);

    ctx.beginPath();
    ctx.moveTo(...screenPoint(positions[a], positions[a + 1], camera));
    ctx.lineTo(...screenPoint(positions[b], positions[b + 1], camera));
    ctx.lineTo(...screenPoint(positions[c], positions[c + 1], camera));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.7;
    ctx.fill();
    ctx.stroke();
  }

  ctx.beginPath();
  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index] * 3;
    const b = triangles[index + 1] * 3;
    const c = triangles[index + 2] * 3;
    ctx.moveTo(...screenPoint(positions[a], positions[a + 1], camera));
    ctx.lineTo(...screenPoint(positions[b], positions[b + 1], camera));
    ctx.lineTo(...screenPoint(positions[c], positions[c + 1], camera));
  }
  ctx.strokeStyle = "rgba(255, 243, 231, 0.035)";
  ctx.lineWidth = 0.45;
  ctx.stroke();

  ctx.beginPath();
  for (let index = 0; index < mesh.outline.length; index += 1) {
    const vertex = mesh.outline[index] * 3;
    const point = screenPoint(
      positions[vertex],
      positions[vertex + 1],
      camera,
    );
    if (index === 0) ctx.moveTo(...point);
    else ctx.lineTo(...point);
  }
  ctx.closePath();
  ctx.strokeStyle = "rgba(255, 232, 207, 0.19)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
}

function drawDifferenceOverlay(ctx, combinedPose, singlePose, camera) {
  const positionsA = singlePose.positions;
  const positionsB = combinedPose.positions;
  let drawn = 0;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 2) {
    const index = vertex * 3;
    const distance = Math.hypot(
      positionsB[index] - positionsA[index],
      positionsB[index + 1] - positionsA[index + 1],
      positionsB[index + 2] - positionsA[index + 2],
    );
    if (distance < 0.006) continue;
    const [x, y] = screenPoint(
      positionsB[index],
      positionsB[index + 1],
      camera,
    );
    const intensity = Math.min(1, distance / 0.11);
    ctx.beginPath();
    ctx.arc(x, y, 0.7 + intensity * 1.25, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(110, 216, 255, ${0.12 + intensity * 0.52})`;
    ctx.fill();
    drawn += 1;
  }
  return drawn;
}

function drawEye(ctx, side, blink, camera) {
  const openness = Math.pow(1 - Math.min(1, blink), 0.72);
  const eyeX = side * 0.34;
  const eyeY = 0.075;
  const width = 0.135 + 0.045 * openness;
  const height = 0.004 + 0.060 * openness;
  const center = screenPoint(eyeX, eyeY, camera);
  const left = screenPoint(eyeX - width, eyeY, camera)[0];
  const right = screenPoint(eyeX + width, eyeY, camera)[0];
  const top = screenPoint(eyeX, eyeY + height, camera)[1];
  const bottom = screenPoint(eyeX, eyeY - height * 0.58, camera)[1];
  const [cx, cy] = center;

  ctx.save();
  ctx.fillStyle = "rgba(53, 27, 22, 0.28)";
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + camera.scale * 0.018,
    camera.scale * width * 1.15,
    camera.scale * (height + 0.021),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(left, cy);
  ctx.bezierCurveTo(
    left + (right - left) * 0.26,
    top,
    right - (right - left) * 0.25,
    top,
    right,
    cy,
  );
  ctx.bezierCurveTo(
    right - (right - left) * 0.28,
    bottom,
    left + (right - left) * 0.28,
    bottom,
    left,
    cy,
  );
  ctx.closePath();
  ctx.fillStyle = openness > 0.08 ? "#efe5d7" : "#5b352f";
  ctx.fill();
  ctx.strokeStyle = "rgba(67, 40, 34, 0.82)";
  ctx.lineWidth = 0.95;
  ctx.stroke();

  ctx.clip();
  const irisRadius = camera.scale * (0.045 + openness * 0.008);
  const irisX = cx + camera.scale * 0.004 * side;
  const irisY = cy - camera.scale * 0.002;
  const iris = ctx.createRadialGradient(
    irisX,
    irisY,
    irisRadius * 0.12,
    irisX,
    irisY,
    irisRadius,
  );
  iris.addColorStop(0, "#567573");
  iris.addColorStop(0.58, "#263e3e");
  iris.addColorStop(1, "#101c1e");
  ctx.beginPath();
  ctx.arc(irisX, irisY, irisRadius, 0, Math.PI * 2);
  ctx.fillStyle = iris;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(irisX, irisY, irisRadius * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = "#080b0c";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(
    irisX - irisRadius * 0.28,
    irisY - irisRadius * 0.30,
    irisRadius * 0.15,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(left, cy);
  ctx.bezierCurveTo(
    left + (right - left) * 0.26,
    top,
    right - (right - left) * 0.25,
    top,
    right,
    cy,
  );
  ctx.strokeStyle = "rgba(52, 31, 28, 0.92)";
  ctx.lineWidth = 1.2 + openness * 0.35;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(right - (right - left) * 0.06, cy);
  ctx.lineTo(right - (right - left) * 0.18, cy + camera.scale * 0.016);
  ctx.strokeStyle = "rgba(45, 28, 26, 0.65)";
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(left + (right - left) * 0.18, cy - camera.scale * 0.088);
  ctx.quadraticCurveTo(
    cx,
    cy - camera.scale * (0.113 - blink * 0.016),
    right - (right - left) * 0.12,
    cy - camera.scale * 0.078,
  );
  ctx.strokeStyle = "rgba(87, 50, 42, 0.36)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawBrow(ctx, side, browWeight, camera) {
  const innerX = side * 0.145;
  const outerX = side * 0.57;
  const lift = browWeight * 0.105;
  const inner = screenPoint(innerX, 0.315 + lift * 0.78, camera);
  const middle = screenPoint(side * 0.35, 0.375 + lift, camera);
  const outer = screenPoint(outerX, 0.31 + lift * 0.72, camera);
  const lineWidth = Math.max(3.2, camera.scale * 0.0145);

  ctx.beginPath();
  ctx.moveTo(...inner);
  ctx.quadraticCurveTo(...middle, ...outer);
  ctx.strokeStyle = "#37241f";
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(inner[0], inner[1] - lineWidth * 0.13);
  ctx.quadraticCurveTo(
    middle[0],
    middle[1] - lineWidth * 0.15,
    outer[0],
    outer[1] - lineWidth * 0.08,
  );
  ctx.strokeStyle = "rgba(112, 78, 64, 0.52)";
  ctx.lineWidth = Math.max(0.8, lineWidth * 0.24);
  ctx.stroke();
}

function drawMouth(ctx, smile, camera) {
  const halfWidth = 0.205 + smile * 0.082;
  const cornerY = -0.448 + smile * 0.095;
  const upperY = -0.483 + smile * 0.008;
  const lowerY = -0.535 + smile * 0.026;
  const left = screenPoint(-halfWidth, cornerY, camera);
  const right = screenPoint(halfWidth, cornerY, camera);
  const upperCenter = screenPoint(0, upperY, camera);
  const lowerCenter = screenPoint(0, lowerY, camera);
  const topControlLeft = screenPoint(-halfWidth * 0.43, upperY - 0.008, camera);
  const topControlRight = screenPoint(halfWidth * 0.43, upperY - 0.008, camera);
  const lowControlLeft = screenPoint(-halfWidth * 0.46, lowerY + 0.012, camera);
  const lowControlRight = screenPoint(halfWidth * 0.46, lowerY + 0.012, camera);

  const lipGradient = ctx.createLinearGradient(
    upperCenter[0],
    upperCenter[1],
    lowerCenter[0],
    lowerCenter[1],
  );
  lipGradient.addColorStop(0, "#703c3d");
  lipGradient.addColorStop(0.48, "#a55f5d");
  lipGradient.addColorStop(1, "#6e3739");
  ctx.beginPath();
  ctx.moveTo(...left);
  ctx.quadraticCurveTo(...topControlLeft, ...upperCenter);
  ctx.quadraticCurveTo(...topControlRight, ...right);
  ctx.quadraticCurveTo(...lowControlRight, ...lowerCenter);
  ctx.quadraticCurveTo(...lowControlLeft, ...left);
  ctx.closePath();
  ctx.fillStyle = lipGradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(56, 27, 29, 0.65)";
  ctx.lineWidth = 0.85;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(...left);
  ctx.quadraticCurveTo(...topControlLeft, ...upperCenter);
  ctx.quadraticCurveTo(...topControlRight, ...right);
  ctx.strokeStyle = "rgba(45, 22, 24, 0.86)";
  ctx.lineWidth = 1.15;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(
    left[0] + (right[0] - left[0]) * 0.18,
    lowerCenter[1] - camera.scale * 0.012,
  );
  ctx.quadraticCurveTo(
    (left[0] + right[0]) * 0.5,
    lowerCenter[1] - camera.scale * 0.019,
    right[0] - (right[0] - left[0]) * 0.18,
    lowerCenter[1] - camera.scale * 0.012,
  );
  ctx.strokeStyle = "rgba(247, 190, 169, 0.34)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
}

function drawFeatureLayer(ctx, weights, camera) {
  const smile = Math.min(1, weights.smile ?? 0);
  const blink = Math.min(1, weights.blink ?? 0);
  const brow = Math.min(1, weights.brow ?? 0);

  const cheekGlow = ctx.createRadialGradient(
    camera.centerX - camera.scale * 0.48,
    camera.centerY + camera.scale * 0.19,
    0,
    camera.centerX - camera.scale * 0.48,
    camera.centerY + camera.scale * 0.19,
    camera.scale * 0.29,
  );
  cheekGlow.addColorStop(0, `rgba(225, 118, 91, ${0.055 + smile * 0.06})`);
  cheekGlow.addColorStop(1, "rgba(225, 118, 91, 0)");
  ctx.fillStyle = cheekGlow;
  ctx.fillRect(0, 0, camera.width, camera.height);
  ctx.save();
  ctx.translate(camera.width, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = cheekGlow;
  ctx.fillRect(0, 0, camera.width, camera.height);
  ctx.restore();

  const nostrilY = -0.335;
  for (const side of [-1, 1]) {
    const [x, y] = screenPoint(side * 0.087, nostrilY, camera);
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      camera.scale * 0.019,
      camera.scale * 0.009,
      side * -0.25,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(66, 37, 31, 0.40)";
    ctx.fill();
  }

  drawBrow(ctx, -1, brow, camera);
  drawBrow(ctx, 1, brow, camera);
  drawEye(ctx, -1, blink, camera);
  drawEye(ctx, 1, blink, camera);
  drawMouth(ctx, smile, camera);
}

function drawPose(canvas, pose, weights, differencePose = null) {
  const { width, height, ratio } = resizeCanvas(canvas);
  const context = canvas.getContext("2d", { alpha: true });
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineJoin = "round";
  const camera = makeCamera(width, height);

  drawBackdrop(context, camera);
  drawMeshSurface(context, pose, camera);
  if (differencePose) {
    drawDifferenceOverlay(context, pose, differencePose, camera);
  }
  drawFeatureLayer(context, weights, camera);
  return camera;
}

function updateWeightReadouts(combined) {
  for (const target of MORPH_TARGETS) {
    const raw = state.rawWeights[target.id];
    const effective = combined.weights[target.id];
    const output = elements.outputs[target.id];
    output.textContent = formatNumber(effective, 2);
    output.title = `原始 ${formatNumber(raw, 2)} · 有效 ${formatNumber(effective, 2)}`;
    output.classList.toggle("clamped", raw > 1 + 1e-9 || raw < -1e-9);
  }

  if (combined.limited.length > 0) {
    const labels = combined.limited
      .map((item) => {
        const label = targetById[item.id].label;
        return `${label} ${formatNumber(item.raw, 2)}→${formatNumber(item.clamped, 2)}`;
      })
      .join(" · ");
    elements.clampNotice.classList.add("active");
    elements.clampNotice.innerHTML = `<span class="notice-icon">!</span><span>安全钳制：${labels}</span>`;
  } else {
    elements.clampNotice.classList.remove("active");
    elements.clampNotice.innerHTML =
      '<span class="notice-icon">✓</span><span>所有权重均在安全范围内</span>';
  }
}

function updateMetrics(combined, single, difference) {
  const target = targetById[state.singleTarget];
  elements.singleName.textContent = target.label;
  elements.singlePeak.textContent = formatNumber(single.maxDisplacement, 3);
  elements.singlePeak.style.color = target.accent;
  elements.combinedPeak.textContent = formatNumber(combined.maxDisplacement, 3);
  elements.metricCombined.textContent = formatNumber(combined.maxDisplacement, 4);
  elements.metricDelta.textContent = formatNumber(difference, 4);

  const safe =
    combined.triangleFlips === 0 && !combined.outlineSelfIntersects;
  elements.metricSilhouette.textContent = safe ? "PASS" : "BLOCKED";
  elements.metricSilhouette.classList.toggle("status-good", safe);
  elements.metricFlips.textContent = safe
    ? `${combined.triangleFlips} 个翻转 · 轮廓无自交`
    : `${combined.triangleFlips} 个翻转 · 已退回安全姿态`;
  elements.metricSafety.textContent = `×${formatNumber(combined.safetyScale, 2)}`;
  elements.metricSafety.style.color =
    combined.safetyScale < 0.999 ? "var(--smile)" : "var(--text)";
  const totalWeight = Object.values(combined.appliedWeights).reduce(
    (sum, value) => sum + value,
    0,
  );
  elements.metricWeights.textContent = `有效权重 ${formatNumber(totalWeight, 2)}`;
}

function render() {
  const combined = applyMorphTargets(mesh, state.rawWeights);
  const singleWeights = makeWeightSet(state.singleTarget, combined.weights);
  const single = applyMorphTargets(mesh, singleWeights);
  const difference = maxVertexDisplacement(single.positions, combined.positions);
  latestPoses = { combined, single, difference };

  updateWeightReadouts(combined);
  updateMetrics(combined, single, difference);
  drawPose(elements.singleCanvas, single, singleWeights);
  drawPose(elements.combinedCanvas, combined, combined.weights, single);
}

function scheduleRender() {
  if (animationFrame) return;
  animationFrame = requestAnimationFrame(() => {
    animationFrame = 0;
    render();
  });
}

function renderStability(result) {
  elements.testBadge.textContent = result.passed ? "PASS" : "FAIL";
  elements.testBadge.classList.toggle("pass", result.passed);
  elements.cycleCount.textContent = String(result.cycles);
  elements.positionResidual.textContent = formatResidual(
    result.maxPositionResidual,
  );
  elements.normalResidual.textContent = formatResidual(result.maxNormalResidual);
  elements.positionResidual.style.color = result.passed
    ? "var(--good)"
    : "var(--danger)";
  elements.normalResidual.style.color = result.passed
    ? "var(--good)"
    : "var(--danger)";
  elements.stabilityPill.lastElementChild.textContent = result.passed
    ? "基准网格已锁定 · 无累积"
    : "稳定性检查失败";
}

function runStabilityCheck() {
  elements.testBadge.textContent = "RUNNING";
  elements.testBadge.classList.remove("pass");
  window.setTimeout(() => {
    const result = runStabilityTest(mesh, { cycles: 320 });
    renderStability(result);
  }, 40);
}

function setRawWeights(weights) {
  for (const target of MORPH_TARGETS) {
    const value = Number(weights[target.id]);
    state.rawWeights[target.id] = value;
    elements.ranges[target.id].value = String(value);
  }
  scheduleRender();
}

for (const target of MORPH_TARGETS) {
  elements.ranges[target.id].addEventListener("input", (event) => {
    state.rawWeights[target.id] = Number(event.currentTarget.value);
    scheduleRender();
  });
}

for (const button of document.querySelectorAll("[data-single]")) {
  button.addEventListener("click", () => {
    state.singleTarget = button.dataset.single;
    for (const peer of document.querySelectorAll("[data-single]")) {
      peer.classList.toggle("active", peer === button);
    }
    scheduleRender();
  });
}

document.querySelector("#extreme-button").addEventListener("click", () => {
  setRawWeights({ smile: 2.35, blink: 1.78, brow: 2.0 });
});

document.querySelector("#reset-button").addEventListener("click", () => {
  setRawWeights({ smile: 0, blink: 0, brow: 0 });
});

document.querySelector("#rerun-test").addEventListener("click", runStabilityCheck);

const resizeObserver = new ResizeObserver(scheduleRender);
resizeObserver.observe(elements.singleCanvas);
resizeObserver.observe(elements.combinedCanvas);
window.addEventListener("resize", scheduleRender);

render();
runStabilityCheck();

window.morphLab = {
  mesh,
  get state() {
    return { ...state, rawWeights: { ...state.rawWeights } };
  },
  get latestPoses() {
    return latestPoses;
  },
  runStabilityTest: (options) => runStabilityTest(mesh, options),
};
