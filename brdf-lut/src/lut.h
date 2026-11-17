#pragma once
// Environment BRDF lookup table: R = scale, G = bias, indexed by
// u = NdotV (x axis), v = roughness (y axis).

#include "env_brdf.h"
#include <vector>

struct BrdfLut {
    int size = 0;
    std::vector<Vec2> texels; // size*size, row-major, row 0 = roughness 0

    // texel-center mapping keeps every sample inside the texture
    Vec2 fetch(int x, int y) const {
        x = x < 0 ? 0 : (x >= size ? size - 1 : x);
        y = y < 0 ? 0 : (y >= size ? size - 1 : y);
        return texels[size_t(y) * size + x];
    }

    // Bilinear sample with clamped, half-texel-mapped coordinates.
    // Accepts any ndotV/roughness; clamps into [0,1] first so the lookup
    // can never leave the texture boundary.
    Vec2 sample(float ndotV, float roughness) const {
        float u = clampf(ndotV, 0.0f, 1.0f) * size - 0.5f;
        float v = clampf(roughness, 0.0f, 1.0f) * size - 0.5f;
        int x0 = int(std::floor(u)), y0 = int(std::floor(v));
        float fx = u - x0, fy = v - y0;
        Vec2 c00 = fetch(x0, y0), c10 = fetch(x0 + 1, y0);
        Vec2 c01 = fetch(x0, y0 + 1), c11 = fetch(x0 + 1, y0 + 1);
        auto lerp = [](float a, float b, float t) { return a + (b - a) * t; };
        return {lerp(lerp(c00.x, c10.x, fx), lerp(c01.x, c11.x, fx), fy),
                lerp(lerp(c00.y, c10.y, fx), lerp(c01.y, c11.y, fx), fy)};
    }
};

inline BrdfLut generateLut(int size, uint32_t sampleCount) {
    BrdfLut lut;
    lut.size = size;
    lut.texels.resize(size_t(size) * size);
    for (int y = 0; y < size; ++y) {
        float roughness = (float(y) + 0.5f) / float(size);
        for (int x = 0; x < size; ++x) {
            float ndotV = (float(x) + 0.5f) / float(size);
            lut.texels[size_t(y) * size + x] = integrateEnvBRDF(ndotV, roughness, sampleCount);
        }
    }
    return lut;
}
