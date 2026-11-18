/* Cook-Torrance 微表面 BRDF 项库
 * 所有函数为纯标量运算，输入为已夹取前的点积，内部统一做安全夹取。
 * 暴露为全局 BRDF（浏览器）或 module.exports（Node 校验脚本）。
 */
(function (root) {
  'use strict';

  var PI = Math.PI;
  var EPS = 1e-7;

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  // 粗糙度 -> GGX 参数 alpha，下限防止除零
  function alphaOf(roughness) {
    var a = roughness * roughness;
    return a < 1e-6 ? 1e-6 : a;
  }

  /* ---------- 法线分布项 D ---------- */
  var NDF = {
    // GGX / Trowbridge-Reitz
    ggx: function (ndh, rough) {
      var a = alphaOf(rough), a2 = a * a;
      var d = ndh * ndh * (a2 - 1) + 1;
      return a2 / (PI * d * d + EPS);
    },
    // Beckmann
    beckmann: function (ndh, rough) {
      var a = alphaOf(rough), a2 = a * a;
      var c2 = ndh * ndh;
      var t2 = (1 - c2) / (a2 * c2 + EPS);
      return Math.exp(-t2) / (PI * a2 * c2 * c2 + EPS);
    },
    // Blinn-Phong（按 alpha_p = 2/a^2 - 2 归一化）
    blinn: function (ndh, rough) {
      var a = alphaOf(rough);
      var ap = 2 / a - 2;
      return (ap + 2) / (2 * PI) * Math.pow(Math.max(ndh, EPS), ap);
    }
  };

  /* ---------- 几何遮蔽项 G ---------- */
  function g1Smith(ndx, rough) {
    var a2 = alphaOf(rough); a2 *= a2;
    return 2 * ndx / (ndx + Math.sqrt(a2 + (1 - a2) * ndx * ndx) + EPS);
  }
  function g1Schlick(ndx, rough) {
    var r = rough + 1, k = r * r / 8; // 直接光重映射
    return ndx / (ndx * (1 - k) + k + EPS);
  }
  var GEO = {
    // Smith：G1(l)·G1(v)
    smith: function (ndl, ndv, ndh, vdh, rough) {
      return g1Smith(ndl, rough) * g1Smith(ndv, rough);
    },
    // Schlick-GGX 近似
    schlick: function (ndl, ndv, ndh, vdh, rough) {
      return g1Schlick(ndl, rough) * g1Schlick(ndv, rough);
    },
    // Cook-Torrance 原始几何项
    cooktorrance: function (ndl, ndv, ndh, vdh, rough) {
      var t = Math.min(2 * ndh * ndv / (vdh + EPS), 2 * ndh * ndl / (vdh + EPS));
      return Math.min(1, t);
    },
    // Implicit（与分母抵消）
    implicit: function (ndl, ndv) { return ndl * ndv; }
  };

  /* ---------- 菲涅耳项 F（逐通道，f0 为 [r,g,b]） ---------- */
  var FRESNEL = {
    schlick: function (vdh, f0) {
      var m = Math.pow(1 - vdh, 5);
      return [f0[0] + (1 - f0[0]) * m, f0[1] + (1 - f0[1]) * m, f0[2] + (1 - f0[2]) * m];
    },
    // 精确非偏振菲涅耳：由 F0 反推折射率 eta，逐通道求解
    exact: function (vdh, f0) {
      var out = [0, 0, 0];
      for (var i = 0; i < 3; i++) {
        var s = Math.sqrt(clamp01(f0[i]));
        var eta = (1 + s) / Math.max(1 - s, 1e-4);
        var c = clamp01(vdh);
        var g2 = eta * eta + c * c - 1;
        if (g2 <= 0) { out[i] = 1; continue; } // 全内反射
        var g = Math.sqrt(g2);
        var a = (g - c) / (g + c);
        var b = (c * (g + c) - 1) / (c * (g - c) + 1 + EPS);
        out[i] = 0.5 * a * a * (1 + b * b);
      }
      return out;
    },
    none: function (vdh, f0) { return [f0[0], f0[1], f0[2]]; }
  };

  /* ---------- 组合求值 ---------- */
  // params: {ndl, ndv, ndh, vdh, rough, metal, albedo:[r,g,b]}
  // terms:  {ndf, geo, fresnel}
  function evalBRDF(terms, p) {
    var ndl = clamp01(p.ndl), ndv = clamp01(p.ndv);
    var ndh = clamp01(p.ndh), vdh = clamp01(p.vdh);
    var f0 = [0, 0, 0], kd = 1 - p.metal;
    for (var i = 0; i < 3; i++) f0[i] = 0.04 + (p.albedo[i] - 0.04) * p.metal;

    var D = NDF[terms.ndf](ndh, p.rough);
    var G = GEO[terms.geo](ndl, ndv, ndh, vdh, p.rough);
    var F = FRESNEL[terms.fresnel](vdh, f0);

    var denom = 4 * ndl * ndv + EPS;
    var spec = [0, 0, 0], total = [0, 0, 0];
    for (i = 0; i < 3; i++) {
      spec[i] = D * G * F[i] / denom;
      total[i] = kd * p.albedo[i] / PI + spec[i];
    }
    return { D: D, G: G, F: F, f0: f0, spec: spec, total: total, ndl: ndl, ndv: ndv, ndh: ndh, vdh: vdh };
  }

  var REFERENCE = { ndf: 'ggx', geo: 'smith', fresnel: 'schlick' };

  /* ---------- 极端参数扫描：负值 / NaN / 高光爆白 ---------- */
  // 返回 {rows:[{name, neg, nan, maxVal, blow}], worst}
  function sweep(terms) {
    var roughs = [0.001, 0.02, 0.1, 0.5, 1.0];
    var metals = [0, 0.5, 1];
    var issues = { neg: 0, nan: 0, blow: 0, maxVal: 0 };
    var BLOW_LIMIT = 50; // 单通道 BRDF 超过该值视为爆白风险
    for (var ri = 0; ri < roughs.length; ri++)
      for (var mi = 0; mi < metals.length; mi++)
        for (var ci = 0; ci <= 64; ci++) {
          var c = ci / 64; // 余弦扫描，含掠射角 c≈0
          var p = {
            ndl: c, ndv: Math.max(c, 0.001), ndh: c, vdh: c,
            rough: roughs[ri], metal: metals[mi], albedo: [0.9, 0.85, 0.8]
          };
          var r = evalBRDF(terms, p);
          var vals = [r.D, r.G, r.F[0], r.F[1], r.F[2], r.spec[0], r.spec[1], r.spec[2]];
          for (var k = 0; k < vals.length; k++) {
            var v = vals[k];
            if (v !== v || v === Infinity || v === -Infinity) issues.nan++;
            else if (v < 0) issues.neg++;
            else {
              if (v > issues.maxVal) issues.maxVal = v;
              if (k >= 5 && v > BLOW_LIMIT) issues.blow++;
            }
          }
        }
    return issues;
  }

  var api = { NDF: NDF, GEO: GEO, FRESNEL: FRESNEL, evalBRDF: evalBRDF, REFERENCE: REFERENCE, sweep: sweep, clamp01: clamp01 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BRDF = api;
})(typeof self !== 'undefined' ? self : this);
