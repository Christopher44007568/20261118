/* CPU 渲染器：金属球 + 低粗糙度平板
 * 同一场景渲染两遍（所选近似 / 参考公式），左半屏显示近似、右半屏显示参考，
 * 并统计两缓冲的 RMSE / 最大误差 / 爆白像素数。
 */
(function (root) {
  'use strict';

  var W = 640, H = 400;
  var LIGHT_DIR = norm3([-0.45, 0.75, 0.55]);
  var LIGHT_COL = [3.2, 3.2, 3.0];
  var AMBIENT = 0.06;

  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  // 场景定义
  var SPHERE = { c: [-0.58, 0.02, 0], r: 0.52, albedo: [0.95, 0.76, 0.45] }; // 金色金属球
  // 平板：法线对准默认视角(35°)的半程向量，低粗糙度下出现锐利高光；
  // 改变视角时高光滑离，可观察掠射角能量行为
  var PLANE = (function () {
    var n = norm3([-0.356, 0.661, 0.660]);
    var u = norm3([0.660, 0, 0.356]); // 与 n 正交的面内方向
    var wv = [ // wv = n × u
      n[1] * u[2] - n[2] * u[1],
      n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0]];
    return { c: [0.62, -0.02, 0.1], hw: 0.5, hh: 0.55, n: n, u: u, wv: wv, albedo: [0.82, 0.83, 0.85] };
  })();

  function camera(elevDeg) {
    var e = elevDeg * Math.PI / 180, d = 2.3;
    var pos = [0, Math.sin(e) * d, Math.cos(e) * d];
    var fwd = norm3([-pos[0], -pos[1], -pos[2]]);
    var right = norm3([-fwd[2], 0, fwd[0]]); // cross(fwd, up)
    var up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    return { pos: pos, fwd: fwd, right: right, up: up, tanF: Math.tan(20 * Math.PI / 180) };
  }

  // 像素 -> 场景命中，返回几何与材质；未命中返回 null
  function trace(cam, px, py, opts) {
    var nx = (2 * (px + 0.5) / W - 1) * cam.tanF * (W / H);
    var ny = (1 - 2 * (py + 0.5) / H) * cam.tanF;
    var rd = norm3([
      cam.fwd[0] + cam.right[0] * nx + cam.up[0] * ny,
      cam.fwd[1] + cam.right[1] * nx + cam.up[1] * ny,
      cam.fwd[2] + cam.right[2] * nx + cam.up[2] * ny]);
    var ro = cam.pos, tBest = 1e9, hit = null;

    // 球
    var oc = sub(ro, SPHERE.c);
    var b = dot(oc, rd), c = dot(oc, oc) - SPHERE.r * SPHERE.r;
    var disc = b * b - c;
    if (disc > 0) {
      var t = -b - Math.sqrt(disc);
      if (t > 0 && t < tBest) {
        tBest = t;
        var p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
        hit = { p: p, n: norm3(sub(p, SPHERE.c)), rough: opts.rough, metal: opts.metal, albedo: SPHERE.albedo, obj: 'sphere' };
      }
    }
    // 平板（有限矩形）
    var dn = dot(rd, PLANE.n);
    if (Math.abs(dn) > 1e-6) {
      var tp = dot(sub(PLANE.c, ro), PLANE.n) / dn;
      if (tp > 0 && tp < tBest) {
        var pp = [ro[0] + rd[0] * tp, ro[1] + rd[1] * tp, ro[2] + rd[2] * tp];
        var q = sub(pp, PLANE.c);
        var du = dot(q, PLANE.u), dv = dot(q, PLANE.wv);
        if (Math.abs(du) < PLANE.hw && Math.abs(dv) < PLANE.hh) {
          tBest = tp;
          var n = dn < 0 ? PLANE.n : [-PLANE.n[0], -PLANE.n[1], -PLANE.n[2]];
          hit = { p: pp, n: n, rough: opts.planeRough, metal: opts.metal, albedo: PLANE.albedo, obj: 'plane' };
        }
      }
    }
    if (!hit) return null;

    var v = norm3([-rd[0], -rd[1], -rd[2]]);
    var l = LIGHT_DIR;
    var h = norm3([v[0] + l[0], v[1] + l[1], v[2] + l[2]]);
    hit.ndl = dot(hit.n, l); hit.ndv = dot(hit.n, v);
    hit.ndh = dot(hit.n, h); hit.vdh = dot(v, h);
    return hit;
  }

  function shade(BRDF, terms, hit) {
    var r = BRDF.evalBRDF(terms, hit);
    var nl = Math.max(hit.ndl, 0);
    return [
      r.total[0] * LIGHT_COL[0] * nl + hit.albedo[0] * AMBIENT,
      r.total[1] * LIGHT_COL[1] * nl + hit.albedo[1] * AMBIENT,
      r.total[2] * LIGHT_COL[2] * nl + hit.albedo[2] * AMBIENT];
  }

  // 渲染并合成显示；返回统计信息
  function render(ctx, BRDF, opts) {
    var cam = camera(opts.elevDeg);
    var img = ctx.createImageData(W, H);
    var data = img.data;
    var ref = BRDF.REFERENCE;
    var sum2 = 0, maxErr = 0, nPix = 0, blow = 0, nan = 0, maxLum = 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var hit = trace(cam, x, y, opts);
        var colA, colR;
        if (hit) {
          colA = shade(BRDF, opts.terms, hit);
          colR = shade(BRDF, ref, hit);
          for (var i = 0; i < 3; i++) {
            var a = colA[i], r = colR[i];
            if (a !== a || r !== r) { nan++; a = 0; r = 0; }
            if (a < 0) a = 0;
            var lum = 0.2126 * colA[0] + 0.7152 * colA[1] + 0.0722 * colA[2];
            if (lum > maxLum) maxLum = lum;
            if (a > 1) blow++;
            var e = a - r; sum2 += e * e; if (Math.abs(e) > maxErr) maxErr = Math.abs(e);
            nPix++;
          }
        } else {
          var g = 0.03 + 0.05 * (1 - y / H);
          colA = colR = [g, g, g * 1.2];
        }
        // 左半屏近似、右半屏参考
        var src = x < W / 2 ? colA : colR;
        var o = (y * W + x) * 4;
        data[o] = Math.pow(1 - Math.exp(-src[0]), 1 / 2.2) * 255;
        data[o + 1] = Math.pow(1 - Math.exp(-src[1]), 1 / 2.2) * 255;
        data[o + 2] = Math.pow(1 - Math.exp(-src[2]), 1 / 2.2) * 255;
        data[o + 3] = 255;
      }
    }
    // 中线
    for (y = 0; y < H; y++) { var o2 = (y * W + W / 2) * 4; data[o2] = 90; data[o2 + 1] = 169; data[o2 + 2] = 255; }
    ctx.putImageData(img, 0, 0);
    return {
      rmse: Math.sqrt(sum2 / Math.max(nPix, 1)),
      maxErr: maxErr, blowPixels: blow, nanPixels: nan, maxLum: maxLum
    };
  }

  var api = { W: W, H: H, render: render, trace: trace, camera: camera };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Render = api;
})(typeof self !== 'undefined' ? self : this);
