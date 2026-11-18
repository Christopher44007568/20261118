#include "render.h"

Vec3 Renderer::shade(const Vec3& wp, const Vec3& N, const Vec2& uv,
                     const float* tan4, const Vec3& triT, const Vec3& triB,
                     bool triOk, const NormalMap& nm,
                     const RenderOptions& opt) const {
    Vec3 n_ts = nm.sample(uv.x, uv.y);
    if (opt.normalRotation != 0.0f)
        n_ts = rotateTangentNormal(n_ts, opt.normalRotation);

    Vec3 T, B;
    Vec3 Nn = safeNormalize(N, {0, 0, 1});
    Vec3 worldN;
    switch (opt.mode) {
    case ShadingMode::NoTangent:
        // Wrong-on-purpose baseline: tangent-space normal used as world normal.
        worldN = safeNormalize(n_ts, Nn);
        T = {1, 0, 0};
        B = {0, 1, 0};
        break;
    case ShadingMode::Exported: {
        Vec3 t{tan4[0], tan4[1], tan4[2]};
        float h = tan4[3];
        T = safeNormalize(t - Nn * Nn.dot(t), {1, 0, 0});
        B = Nn.cross(T) * h;
        worldN = safeNormalize(T * n_ts.x + B * n_ts.y + Nn * n_ts.z, Nn);
        break;
    }
    case ShadingMode::Reconstructed:
    case ShadingMode::NaiveNoHandedness: {
        if (triOk) {
            T = safeNormalize(triT - Nn * Nn.dot(triT), {1, 0, 0});
            // Handedness from the bitangent gradient (winding-independent);
            // mirrored UVs get B flipped so lighting is not inverted.
            float h = tangentHandedness(Nn, T, triB);
            if (opt.mode == ShadingMode::NaiveNoHandedness) h = 1.0f;
            B = Nn.cross(T) * h;
        } else {
            // Degenerate UV: fall back to any consistent frame. No NaN.
            orthonormalBasis(Nn, T, B);
        }
        worldN = safeNormalize(T * n_ts.x + B * n_ts.y + Nn * n_ts.z, Nn);
        break;
    }
    }

    switch (opt.viz) {
    case VizMode::Tangent:   return T * 0.5f + Vec3{0.5f, 0.5f, 0.5f};
    case VizMode::Bitangent: return B * 0.5f + Vec3{0.5f, 0.5f, 0.5f};
    case VizMode::Normal:    return worldN * 0.5f + Vec3{0.5f, 0.5f, 0.5f};
    default: break;
    }

    Vec3 V = safeNormalize(cam.eye - wp, {0, 0, 1});
    Vec3 L = light.dir * -1.0f;
    float ndl = std::max(0.0f, worldN.dot(L));
    Vec3 H = safeNormalize(L + V, {0, 0, 1});
    float spec = std::pow(std::max(0.0f, worldN.dot(H)), light.shininess);
    if (opt.viz == VizMode::Specular)
        return Vec3{spec, spec, spec} * light.specStrength;
    Vec3 c = opt.albedo * (light.ambient + ndl) + light.color * (spec * light.specStrength);
    return c;
}

void Renderer::render(const Mesh& m, const NormalMap& nm, const RenderOptions& opt) {
    std::vector<VertexOut> vo(m.pos.size());
    for (size_t i = 0; i < m.pos.size(); i++) vo[i] = project(m, (uint32_t)i);

    for (size_t t = 0; t + 2 < m.idx.size(); t += 3) {
        const VertexOut& v0 = vo[m.idx[t]];
        const VertexOut& v1 = vo[m.idx[t + 1]];
        const VertexOut& v2 = vo[m.idx[t + 2]];

        // Per-triangle reconstructed tangent frame (position/UV gradients).
        Vec3 triT, triB;
        bool triOk = triangleTangentFrame(v0.worldPos, v1.worldPos, v2.worldPos,
                                          v0.uv, v1.uv, v2.uv, triT, triB);
        // Near-zero gradient (e.g. collapsed UV or pole triangles): degenerate.
        if (triT.length() < 1e-8f || !std::isfinite(triT.x + triT.y + triT.z))
            triOk = false;

        float x0 = std::min({v0.sx, v1.sx, v2.sx}), x1 = std::max({v0.sx, v1.sx, v2.sx});
        float y0 = std::min({v0.sy, v1.sy, v2.sy}), y1 = std::max({v0.sy, v1.sy, v2.sy});
        int ix0 = std::max(0, (int)std::floor(x0)), ix1 = std::min(W - 1, (int)std::ceil(x1));
        int iy0 = std::max(0, (int)std::floor(y0)), iy1 = std::min(H - 1, (int)std::ceil(y1));

        float d = (v1.sx - v0.sx) * (v2.sy - v0.sy) - (v2.sx - v0.sx) * (v1.sy - v0.sy);
        if (std::fabs(d) < 1e-9f) continue;

        for (int y = iy0; y <= iy1; y++)
            for (int x = ix0; x <= ix1; x++) {
                float px = x + 0.5f, py = y + 0.5f;
                float w0 = ((v1.sx - px) * (v2.sy - py) - (v2.sx - px) * (v1.sy - py)) / d;
                float w1 = ((v2.sx - px) * (v0.sy - py) - (v0.sx - px) * (v2.sy - py)) / d;
                float w2 = 1.0f - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;

                // Perspective-correct interpolation.
                float a0 = w0 * v0.invW, a1 = w1 * v1.invW, a2 = w2 * v2.invW;
                float asum = a0 + a1 + a2;
                if (asum < 1e-12f) continue;
                a0 /= asum; a1 /= asum; a2 /= asum;

                float z = a0 * v0.sz + a1 * v1.sz + a2 * v2.sz;
                size_t zi = size_t(y) * W + x;
                if (z >= zbuf[zi]) continue;
                zbuf[zi] = z;

                Vec3 wp = v0.worldPos * a0 + v1.worldPos * a1 + v2.worldPos * a2;
                Vec3 N = v0.worldNrm * a0 + v1.worldNrm * a1 + v2.worldNrm * a2;
                Vec2 uv{v0.uv.x * a0 + v1.uv.x * a1 + v2.uv.x * a2,
                        v0.uv.y * a0 + v1.uv.y * a1 + v2.uv.y * a2};
                float tan4[4];
                for (int k = 0; k < 4; k++)
                    tan4[k] = v0.tan4[k] * a0 + v1.tan4[k] * a1 + v2.tan4[k] * a2;

                img.at(x, y) = shade(wp, N, uv, tan4, triT, triB, triOk, nm, opt);
            }
    }
}
