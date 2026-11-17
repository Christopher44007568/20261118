// Cascaded Shadow Map core math. Pure JS (no WebGL) so it is unit-testable in Node.
import { v3, m4 } from './math.js';

export const DEFAULT_CONFIG = {
  numCascades: 3,
  lambda: 0.65,            // 0 = uniform splits, 1 = logarithmic splits
  resolutions: [2048, 1024, 512], // per-cascade shadow map resolution
  shadowDistance: 180,     // far limit of the last cascade (view space)
  blendBand: 0.12,         // fraction of each cascade range used to blend into the next
  casterMargin: 60,        // extra light-space depth to catch off-frustum casters
};

// Practical split scheme (Lauritzen et al.): blend of uniform and logarithmic splits.
export function computeSplitDistances(near, far, numCascades, lambda) {
  const splits = [near];
  for (let i = 1; i < numCascades; i++) {
    const p = i / numCascades;
    const log = near * Math.pow(far / near, p);
    const uniform = near + (far - near) * p;
    splits.push(lambda * log + (1 - lambda) * uniform);
  }
  splits.push(far);
  return splits; // length numCascades + 1
}

// 8 corners of a perspective frustum slice [sliceNear, sliceFar], world space.
export function frustumSliceCorners(cam, sliceNear, sliceFar) {
  const fwd = v3.normalize(cam.forward);
  const right = v3.normalize(v3.cross(fwd, cam.up));
  const up = v3.cross(right, fwd);
  const tanH = Math.tan(cam.fovY / 2);
  const tanW = tanH * cam.aspect;
  const corners = [];
  for (const d of [sliceNear, sliceFar]) {
    const h = tanH * d;
    const w = tanW * d;
    const c = v3.add(cam.position, v3.scale(fwd, d));
    corners.push(
      v3.add(c, v3.add(v3.scale(right, -w), v3.scale(up, -h))),
      v3.add(c, v3.add(v3.scale(right, w), v3.scale(up, -h))),
      v3.add(c, v3.add(v3.scale(right, w), v3.scale(up, h))),
      v3.add(c, v3.add(v3.scale(right, -w), v3.scale(up, h))),
    );
  }
  return corners;
}

// Bounding-sphere center/radius of a point set (exact sphere through frustum corners
// is well approximated by center=average, radius=max distance — standard for CSM).
function boundingSphere(points) {
  let center = [0, 0, 0];
  for (const p of points) center = v3.add(center, p);
  center = v3.scale(center, 1 / points.length);
  let radius = 0;
  for (const p of points) radius = Math.max(radius, v3.length(v3.sub(p, center)));
  return { center, radius };
}

function lightUpVector(lightDir) {
  const d = v3.normalize(lightDir);
  return Math.abs(d[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
}

// Build one cascade. The light view is a pure rotation (fixed for a given light
// direction); only the ortho window origin is snapped to the texel grid. This
// world-locks the texel grid: a static receiver shifts by whole texels only,
// so shadows never crawl or pop while the camera crosses cascade boundaries.
export function computeCascade(cam, lightDir, sliceNear, sliceFar, resolution, casterMargin) {
  const corners = frustumSliceCorners(cam, sliceNear, sliceFar);
  const { center, radius } = boundingSphere(corners);

  const dir = v3.normalize(lightDir);
  const up = lightUpVector(dir);
  const zAxis = v3.scale(dir, -1); // camera looks along light dir
  const xAxis = v3.normalize(v3.cross(up, zAxis));
  const yAxis = v3.cross(zAxis, xAxis);
  // Pure rotation world->light (zero translation keeps the grid world-locked).
  const lightView = [
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    0, 0, 0, 1,
  ];

  // Radius depends only on slice depths (not camera pose), so the texel size
  // is stable while the camera moves.
  const worldUnitsPerTexel = (2 * radius) / resolution;
  const centerLS = m4.transformPoint(lightView, center);
  const snappedX = Math.floor(centerLS[0] / worldUnitsPerTexel) * worldUnitsPerTexel;
  const snappedY = Math.floor(centerLS[1] / worldUnitsPerTexel) * worldUnitsPerTexel;

  // Depth range: fit slice corners in light space, expand toward the light so
  // occluders outside the view slice still get rendered into the map.
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of corners) {
    const p = m4.transformPoint(lightView, c);
    minZ = Math.min(minZ, p[2]);
    maxZ = Math.max(maxZ, p[2]);
  }
  minZ -= casterMargin;

  const lightProj = m4.ortho(
    snappedX - radius, snappedX + radius,
    snappedY - radius, snappedY + radius,
    -maxZ - casterMargin, -minZ,
  );
  const lightViewProj = m4.multiply(lightProj, lightView);

  return {
    lightViewProj,
    lightView,
    lightProj,
    center,
    radius,
    resolution,
    worldUnitsPerTexel,
    depthRange: { near: -maxZ - casterMargin, far: -minZ },
    texelDensity: resolution / (2 * radius), // texels per world meter
  };
}

// Full CSM: splits + one cascade descriptor per level.
export function computeCSM(cam, lightDir, config = DEFAULT_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const far = Math.min(cam.far, cfg.shadowDistance);
  const splits = computeSplitDistances(cam.near, far, cfg.numCascades, cfg.lambda);
  const cascades = [];
  for (let i = 0; i < cfg.numCascades; i++) {
    cascades.push(
      computeCascade(cam, lightDir, splits[i], splits[i + 1], cfg.resolutions[i], cfg.casterMargin),
    );
  }
  return { splits, cascades, config: cfg };
}

// Which cascade covers this view-space depth (positive distance along view ray).
export function selectCascade(viewDepth, splits) {
  for (let i = 0; i < splits.length - 1; i++) {
    if (viewDepth <= splits[i + 1]) return i;
  }
  return splits.length - 2;
}

// 0..1 blend weight of the *next* cascade inside the trailing blend band.
export function nextCascadeBlend(viewDepth, splits, cascadeIndex, blendBand) {
  if (cascadeIndex >= splits.length - 2) return 0; // last cascade: nothing to blend with
  const near = splits[cascadeIndex];
  const far = splits[cascadeIndex + 1];
  const band = (far - near) * blendBand;
  const t = (viewDepth - (far - band)) / band;
  return Math.min(1, Math.max(0, t));
}

// HUD / console stats: coverage distance and effective texel density per cascade.
export function cascadeStats(csm) {
  const { splits, cascades } = csm;
  return cascades.map((c, i) => ({
    cascade: i,
    rangeStart: splits[i],
    rangeEnd: splits[i + 1],
    coverage: splits[i + 1] - splits[i],
    resolution: c.resolution,
    worldDiameter: 2 * c.radius,
    worldUnitsPerTexel: c.worldUnitsPerTexel,
    texelDensity: c.texelDensity,
    depthNear: c.depthRange.near,
    depthFar: c.depthRange.far,
  }));
}
