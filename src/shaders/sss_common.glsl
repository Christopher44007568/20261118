// sss_common.glsl
// Approximate subsurface scattering (SSS) shared by every shader stage.
//
// The transmittance term is driven by four inputs:
//   1. geometric normal N
//   2. local curvature kappa (mean curvature, signed -> mapped to a weight)
//   3. optical thickness along the light path (0 = paper-thin edge, 1 = core)
//   4. the light direction L (view space, pointing toward the light)
//
// Design rule: SSS is a *wrapped, back-lit transmission* term, not an additive
// emissive glow. It can only appear where the light reaches the back of the
// surface (wrapped lighting factor > 0) and is attenuated by thickness. The
// final shader multiplies it by the light colour / irradiance, so with no
// light there is no SSS contribution.

#ifndef SSS_COMMON_GLSL
#define SSS_COMMON_GLSL

const float SSS_PI = 3.14159265359;

// Map an arbitrary signed curvature to a stable 0..1 edge weight.
// High |curvature| (tight folds, silhouettes, thin rims) -> weight -> 1.
float sssCurvatureWeight(float curvature, float curvatureScale) {
    float c = clamp(abs(curvature) * curvatureScale, 0.0, 1.0);
    // Smoothstep keeps flat regions quiet while rounding the rim response.
    return smoothstep(0.05, 1.0, c);
}

// Beer-Lambert style attenuation through a participating medium.
// thickness 0..1, density controls how quickly the medium becomes opaque.
// Returns transmittance in (0,1]: thin edges stay bright, thick cores dark.
float sssTransmittance(float thickness, float density) {
    float d = max(thickness, 0.0) * max(density, 0.0001);
    return exp(-d);
}

// Wrapped diffuse lighting, parameterised by a wrap amount in [0,1].
// wrap = 0 reproduces standard clamped Lambert; wrap -> 1 lets light bleed
// well past the terminator, which is what lets thin back-lit edges glow.
float sssWrappedDiffuse(float ndl, float wrap) {
    float w = clamp(wrap, 0.0, 0.999);
    return clamp((ndl + w) / (1.0 + w), 0.0, 1.0);
}

// Back-scattering factor: 0 on the lit side, ramping to 1 on the back side.
// This is the gate that makes SSS a transmission phenomenon rather than a
// generic additive highlight.
float sssBackfaceFactor(float ndl) {
    return clamp(-ndl, 0.0, 1.0);
}

// Phase function for the scattered light. A two-lobe Henyey-Greenstein-like
// blend: a forward lobe (light traveling through toward the viewer) plus a
// broad isotropic lobe so side-lit rims still receive some scatter.
// vDotL = dot(viewDir, lightDir), both pointing away from the surface point.
float sssPhase(float vDotL, float anisotropy) {
    float g = clamp(anisotropy, -0.9, 0.9);
    float g2 = g * g;
    float forward = (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * vDotL, 1.5);
    float backward = (1.0 - g2) / pow(1.0 + g2 + 2.0 * g * vDotL, 1.5);
    // Bias toward forward transmission, keep a soft back/side lobe.
    float phase = 0.75 * forward + 0.25 * backward;
    // Normalise to a modest, bounded range so it cannot blow out.
    return clamp(phase * 0.25, 0.0, 2.0);
}

struct SssParams {
    vec3  surfaceColor;     // diffuse albedo of the surface
    vec3  scatterColor;     // colour of light after scattering inside
    float thickness;        // 0 thin edge .. 1 thick core (already world scaled)
    float curvature;        // signed mean curvature
    float curvatureScale;   // material sensitivity to curvature
    float density;          // Beer-Lambert extinction coefficient
    float wrap;             // wrapped-lighting bleed past the terminator
    float scatterStrength;  // overall SSS multiplier (energy budget)
    float anisotropy;       // phase function asymmetry
    float scatterPower;     // sharpness of the thickness rim
};

struct SssResult {
    vec3  color;        // final scattered radiance (already light-gated)
    float intensity;    // scalar scatter intensity 0..1 for debug views
    float wrapLight;    // wrapped diffuse factor for the light direction
    float transmittance;// thickness attenuation 0..1
    float backface;     // back-lit factor 0..1
    float curvatureW;   // curvature edge weight 0..1
    float phase;        // phase weight 0..2
};

