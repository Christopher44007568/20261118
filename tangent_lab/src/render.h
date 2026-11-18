#pragma once
#include "mesh.h"
#include "normalmap.h"
#include "image.h"

enum class ShadingMode {
    NoTangent,   // baseline (wrong): use the normal map as a world-space normal
    Reconstructed, // per-fragment TBN rebuilt from position/UV derivatives
    Exported,    // per-vertex tangent attribute, interpolated
    NaiveNoHandedness // reconstructed but ignoring UV mirror sign (for contrast)
};

enum class VizMode { Lit, Specular, Tangent, Bitangent, Normal };

struct Camera {
    Vec3 eye{0, 0, 3.2f};
    Vec3 target{0, 0, 0};
    Vec3 up{0, 1, 0};
    float fovYDeg = 40.0f;
    float orthoHalf = 0.0f; // > 0 selects orthographic projection

    Vec3 fwd, right, upv;
    void build() {
        fwd = normalize(target - eye);
        right = normalize(fwd.cross(up));
        upv = right.cross(fwd);
    }
};

struct Light {
    // Direction the light travels; default comes from upper-left-front.
    Vec3 dir = normalize(Vec3{0.45f, -0.55f, -0.7f});
    Vec3 color{1, 1, 1};
    float ambient = 0.12f;
    float specStrength = 0.6f;
    float shininess = 32.0f;
};

struct RenderOptions {
    ShadingMode mode = ShadingMode::Reconstructed;
    VizMode viz = VizMode::Lit;
    float normalRotation = 0.0f; // radians, rotates the sampled tangent-space normal
    Vec3 albedo{0.72f, 0.55f, 0.45f};
};

struct VertexOut {
    Vec3 worldPos;
    Vec3 worldNrm;
    Vec2 uv;
    float tan4[4]; // exported tangent + handedness
    float invW;    // 1/clip-w for perspective-correct interpolation
    float sx, sy, sz; // screen x, y, depth
};

struct Renderer {
    int W, H;
    Camera cam;
    Light light;
    Image img;
    std::vector<float> zbuf;

    Renderer(int w, int h, Camera c) : W(w), H(h), cam(c), img(w, h) {
        cam.build();
        zbuf.assign(size_t(w) * h, 1e30f);
    }

    VertexOut project(const Mesh& m, uint32_t vi) const {
        VertexOut o;
        Vec3 p = m.pos[vi];
        o.worldPos = p;
        o.worldNrm = m.nrm[vi];
        o.uv = m.uv[vi];
        if (m.tan.size() >= (size_t(vi) + 1) * 4)
            for (int k = 0; k < 4; k++) o.tan4[k] = m.tan[vi * 4 + k];
        else
            o.tan4[0] = o.tan4[1] = o.tan4[2] = 0, o.tan4[3] = 1;
        Vec3 d = p - cam.eye;
        float vz = d.dot(cam.fwd);
        float vx = d.dot(cam.right);
        float vy = d.dot(cam.upv);
        if (cam.orthoHalf > 0.0f) {
            o.sx = (vx / cam.orthoHalf * 0.5f + 0.5f) * (W - 1);
            o.sy = (vy / cam.orthoHalf * 0.5f + 0.5f) * (H - 1);
            o.sz = vz;
            o.invW = 1.0f;
        } else {
            float f = 1.0f / std::tan(fovYRad() * 0.5f);
            float cz = vz > 1e-6f ? vz : 1e-6f;
            o.sx = (vx * f / cz * 0.5f + 0.5f) * (W - 1);
            o.sy = (vy * f / cz * 0.5f + 0.5f) * (H - 1);
            o.sz = vz;
            o.invW = 1.0f / cz;
        }
        return o;
    }

    float fovYRad() const { return cam.fovYDeg * 3.14159265358979f / 180.0f; }

    void render(const Mesh& m, const NormalMap& nm, const RenderOptions& opt);

private:
    Vec3 shade(const Vec3& wp, const Vec3& N, const Vec2& uv, const float* tan4,
               const Vec3& triT, const Vec3& triB, bool triOk,
               const NormalMap& nm, const RenderOptions& opt) const;
};
