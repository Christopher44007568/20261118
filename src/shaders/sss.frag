#version 300 es
// Approximate subsurface scattering material shader.
//
// Debug modes (uDebugMode):
//   0 final composite
//   1 thickness map   (blue->red: thin edge -> thick core)
//   2 scatter term    (the gated SSS intensity, greyscale + tint)
//   3 normals         (view-space normal mapped to RGB)
//   4 curvature       (signed mean curvature, zero = grey)
//   5 direct diffuse  (no SSS, for comparison)
precision highp float;

#include "sss_common.glsl"

in vec3 vViewPos;
in vec3 vViewNormal;
in vec3 vWorldNormal;
in vec3 vWorldPos;

uniform sampler2D uFrontPos;   // RGBA32F front surface view pos + depth
uniform sampler2D uBackPos;    // RGBA32F back surface view pos + depth
uniform sampler2D uFrontNormal; // RGBA32F front surface view-space normal
uniform vec2  uTexel;
uniform vec3  uLightDir;       // view space, points TOWARD the light
uniform vec3  uLightColor;
uniform vec3  uCameraPos;

uniform vec3  uSurfaceColor;
uniform vec3  uScatterColor;
uniform float uCurvatureScale;
uniform float uDensity;
uniform float uWrap;
uniform float uScatterStrength;
uniform float uAnisotropy;
uniform float uScatterPower;
uniform float uThicknessScale;  // world units mapped to thickness = 1
uniform float uSssGain;         // transmission-only display gain
uniform float uSpecular;
uniform float uShininess;
uniform int   uDebugMode;

out vec4 fragColor;

// Reconstruct linear optical thickness from front/back view-space depths.
float sampleThickness(vec2 uv) {
    float frontDepth = texture(uFrontPos, uv).w;
    float backDepth  = texture(uBackPos,  uv).w;
    float worldThickness = max(backDepth - frontDepth, 0.0);
    return clamp(worldThickness / max(uThicknessScale, 1e-4), 0.0, 1.0);
}

// Screen-space mean curvature estimated from the divergence of the view-space
// normal field. On a convex body the normal turns fastest at the silhouette,
// so the magnitude of its spatial gradient is a stable curvature proxy.
float estimateCurvature(vec2 uv) {
    vec3 nL = texture(uFrontNormal, uv - vec2(uTexel.x, 0.0)).xyz;
    vec3 nR = texture(uFrontNormal, uv + vec2(uTexel.x, 0.0)).xyz;
    vec3 nD = texture(uFrontNormal, uv - vec2(0.0, uTexel.y)).xyz;
    vec3 nU = texture(uFrontNormal, uv + vec2(0.0, uTexel.y)).xyz;
    vec3 dNdx = normalize(nR) - normalize(nL);
    vec3 dNdy = normalize(nU) - normalize(nD);
    // Magnitude of the normal gradient, scaled to a useful range. This rises
    // toward high-curvature rims and folds and stays ~0 on flat regions.
    float k = length(dNdx) + length(dNdy);
    return k;
}

vec3 heatRamp(float t) {
    // 0 (thin) = deep blue, 0.5 = green, 1 (thick) = hot red.
    vec3 c0 = vec3(0.05, 0.10, 0.55);
    vec3 c1 = vec3(0.10, 0.75, 0.55);
    vec3 c2 = vec3(0.95, 0.25, 0.15);
    return t < 0.5 ? mix(c0, c1, t * 2.0) : mix(c1, c2, (t - 0.5) * 2.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy * uTexel;
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(-vViewPos);
    vec3 L = normalize(uLightDir);

    float thickness = sampleThickness(uv);
    float curvature = estimateCurvature(uv);

    // Direct diffuse (wrapped Lambert) shared by the composite and debug 5.
    float ndl = dot(N, L);
    float directWrap = sssWrappedDiffuse(ndl, uWrap * 0.5);
    vec3 diffuse = uSurfaceColor * directWrap * uLightColor;

    // Specular lobe (Blinn-Phong), kept modest so SSS stays the focus.
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), uShininess) * uSpecular;
    vec3 specular = uLightColor * spec;

    SssParams sp;
    sp.surfaceColor = uSurfaceColor;
    sp.scatterColor = uScatterColor;
    sp.thickness = thickness;
    sp.curvature = curvature;
    sp.curvatureScale = uCurvatureScale;
    sp.density = uDensity;
    sp.wrap = uWrap;
    sp.scatterStrength = uScatterStrength;
    sp.anisotropy = uAnisotropy;
    sp.scatterPower = uScatterPower;
    SssResult sss = evaluateSss(sp, N, L, V);

    if (uDebugMode == 1) {           // thickness map
        fragColor = vec4(heatRamp(thickness), 1.0);
        return;
    }
    if (uDebugMode == 2) {           // scatter term
        // Debug view of the gated scatter term. Intensity drives brightness;
        // the tint shows the surface->scatter colour shift. A fixed lift keeps
        // low-energy regions legible without faking extra radiance.
        vec3 tint = mix(uSurfaceColor, uScatterColor,
                        clamp(sss.intensity * 2.0, 0.0, 1.0));
        vec3 viz = tint * (0.08 + 2.2 * sss.intensity);
        fragColor = vec4(min(viz, vec3(1.0)), 1.0);
        return;
    }
    if (uDebugMode == 3) {           // normals
        fragColor = vec4(N * 0.5 + 0.5, 1.0);
        return;
    }
    if (uDebugMode == 4) {           // curvature
        // Curvature is a non-negative gradient magnitude here; map to a
        // black(flat)..white(highly curved) ramp for the debug view.
        float c = clamp(curvature * 8.0, 0.0, 1.0);
        fragColor = vec4(vec3(c), 1.0);
        return;
    }
    if (uDebugMode == 5) {           // direct diffuse only
        fragColor = vec4(diffuse + specular, 1.0);
        return;
    }

    // Final composite. SSS replaces/augments diffuse on back-lit thin regions
    // rather than being blindly added everywhere.
    vec3 sssRadiance = sss.color * uLightColor;
    // Energy conserving blend: where SSS dominates, diffuse is suppressed.
    float sssMask = clamp(sss.intensity, 0.0, 1.0);
    // A dedicated gain lets the transmission read clearly without making the
    // front-lit diffuse emit. It only multiplies the light-gated SSS term.
    vec3 base = diffuse * (1.0 - sssMask * 0.75);
    vec3 color = base + sssRadiance * uSssGain + specular;

    // Hard ceiling prevents HDR blowout / additive glow artifacts.
    color = min(color, vec3(1.0));
    fragColor = vec4(color, 1.0);
}
