#pragma once
#include <cmath>
#include <algorithm>

struct Vec2 {
    float x = 0, y = 0;
    Vec2 operator-(const Vec2& o) const { return {x - o.x, y - o.y}; }
};

struct Vec3 {
    float x = 0, y = 0, z = 0;
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
    Vec3 operator/(float s) const { return {x / s, y / s, z / s}; }
    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    float dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }
    Vec3 cross(const Vec3& o) const {
        return {y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x};
    }
    float length() const { return std::sqrt(dot(*this)); }
};

inline Vec3 normalize(const Vec3& v) {
    float len = v.length();
    if (len < 1e-12f) return {0, 0, 0};
    return v / len;
}

// Normalize with fallback: never returns NaN, even for zero-length input.
inline Vec3 safeNormalize(const Vec3& v, const Vec3& fallback) {
    float len = v.length();
    if (len < 1e-8f || !std::isfinite(len)) return fallback;
    return v / len;
}

// Frisvad orthonormal basis: builds a tangent/bitangent pair from a normal
// alone. Used as the fallback when UVs are degenerate.
inline void orthonormalBasis(const Vec3& n, Vec3& t, Vec3& b) {
    if (n.z < -0.9999999f) {
        t = {0, -1, 0};
        b = {-1, 0, 0};
        return;
    }
    float a = 1.0f / (1.0f + n.z);
    float c = -n.x * n.y * a;
    t = {1.0f - n.x * n.x * a, c, -n.x};
    b = {c, 1.0f - n.y * n.y * a, -n.y};
}

inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}