// Transmission lighting factor for subsurface transport.
//
// Unlike front-face wrapped diffuse, the light enters through the *back* of
// the surface and exits toward the viewer. We therefore measure how directly
// the light points through the object: dot(-N, L) = -ndl is +1 when the light
// shines straight onto the back face (ideal transmission) and -1 for a fully
// front-lit pixel. A wrap term softens the terminator so side-lit rims still
// scatter, while front light is driven to exactly zero.
float sssTransmissionLight(float ndl, float wrap) {
    float w = clamp(wrap, 0.0, 0.999);
    // Remap so front-lit (ndl -> +1) maps to 0 and back-lit (ndl -> -1) to 1.
    float backNdl = -ndl;
    return clamp((backNdl + w) / (1.0 + w), 0.0, 1.0);
}

// Core approximation. All vectors are in the same view space; N is the
// geometric normal, L points toward the light, V points toward the viewer.
SssResult evaluateSss(SssParams p, vec3 N, vec3 L, vec3 V) {
    SssResult r;
    float ndl = dot(N, L);
    r.wrapLight = sssWrappedDiffuse(ndl, p.wrap);
    r.backface = sssBackfaceFactor(ndl);
    r.curvatureW = sssCurvatureWeight(p.curvature, p.curvatureScale);
    r.transmittance = sssTransmittance(p.thickness, p.density);
    r.phase = sssPhase(dot(V, L), p.anisotropy);

    // Thinness rim: 0 at the thick core, 1 at a paper-thin edge.
    float thinness = pow(clamp(1.0 - p.thickness, 0.0, 1.0),
                         clamp(p.scatterPower, 0.25, 8.0));

    // Transmission irradiance. Pure front light (ndl -> +1) maps to zero so
    // the material never glows on its lit side; back light maps to one; the
    // wrap term keeps a soft fringe around the terminator for side lighting.
    float transmissionLight = sssTransmissionLight(ndl, p.wrap);
    // The gate's job is only to separate "light can reach the back" from
    // "front-lit", not to re-introduce a radial gradient. Apply a soft floor
    // once transmission is active so thickness (not geometry) controls the
    // rim-versus-core contrast. A hard backface term would brighten the thick
    // core and fight the thin-rim requirement, so it is intentionally omitted.
    float gate = clamp(0.35 + 0.65 * transmissionLight, 0.0, 1.0);
    // Front light must still collapse to zero: multiply by a smoothed mask of
    // the transmission irradiance.
    gate *= smoothstep(0.02, 0.25, transmissionLight);

    // One coherent thickness response. Beer-Lambert transmittance is the
    // primary extinction; thinness and curvature only reshape the rim, blended
    // in rather than multiplied so thick geometry is not double-penalised.
    float thicknessResponse =
        r.transmittance *
        mix(1.0, thinness, 0.7) *
        mix(1.0, 1.0 + r.curvatureW, 0.5);

    // Phase weight normalised to a roughly unit mean so it shapes the angular
    // response without collapsing the overall energy budget.
    float phaseWeight = 0.5 + r.phase;
    r.intensity = clamp(
        p.scatterStrength *
        gate *
        thicknessResponse *
        phaseWeight,
        0.0, 1.0);

    // Back-lit colour shifts from the surface albedo toward the deep scatter
    // tint; the shift grows with the strength of the transmission regime.
    // Use the transmission irradiance (not just intensity) so even moderately
    // back-lit thin geometry takes on the scattered colour.
    float shift = clamp(pow(transmissionLight, 0.6) *
                        (0.6 + 1.1 * r.intensity), 0.0, 1.0);
    vec3 tint = mix(p.surfaceColor, p.scatterColor, shift);

    // Multiply by transmission irradiance: no light reaching the back of the
    // surface means no SSS. This is the core guard against the material
    // degenerating into an additive emissive glow.
    r.color = tint * r.intensity * transmissionLight;
    return r;
}

#endif // SSS_COMMON_GLSL
