#include "math_util.h"

Mat4 mat_perspective(float fovy, float aspect, float znear, float zfar) {
    float f = 1.0f / std::tan(fovy * 0.5f);
    Mat4 r{};
    r.m[0] = f / aspect;
    r.m[5] = f;
    r.m[10] = (zfar + znear) / (znear - zfar);
    r.m[11] = -1.0f;
    r.m[14] = (2.0f * zfar * znear) / (znear - zfar);
    return r;
}

Mat4 mat_look_at(const Vec3& eye, const Vec3& center, const Vec3& up) {
    Vec3 f = norm3(center - eye);
    Vec3 s = norm3(cross3(f, up));
    Vec3 u = cross3(s, f);
    Mat4 r = Mat4::identity();
    r.m[0] = s.x;  r.m[4] = s.y;  r.m[8]  = s.z;
    r.m[1] = u.x;  r.m[5] = u.y;  r.m[9]  = u.z;
    r.m[2] = -f.x; r.m[6] = -f.y; r.m[10] = -f.z;
    r.m[12] = -dot3(s, eye);
    r.m[13] = -dot3(u, eye);
    r.m[14] =  dot3(f, eye);
    return r;
}

Mat4 mat_mul(const Mat4& a, const Mat4& b) {
    Mat4 r{};
    for (int c = 0; c < 4; ++c) {
        for (int row = 0; row < 4; ++row) {
            float s = 0.0f;
            for (int k = 0; k < 4; ++k)
                s += a.m[k*4 + row] * b.m[c*4 + k];
            r.m[c*4 + row] = s;
        }
    }
    return r;
}

Vec4 mat_transform(const Mat4& a, const Vec4& v) {
    Vec4 r;
    r.x = a.m[0]*v.x + a.m[4]*v.y + a.m[8]*v.z  + a.m[12]*v.w;
    r.y = a.m[1]*v.x + a.m[5]*v.y + a.m[9]*v.z  + a.m[13]*v.w;
    r.z = a.m[2]*v.x + a.m[6]*v.y + a.m[10]*v.z + a.m[14]*v.w;
    r.w = a.m[3]*v.x + a.m[7]*v.y + a.m[11]*v.z + a.m[15]*v.w;
    return r;
}

// Gribb-Hartmann plane extraction from a composite view-projection matrix.
Frustum frustum_from_view_proj(const Mat4& vp) {
    Frustum fr;
    const float* m = vp.m; // column-major: m[col*4+row]
    Vec4 row0 = {m[0], m[4], m[8],  m[12]};
    Vec4 row1 = {m[1], m[5], m[9],  m[13]};
    Vec4 row2 = {m[2], m[6], m[10], m[14]};
    Vec4 row3 = {m[3], m[7], m[11], m[15]};
    auto add = [](Vec4& dst, const Vec4& a, const Vec4& b, int sign) {
        dst = {a.x + sign*b.x, a.y + sign*b.y, a.z + sign*b.z, a.w + sign*b.w};
        float l = std::sqrt(dst.x*dst.x + dst.y*dst.y + dst.z*dst.z);
        if (l > 1e-9f) { dst.x/=l; dst.y/=l; dst.z/=l; dst.w/=l; }
    };
    add(fr.plane[0], row3, row0, +1); // left
    add(fr.plane[1], row3, row0, -1); // right
    add(fr.plane[2], row3, row1, +1); // bottom
    add(fr.plane[3], row3, row1, -1); // top
    add(fr.plane[4], row3, row2, +1); // near
    add(fr.plane[5], row3, row2, -1); // far
    return fr;
}

bool frustum_intersects_aabb(const Frustum& f, const Vec3& mn, const Vec3& mx) {
    for (int p = 0; p < 6; ++p) {
        const Vec4& pl = f.plane[p];
        // Positive vertex (most-inside corner) for this plane.
        Vec3 pv = {
            pl.x >= 0 ? mx.x : mn.x,
            pl.y >= 0 ? mx.y : mn.y,
            pl.z >= 0 ? mx.z : mn.z
        };
        if (pl.x*pv.x + pl.y*pv.y + pl.z*pv.z + pl.w < 0.0f)
            return false;
    }
    return true;
}

uint32_t hash_u32(uint32_t x) {
    x ^= x >> 16; x *= 0x7feb352du;
    x ^= x >> 15; x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

float rand01(uint32_t& seed) {
    seed = hash_u32(seed);
    return (seed >> 8) * (1.0f / 16777216.0f); // 24-bit mantissa
}
