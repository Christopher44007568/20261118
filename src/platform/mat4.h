#ifndef MAT4_H
#define MAT4_H

#include <math.h>

typedef struct { float m[16]; } Mat4;
typedef struct { float x, y, z; } Vec3;

static Mat4 mat4_identity(void) {
    Mat4 r = {{0}};
    r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1.0f;
    return r;
}

// mat4_multiply is used by the diagnostic tools in sandbox/ and the WebGL
// viewer's math; kept available but marked to avoid unused warnings here.
static Mat4 mat4_multiply(Mat4 a, Mat4 b) __attribute__((unused));
static Mat4 mat4_multiply(Mat4 a, Mat4 b) {
    Mat4 r;
    for (int c = 0; c < 4; ++c) {
        for (int row = 0; row < 4; ++row) {
            float sum = 0.0f;
            for (int k = 0; k < 4; ++k)
                sum += a.m[k * 4 + row] * b.m[c * 4 + k];
            r.m[c * 4 + row] = sum;
        }
    }
    return r;
}

static Mat4 mat4_perspective(float fovyRad, float aspect, float nearP,
                             float farP) {
    Mat4 r = {{0}};
    float f = 1.0f / tanf(fovyRad / 2.0f);
    r.m[0] = f / aspect;
    r.m[5] = f;
    // Standard GL convention: NDC z grows with distance, so near -> -1,
    // far -> +1 and the depth buffer orders near before far correctly.
    r.m[10] = (farP + nearP) / (farP - nearP);
    r.m[11] = -1.0f;
    r.m[14] = (2.0f * farP * nearP) / (farP - nearP);
    return r;
}

static Mat4 mat4_look_at(Vec3 eye, Vec3 center, Vec3 up) {
    Vec3 f = { center.x - eye.x, center.y - eye.y, center.z - eye.z };
    float flen = sqrtf(f.x*f.x + f.y*f.y + f.z*f.z);
    f.x /= flen; f.y /= flen; f.z /= flen;
    Vec3 s = { f.y*up.z - f.z*up.y, f.z*up.x - f.x*up.z,
               f.x*up.y - f.y*up.x };
    float slen = sqrtf(s.x*s.x + s.y*s.y + s.z*s.z);
    s.x /= slen; s.y /= slen; s.z /= slen;
    Vec3 u = { s.y*f.z - s.z*f.y, s.z*f.x - s.x*f.z,
               s.x*f.y - s.y*f.x };
    Mat4 r = mat4_identity();
    r.m[0] = s.x;  r.m[4] = s.y;  r.m[8]  = s.z;
    r.m[1] = u.x;  r.m[5] = u.y;  r.m[9]  = u.z;
    r.m[2] = -f.x; r.m[6] = -f.y; r.m[10] = -f.z;
    r.m[12] = -(s.x*eye.x + s.y*eye.y + s.z*eye.z);
    r.m[13] = -(u.x*eye.x + u.y*eye.y + u.z*eye.z);
    r.m[14] =  (f.x*eye.x + f.y*eye.y + f.z*eye.z);
    return r;
}

static Mat4 mat4_scale(float x, float y, float z) {
    Mat4 r = mat4_identity();
    r.m[0] = x; r.m[5] = y; r.m[10] = z;
    return r;
}

__attribute__((unused))
static Mat4 mat4_translate(float x, float y, float z) {
    Mat4 r = mat4_identity();
    r.m[12] = x; r.m[13] = y; r.m[14] = z;
    return r;
}

#endif
