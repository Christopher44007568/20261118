#pragma once
#include <algorithm>
#include <cmath>
#include <vector>
#include "scene.h"

// ---------------------------------------------------------------------------
// Software renderer with two transparency paths:
//  - Naive:  src-over blend in submission order (order-dependent).
//  - OIT:    weighted-blended accumulation buffer (premultiplied color sum +
//            transmittance product), resolved in a final composite pass.
//            Both operators are commutative, so any submission order yields
//            the same image; the depth weight keeps near surfaces dominant.
// ---------------------------------------------------------------------------

struct Framebuffer {
    int w, h;
    std::vector<float> color; // rgb per pixel
    std::vector<float> depth; // opaque depth (view z, smaller = nearer)

    Framebuffer(int width, int height)
        : w(width), h(height),
          color((size_t)width * height * 3, 0.0f),
          depth((size_t)width * height, 1e30f) {}
};

// A 3D quad: 4 corners CCW, shaded by `shader(u, v, z)` with u,v in [-1,1].
struct Quad {
    Vec3 p[4];
    Frag (*shader)(float, float, float);
};

struct Camera {
    int w, h;
    float f; // focal length in pixels
    float cx, cy;
    Camera(int width, int height)
        : w(width), h(height), f(0.9f * height), cx(0.5f * width), cy(0.5f * height) {}
};

using Shader = Frag (*)(float, float, float);

// Perspective-correct triangle rasterizer. attrs: (u, v, z) at each vertex.
template <typename Emit>
inline void rasterTri(const Camera& cam, const Vec3& a, const Vec3& b, const Vec3& c,
                      const float uv[3][2], Emit&& emit) {
    float sx[3], sy[3];
    sx[0] = cam.f * a.x / a.z + cam.cx; sy[0] = cam.cy - cam.f * a.y / a.z;
    sx[1] = cam.f * b.x / b.z + cam.cx; sy[1] = cam.cy - cam.f * b.y / b.z;
    sx[2] = cam.f * c.x / c.z + cam.cx; sy[2] = cam.cy - cam.f * c.y / c.z;
    float z[3] = {a.z, b.z, c.z};

    int x0 = std::max(0, (int)std::floor(std::min({sx[0], sx[1], sx[2]})));
    int x1 = std::min(cam.w - 1, (int)std::ceil(std::max({sx[0], sx[1], sx[2]})));
    int y0 = std::max(0, (int)std::floor(std::min({sy[0], sy[1], sy[2]})));
    int y1 = std::min(cam.h - 1, (int)std::ceil(std::max({sy[0], sy[1], sy[2]})));

    float d = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2]);
    if (std::fabs(d) < 1e-9f) return;

    for (int y = y0; y <= y1; ++y) {
        for (int x = x0; x <= x1; ++x) {
            float px = x + 0.5f, py = y + 0.5f;
            float w0 = ((sy[1] - sy[2]) * (px - sx[2]) + (sx[2] - sx[1]) * (py - sy[2])) / d;
            float w1 = ((sy[2] - sy[0]) * (px - sx[2]) + (sx[0] - sx[2]) * (py - sy[2])) / d;
            float w2 = 1.0f - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            // Perspective-correct interpolation via 1/z.
            float iw[3] = {w0 / z[0], w1 / z[1], w2 / z[2]};
            float inv = 1.0f / (iw[0] + iw[1] + iw[2]);
            float u = (iw[0] * uv[0][0] + iw[1] * uv[1][0] + iw[2] * uv[2][0]) * inv;
            float v = (iw[0] * uv[0][1] + iw[1] * uv[1][1] + iw[2] * uv[2][1]) * inv;
            float zz = inv; // 1 / (sum w_i / z_i)
            emit(x, y, u, v, zz);
        }
    }
}

template <typename Emit>
inline void rasterQuad(const Camera& cam, const Quad& q, Emit&& emit) {
    float uv[4][2] = {{-1, -1}, {1, -1}, {1, 1}, {-1, 1}};
    float t1[3][2] = {{uv[0][0], uv[0][1]}, {uv[1][0], uv[1][1]}, {uv[2][0], uv[2][1]}};
    float t2[3][2] = {{uv[0][0], uv[0][1]}, {uv[2][0], uv[2][1]}, {uv[3][0], uv[3][1]}};
    rasterTri(cam, q.p[0], q.p[1], q.p[2], t1, emit);
    rasterTri(cam, q.p[0], q.p[2], q.p[3], t2, emit);
}

