#pragma once
#include <vector>
#include "linalg.h"

// Tangent-space normal map, stored as decoded normals in [-1,1].
struct NormalMap {
    int w = 0, h = 0;
    std::vector<Vec3> texel;

    Vec3 sample(float u, float v) const {
        u -= std::floor(u);
        v -= std::floor(v);
        float fx = u * w - 0.5f, fy = v * h - 0.5f;
        int x0 = (int)std::floor(fx), y0 = (int)std::floor(fy);
        float tx = fx - x0, ty = fy - y0;
        auto at = [&](int x, int y) -> Vec3 {
            x = (x % w + w) % w;
            y = (y % h + h) % h;
            return texel[size_t(y) * w + x];
        };
        Vec3 c00 = at(x0, y0), c10 = at(x0 + 1, y0);
        Vec3 c01 = at(x0, y0 + 1), c11 = at(x0 + 1, y0 + 1);
        Vec3 c0 = c00 * (1 - tx) + c10 * tx;
        Vec3 c1 = c01 * (1 - tx) + c11 * tx;
        return safeNormalize(c0 * (1 - ty) + c1 * ty, {0, 0, 1});
    }
};

// Build a tangent-space normal map from a heightfield via central differences.
inline NormalMap normalMapFromHeight(int w, int h, const std::vector<float>& hgt,
                                     float strength) {
    NormalMap nm;
    nm.w = w;
    nm.h = h;
    nm.texel.resize(size_t(w) * h);
    auto at = [&](int x, int y) {
        x = (x % w + w) % w;
        y = (y % h + h) % h;
        return hgt[size_t(y) * w + x];
    };
    for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++) {
            float dx = (at(x + 1, y) - at(x - 1, y)) * strength * w * 0.5f;
            float dy = (at(x, y + 1) - at(x, y - 1)) * strength * h * 0.5f;
            nm.texel[size_t(y) * w + x] = normalize(Vec3{-dx, -dy, 1.0f});
        }
    return nm;
}

// Procedural brick wall: staggered bricks with mortar grooves.
inline NormalMap makeBrickNormalMap(int res = 256) {
    std::vector<float> hgt(size_t(res) * res);
    int rows = 8, cols = 4;
    float mortar = 0.035f; // half-width of mortar in brick units
    for (int y = 0; y < res; y++)
        for (int x = 0; x < res; x++) {
            float u = (float)x / res, v = (float)y / res;
            float row = v * rows;
            int ri = (int)std::floor(row);
            float fv = row - ri;
            float fu = u * cols + (ri % 2 ? 0.5f : 0.0f);
            fu -= std::floor(fu);
            // Rounded brick profile: 1 inside, dipping to 0 in mortar.
            float bx = std::min(fu, 1.0f - fu) / mortar;
            float by = std::min(fv, 1.0f - fv) / (mortar * rows / cols);
            float d = std::min(bx, by);
            float h = clampf(d, 0.0f, 1.0f);
            h = h * h * (3 - 2 * h); // smoothstep bevel
            hgt[size_t(y) * res + x] = h;
        }
    return normalMapFromHeight(res, res, hgt, 0.6f);
}

// Procedural dimple/bump pattern for the sphere.
inline NormalMap makeBumpNormalMap(int res = 256) {
    std::vector<float> hgt(size_t(res) * res);
    const float pi = 3.14159265358979f;
    for (int y = 0; y < res; y++)
        for (int x = 0; x < res; x++) {
            float u = (float)x / res, v = (float)y / res;
            float s = std::sin(u * 6 * 2 * pi) * std::sin(v * 4 * 2 * pi);
            hgt[size_t(y) * res + x] = 0.5f + 0.5f * s;
        }
    return normalMapFromHeight(res, res, hgt, 0.35f);
}

// Constant slanted normal: used for the mirrored-UV lighting test, where a
// spatially uniform tilt makes inverted handedness directly measurable.
inline NormalMap makeSlantNormalMap(float tx = 0.45f, float ty = 0.0f) {
    NormalMap nm;
    nm.w = nm.h = 4;
    nm.texel.assign(16, safeNormalize(Vec3{tx, ty, 1.0f}, {0, 0, 1}));
    return nm;
}

// Rotate a tangent-space normal by `angle` radians in the tangent plane.
// Equivalent to rotating the normal map texture; the world-space lighting
// (e.g. specular highlight direction) must rotate accordingly.
inline Vec3 rotateTangentNormal(const Vec3& n, float angle) {
    float c = std::cos(angle), s = std::sin(angle);
    return {c * n.x - s * n.y, s * n.x + c * n.y, n.z};
}
