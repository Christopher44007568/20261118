#pragma once
#include <cmath>
#include <cstdint>

struct Vec2 { float x, y; };
struct Vec3 {
    float x, y, z;
    Vec3 operator+(const Vec3& o) const { return {x+o.x, y+o.y, z+o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x-o.x, y-o.y, z-o.z}; }
    Vec3 operator*(float s) const { return {x*s, y*s, z*s}; }
};
struct Vec4 { float x, y, z, w; };

inline float dot3(const Vec3& a, const Vec3& b) {
    return a.x*b.x + a.y*b.y + a.z*b.z;
}
inline Vec3 cross3(const Vec3& a, const Vec3& b) {
    return {a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x};
}
inline float len3(const Vec3& v) { return std::sqrt(dot3(v, v)); }
inline Vec3 norm3(const Vec3& v) {
    float l = len3(v);
    return l > 1e-9f ? v * (1.0f / l) : Vec3{0,1,0};
}

// Column-major 4x4, matching OpenGL.
struct Mat4 {
    float m[16];
    static Mat4 identity() {
        Mat4 r{};
        r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1.0f;
        return r;
    }
};

Mat4 mat_perspective(float fovy_rad, float aspect, float znear, float zfar);
Mat4 mat_look_at(const Vec3& eye, const Vec3& center, const Vec3& up);
Mat4 mat_mul(const Mat4& a, const Mat4& b);
Vec4 mat_transform(const Mat4& a, const Vec4& v);

// 6 frustum planes in world space, normals pointing inward.
struct Frustum {
    Vec4 plane[6]; // ax + by + cz + d >= 0 inside
};
Frustum frustum_from_view_proj(const Mat4& view_proj);
bool frustum_intersects_aabb(const Frustum& f, const Vec3& mn, const Vec3& mx);

// Deterministic hash-based pseudo random in [0,1), stable across runs/platforms.
float rand01(uint32_t& seed);
uint32_t hash_u32(uint32_t x);