// Sphere as a camera-facing disc with real spherical depth.
template <typename Emit>
inline void rasterSphere(const Camera& cam, Vec3 c, float radius, Emit&& emit) {
    float cx = cam.f * c.x / c.z + cam.cx;
    float cy = cam.cy - cam.f * c.y / c.z;
    float r = cam.f * radius / c.z;
    int x0 = std::max(0, (int)std::floor(cx - r)), x1 = std::min(cam.w - 1, (int)std::ceil(cx + r));
    int y0 = std::max(0, (int)std::floor(cy - r)), y1 = std::min(cam.h - 1, (int)std::ceil(cy + r));
    for (int y = y0; y <= y1; ++y)
        for (int x = x0; x <= x1; ++x) {
            float u = (x + 0.5f - cx) / r, v = (cy - (y + 0.5f)) / r;
            if (u * u + v * v > 1.0f) continue;
            float z = c.z - radius * std::sqrt(std::max(0.0f, 1.0f - u * u - v * v));
            emit(x, y, u, v, z);
        }
}

// --- Opaque pass -------------------------------------------------------------

inline void drawOpaque(Framebuffer& fb, const Camera& cam, const Quad& q) {
    rasterQuad(cam, q, [&](int x, int y, float u, float v, float z) {
        size_t i = (size_t)y * fb.w + x;
        if (z >= fb.depth[i]) return;
        Frag f = q.shader(u, v, z);
        fb.depth[i] = z;
        fb.color[i * 3 + 0] = f.r;
        fb.color[i * 3 + 1] = f.g;
        fb.color[i * 3 + 2] = f.b;
    });
}

inline void drawOpaqueSphere(Framebuffer& fb, const Camera& cam, Vec3 c, float r, Shader sh) {
    rasterSphere(cam, c, r, [&](int x, int y, float u, float v, float z) {
        size_t i = (size_t)y * fb.w + x;
        if (z >= fb.depth[i]) return;
        Frag f = sh(u, v, z);
        fb.depth[i] = z;
        fb.color[i * 3 + 0] = f.r;
        fb.color[i * 3 + 1] = f.g;
        fb.color[i * 3 + 2] = f.b;
    });
}

// --- Naive path: src-over in submission order --------------------------------

inline void blendNaive(Framebuffer& fb, const Camera& cam, const Quad& q) {
    rasterQuad(cam, q, [&](int x, int y, float u, float v, float z) {
        size_t i = (size_t)y * fb.w + x;
        if (z >= fb.depth[i]) return; // opaque geometry still occludes
        Frag f = q.shader(u, v, z);   // premultiplied src
        fb.color[i * 3 + 0] = f.r + fb.color[i * 3 + 0] * (1.0f - f.a);
        fb.color[i * 3 + 1] = f.g + fb.color[i * 3 + 1] * (1.0f - f.a);
        fb.color[i * 3 + 2] = f.b + fb.color[i * 3 + 2] * (1.0f - f.a);
    });
}

// --- OIT path: accumulation buffer + resolve pass ----------------------------

struct OitBuffers {
    std::vector<float> acc;       // rgb: sum(C_i * w_i), a: sum(alpha_i * w_i)
    std::vector<float> revealage; // product of (1 - alpha_i), init 1
    OitBuffers(int w, int h)
        : acc((size_t)w * h * 4, 0.0f), revealage((size_t)w * h, 1.0f) {}
};

// McGuire-style depth weight: strongly favors near fragments so nearer
// surfaces dominate (occlude) farther ones in the weighted average.
inline float oitWeight(float alpha, float z) {
    float dz = z - 1.0f; // camera near plane at z = 1
    return alpha * std::max(1e-2f, std::min(3e3f, 10.0f / (1e-5f + dz * dz * dz)));
}

inline void accumulateOit(OitBuffers& buf, const Framebuffer& fb, const Camera& cam,
                          const Quad& q) {
    rasterQuad(cam, q, [&](int x, int y, float u, float v, float z) {
        size_t i = (size_t)y * fb.w + x;
        if (z >= fb.depth[i]) return; // depth-tested against opaque geometry
        Frag f = q.shader(u, v, z);   // premultiplied src
        float w = oitWeight(f.a, z);
        buf.acc[i * 4 + 0] += f.r * w;
        buf.acc[i * 4 + 1] += f.g * w;
        buf.acc[i * 4 + 2] += f.b * w;
        buf.acc[i * 4 + 3] += f.a * w;
        buf.revealage[i] *= (1.0f - f.a);
    });
}

// Composite pass: average the accumulated color, attenuate by transmittance,
// and blend over the opaque background.
inline void resolveOit(Framebuffer& fb, const OitBuffers& buf) {
    size_t n = (size_t)fb.w * fb.h;
    for (size_t i = 0; i < n; ++i) {
        float aw = buf.acc[i * 4 + 3];
        float inv = 1.0f / std::max(aw, 1e-5f);
        float t = buf.revealage[i]; // remaining transmittance
        fb.color[i * 3 + 0] = buf.acc[i * 4 + 0] * inv * (1.0f - t) + fb.color[i * 3 + 0] * t;
        fb.color[i * 3 + 1] = buf.acc[i * 4 + 1] * inv * (1.0f - t) + fb.color[i * 3 + 1] * t;
        fb.color[i * 3 + 2] = buf.acc[i * 4 + 2] * inv * (1.0f - t) + fb.color[i * 3 + 2] * t;
    }
}
