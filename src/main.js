'use strict';

(function () {
  const canvas = document.getElementById('gl');
  const rtThumb = document.getElementById('rt-canvas');

  let renderer, hud, mirror, scene;
  let time = 0;
  let last = performance.now();
  let regime = REGIMES.current;

  const camera = {
    eye: [0.6, 6.2, 16.5],
    target: [1.5, 0.6, -16],
    up: [0, 1, 0],
    view: M4.identity(),
    proj: M4.identity()
  };

  const WATER_BOUNDS = { xMin: -78, xMax: 78, zMin: -24, zMax: 26 };

  function updateCamera() {
    const aspect = canvas.width / canvas.height;
    camera.proj = M4.perspective((48 * Math.PI) / 180, aspect, 0.1, 220);
    camera.view = M4.lookAt(camera.eye, camera.target, camera.up);
    mirror.update(camera.eye, camera.target, camera.up, camera.proj);
  }

  /* Ray from a screen-space pick point against the y=0 water plane. */
  window.__pickWater = function pickWater(ndcX, ndcY) {
    const invVP = M4.invert(M4.multiply(camera.proj, camera.view));
    const near = M4.transformPoint(invVP, [ndcX, ndcY, -1]);
    const far = M4.transformPoint(invVP, [ndcX, ndcY, 1]);
    const dy = far[1] - near[1];
    if (Math.abs(dy) < 1e-6 || (near[1] > 0 && dy > 0) || (near[1] < 0 && dy < 0)) {
      return { hit: false };
    }
    const t = -near[1] / dy;
    const p = [
      near[0] + (far[0] - near[0]) * t,
      0,
      near[2] + (far[2] - near[2]) * t
    ];
    const inside = p[0] >= WATER_BOUNDS.xMin && p[0] <= WATER_BOUNDS.xMax &&
      p[2] >= WATER_BOUNDS.zMin && p[2] <= WATER_BOUNDS.zMax;
    if (!inside) return { hit: false, world: p };
    const uv = mirror.projectUV(p);
    return { hit: true, world: p, uv };
  };

  /*
   * Leak audit: project a set of known below-water points through the
   * oblique mirror projection. Anything still inside the frustum means the
   * oblique clip failed.
   */
  window.__auditClip = function auditClip() {
    const probes = [
      [4.6, -1.5, -6.2], [21, -3, -8], [-20, -4, -12],
      [0, -8, 5], [-30, -2, -10], [12, -6, -20]
    ];
    let leaks = 0;
    for (const p of probes) {
      const c = M4.transformPoint(mirror.viewProj, p);
      if (c[0] >= -1 && c[0] <= 1 && c[1] >= -1 && c[1] <= 1 &&
        c[2] >= -1 && c[2] <= 1) leaks++;
    }
    return leaks;
  };

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!hud.paused) time += dt;

    updateCamera();
    renderer.resize();
    renderer.render(camera, mirror, regime, time);

    renderer.stats.leak = window.__auditClip();
    hud.updateStats(renderer.stats);

    // Fixed crosshair sample (NDC 0, slightly above center to hit the lake).
    const pick = window.__pickWater(0, -0.18);
    hud.updatePick(pick);

    if (renderer.stats.frame % 6 === 0) renderer.blitReflectionPreview(rtThumb);
    requestAnimationFrame(frame);
  }

  function init() {
    renderer = new Renderer(canvas);
    hud = new HUD();
    mirror = new MirrorCamera(0, 0.002);
    scene = buildScene();
    renderer.uploadScene(scene);
    hud.setGpu(renderer.gpuLabel);
    hud.setParams(regime);
    hud.onRegimeChange = (name) => {
      regime = REGIMES[name];
      hud.setParams(regime);
    };

    const params = new URLSearchParams(location.search);
    if (params.get('nodistortion') !== null) renderer.debug.noDistortion = true;
    if (params.get('noglint') !== null) renderer.debug.noGlint = true;
    if (params.get('bodyonly') !== null) renderer.debug.bodyOnly = true;
    if (params.get('pure') !== null) renderer.debug.pureReflection = true;
    if (params.get('regime') === 'calm') hud.setRegime('calm');

    // Exposed for automated validation in the headless harness.
    window.__water = {
      renderer, get hud() { return hud; }, get mirror() { return mirror; },
      get camera() { return camera; }, get regime() { return regime; },
      pickWater: window.__pickWater,
      auditClip: window.__auditClip,
      setRegime(name) { hud.setRegime(name); }
    };
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
