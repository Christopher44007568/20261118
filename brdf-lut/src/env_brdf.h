#pragma once
// Shared GGX / split-sum environment BRDF math.
// The LUT stores, per (NdotV, roughness), the two coefficients of
//   integral( D*G*F * NdotL ) = F0 * scale + bias
// so the runtime shader only needs one texture fetch.

#include <cmath>
#include <cstdint>

struct Vec2 {
    float x, y;
};

struct Vec3 {
    float x, y, z;
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
};

inline float dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

inline float radicalInverseVdC(uint32_t bits) {
    bits = (bits << 16u) | (bits >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return float(bits) * 2.3283064365386963e-10f; // / 2^32
}

inline Vec2 hammersley(uint32_t i, uint32_t n) {
    return {float(i) / float(n), radicalInverseVdC(i)};
}

// GGX half-vector importance sample, tangent space (N = +Z).
inline Vec3 importanceSampleGGX(Vec2 xi, float roughness) {
    float a = roughness * roughness;
    float phi = 2.0f * 3.14159265358979f * xi.x;
    float cosTheta = std::sqrt((1.0f - xi.y) / (1.0f + (a * a - 1.0f) * xi.y));
    float sinTheta = std::sqrt(1.0f - cosTheta * cosTheta);
    return {sinTheta * std::cos(phi), sinTheta * std::sin(phi), cosTheta};
}

// Height-correlated Smith masking-shadowing for GGX.
// Returns G / (4 NdotV NdotL) directly (the visibility term).
inline float visibilitySmithCorrelated(float ndotV, float ndotL, float roughness) {
    float a2 = roughness * roughness;
    a2 *= a2; // alpha^2 = (roughness^2)^2
    float gv = ndotL * std::sqrt(ndotV * ndotV * (1.0f - a2) + a2);
    float gl = ndotV * std::sqrt(ndotL * ndotL * (1.0f - a2) + a2);
    return 0.5f / (gv + gl + 1e-6f);
}

// Monte-Carlo integration of the environment BRDF (Karis split-sum, part 2).
// Returns {scale, bias} such that specular ~= envPrefiltered * (F0*scale + bias).
inline Vec2 integrateEnvBRDF(float ndotV, float roughness, uint32_t sampleCount) {
    ndotV = clampf(ndotV, 1e-4f, 1.0f);
    Vec3 v{std::sqrt(1.0f - ndotV * ndotV), 0.0f, ndotV};
    float a = 0.0f, b = 0.0f;
    for (uint32_t i = 0; i < sampleCount; ++i) {
        Vec2 xi = hammersley(i, sampleCount);
        Vec3 h = importanceSampleGGX(xi, roughness);
        float vdotH = clampf(dot(v, h), 0.0f, 1.0f);
        Vec3 l = h * (2.0f * vdotH) - v;
        float ndotL = clampf(l.z, 0.0f, 1.0f);
        float ndotH = clampf(h.z, 0.0f, 1.0f);
        if (ndotL > 0.0f) {
            float vis = visibilitySmithCorrelated(ndotV, ndotL, roughness);
            float gVis = vis * 4.0f * ndotL * vdotH / (ndotH * ndotV + 1e-6f);
            float fc = std::pow(1.0f - vdotH, 5.0f);
            a += (1.0f - fc) * gVis;
            b += fc * gVis;
        }
    }
    return {a / float(sampleCount), b / float(sampleCount)};
}
