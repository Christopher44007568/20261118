// Clearcoat PBR BRDF: metallic-roughness base layer + dielectric clearcoat layer.
// Pure functions, no dependencies. All vectors are [x, y, z] arrays.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// GGX / Trowbridge-Reitz normal distribution.
function distributionGGX(nDotH, roughness) {
  const a = Math.max(roughness * roughness, 1e-4);
  const a2 = a * a;
  const d = nDotH * nDotH * (a2 - 1) + 1;
  return a2 / (Math.PI * d * d);
}

// Smith height-correlated visibility term (Heitz, lambda form of GGX).
function visibilityGGX(nDotV, nDotL, roughness) {
  const a = Math.max(roughness * roughness, 1e-4);
  const a2 = a * a;
  const gv = nDotL * Math.sqrt(nDotV * nDotV * (1 - a2) + a2);
  const gl = nDotV * Math.sqrt(nDotL * nDotL * (1 - a2) + a2);
  const denom = gv + gl;
  return denom > 0 ? 0.5 / denom : 0;
}

// Schlick Fresnel. f0 may be scalar or [r,g,b].
function fresnelSchlick(f0, cosTheta) {
  const m = Math.pow(1 - clamp01(cosTheta), 5);
  if (Array.isArray(f0)) return f0.map((f) => f + (1 - f) * m);
  return f0 + (1 - f0) * m;
}

// Convert dielectric IOR to normal-incidence reflectance F0.
function f0FromIor(ior) {
  const r = (ior - 1) / (ior + 1);
  return r * r;
}

// Base layer: Lambert diffuse + GGX metallic specular (metallic-roughness model).
// Returns { diffuse:[rgb], specular:[rgb], total:[rgb] } radiance (NdotL folded in).
function shadeBase(N, V, L, params) {
  const { albedo, metallic, roughness } = params;
  const nDotL = dot(N, L);
  const nDotV = dot(N, V);
  if (nDotL <= 0 || nDotV <= 0) {
    return { diffuse: [0, 0, 0], specular: [0, 0, 0], total: [0, 0, 0] };
  }
  const H = norm(add(V, L));
  const nDotH = clamp01(dot(N, H));
  const vDotH = clamp01(dot(V, H));

  const f0 = albedo.map((c) => 0.04 * (1 - metallic) + c * metallic);
  const D = distributionGGX(nDotH, roughness);
  const G = visibilityGGX(nDotV, nDotL, roughness);
  const F = fresnelSchlick(f0, vDotH);

  const specular = F.map((f) => D * G * f * nDotL);
  const diffuse = albedo.map(
    (c, i) => ((1 - metallic) * c) / Math.PI * (1 - F[i]) * nDotL
  );
  const total = diffuse.map((d, i) => d + specular[i]);
  return { diffuse, specular, total };
}

// Clearcoat layer on top of the base.
// - coatIor:       index of refraction of the coat (sets F0, typically 1.4-1.6)
// - coatRoughness: microfacet roughness of the coat-air interface ONLY
// - coatThickness: absorption path control; Beer-Lambert tint on transmitted light
// - coatAbsorption: per-channel absorption coefficient of the coat medium
//
// The coat never "covers" the base: base light is attenuated by Fresnel
// transmission (1 - Fc) on entry and exit, and by Beer-Lambert absorption over
// the double path through the coat. Both lobes stay visible simultaneously.
function shadeClearcoat(N, V, L, baseParams, coatParams) {
  const { coatIor, coatRoughness, coatThickness, coatAbsorption } = coatParams;
  const nDotL = dot(N, L);
  const nDotV = dot(N, V);
  const zero = [0, 0, 0];
  if (nDotL <= 0 || nDotV <= 0) {
    return { coat: zero, base: zero, total: zero, Fc: 0, transmission: [0, 0, 0] };
  }
  const H = norm(add(V, L));
  const nDotH = clamp01(dot(N, H));
  const vDotH = clamp01(dot(V, H));

  // --- Coat specular lobe (own roughness, own Fresnel from IOR) ---
  const f0c = f0FromIor(coatIor);
  const Fc = fresnelSchlick(f0c, vDotH);
  const Dc = distributionGGX(nDotH, coatRoughness);
  const Gc = visibilityGGX(nDotV, nDotL, coatRoughness);
  const coat = [Dc * Gc * Fc * nDotL, Dc * Gc * Fc * nDotL, Dc * Gc * Fc * nDotL];

  // --- Transmission through the coat (entry + exit, scalar Fresnel) ---
  const transmit = (1 - Fc) * (1 - Fc);

  // --- Beer-Lambert absorption over the double path through the coat ---
  const path = coatThickness * (1 / nDotL + 1 / nDotV);
  const absorption = coatAbsorption.map((sigma) => Math.exp(-sigma * path));

  const transmission = absorption.map((a) => a * transmit);

  // --- Base layer, shaded with the SAME geometric normal N ---
  // The coat has no normal of its own here: coatRoughness only changes the
  // coat microfacet distribution above, never the base normal.
  const baseRaw = shadeBase(N, V, L, baseParams).total;
  const base = baseRaw.map((c, i) => c * transmission[i]);

  const total = coat.map((c, i) => c + base[i]);
  return { coat, base, total, Fc, transmission };
}

module.exports = {
  dot, sub, add, scale, norm, clamp01,
  distributionGGX, visibilityGGX, fresnelSchlick, f0FromIor,
  shadeBase, shadeClearcoat,
};
