#pragma once
// Renders test spheres shaded two ways and measures the difference:
//  - LUT path:    envColor(R) * (F0 * lut.scale + lut.bias)
//  - numeric ref: envColor(R) * (F0 * scale + bias) with scale/bias
//                 integrated per-pixel at high sample count.

#include "lut.h"
#include <string>

struct Material {
    std::string name;
    float roughness;
    Vec3 f0;
};

// Simple procedural environment: sky gradient + warm sun disk.
inline Vec3 envColor(const Vec3& d) {
    float t = clampf(d.y * 0.5f + 0.5f, 0.0f, 1.0f);
    Vec3 sky{0.10f + 0.35f * t, 0.14f + 0.42f * t, 0.22f + 0.58f * t};
    Vec3 sunDir{0.5f, 0.6f, 0.62f};
    float len = std::sqrt(dot(sunDir, sunDir));
    sunDir = sunDir * (1.0f / len);
    float s = clampf(dot(d, sunDir), 0.0f, 1.0f);
    float disk = std::pow(s, 900.0f) * 24.0f + std::pow(s, 24.0f) * 0.6f;
    return {sky.x + disk * 1.0f, sky.y + disk * 0.85f, sky.z + disk * 0.65f};
}

inline Vec3 reflect(const Vec3& v, const Vec3& n) { return n * (2.0f * dot(v, n)) - v; }

struct CompareResult {
    double maxAbsError = 0.0;   // max |lumLUT - lumRef| over sphere pixels
    double maxRelError = 0.0;   // max relative error (vs reference luminance)
    double maxAbsErrorInner = 0.0; // max abs error where NdotV >= 0.05
    float maxErrNdotV = 0.0f;   // NdotV at which the max abs error occurs
    double meanAbsError = 0.0;
    int pixelCount = 0;
    std::vector<uint8_t> imgLut, imgRef, imgDiff; // RGB8, size*size
    int imgSize = 0;
};

inline uint8_t toSrgb8(float v) {
    v = clampf(v, 0.0f, 1.0f);
    float s = v <= 0.0031308f ? 12.92f * v : 1.055f * std::pow(v, 1.0f / 2.4f) - 0.055f;
    return uint8_t(clampf(s, 0.0f, 1.0f) * 255.0f + 0.5f);
}

inline CompareResult compareMaterial(const BrdfLut& lut, const Material& mat,
                                     int imgSize, uint32_t refSamples) {
    CompareResult res;
    res.imgSize = imgSize;
    res.imgLut.resize(size_t(imgSize) * imgSize * 3);
    res.imgRef.resize(res.imgLut.size());
    res.imgDiff.resize(res.imgLut.size());
    Vec3 viewDir{0.0f, 0.0f, 1.0f};
    double errSum = 0.0;

    for (int py = 0; py < imgSize; ++py) {
        for (int px = 0; px < imgSize; ++px) {
            float nx = (2.0f * (px + 0.5f) / imgSize - 1.0f);
            float ny = (2.0f * (py + 0.5f) / imgSize - 1.0f);
            size_t idx = (size_t(py) * imgSize + px) * 3;
            float r2 = nx * nx + ny * ny;
            if (r2 > 1.0f) {
                Vec3 bg = envColor({nx * 0.8f, -ny * 0.8f, 0.6f});
                for (int c = 0; c < 3; ++c) {
                    res.imgLut[idx + c] = res.imgRef[idx + c] = toSrgb8((&bg.x)[c] * 0.25f);
                    res.imgDiff[idx + c] = 0;
                }
                continue;
            }
            Vec3 n{nx, -ny, std::sqrt(1.0f - r2)};
            float ndotV = clampf(dot(n, viewDir), 0.0f, 1.0f);
            Vec3 refl = reflect(viewDir * -1.0f, n);
            Vec3 env = envColor(refl);

            Vec2 sbLut = lut.sample(ndotV, mat.roughness);
            Vec2 sbRef = integrateEnvBRDF(ndotV, mat.roughness, refSamples);

            float lumLut = 0.0f, lumRef = 0.0f;
            for (int c = 0; c < 3; ++c) {
                float f0 = (&mat.f0.x)[c];
                float e = (&env.x)[c];
                float lutC = e * (f0 * sbLut.x + sbLut.y);
                float refC = e * (f0 * sbRef.x + sbRef.y);
                res.imgLut[idx + c] = toSrgb8(lutC);
                res.imgRef[idx + c] = toSrgb8(refC);
                float diff = std::fabs(lutC - refC);
                res.imgDiff[idx + c] = toSrgb8(diff * 10.0f); // x10 amplified
                lumLut += lutC * (c == 0 ? 0.2126f : c == 1 ? 0.7152f : 0.0722f);
                lumRef += refC * (c == 0 ? 0.2126f : c == 1 ? 0.7152f : 0.0722f);
            }
            double err = std::fabs(lumLut - lumRef);
            errSum += err;
            if (err > res.maxAbsError) {
                res.maxAbsError = err;
                res.maxErrNdotV = ndotV;
            }
            if (lumRef > 1e-4)
                res.maxRelError = std::max(res.maxRelError, err / double(lumRef));
            if (ndotV >= 0.05f) res.maxAbsErrorInner = std::max(res.maxAbsErrorInner, err);
            ++res.pixelCount;
        }
    }
    res.meanAbsError = errSum / double(res.pixelCount);
    return res;
}
