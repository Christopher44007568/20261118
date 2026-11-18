#pragma once
#include <cstdint>
#include <vector>
#include "linalg.h"

struct Mesh {
    std::vector<Vec3> pos;
    std::vector<Vec3> nrm;
    std::vector<Vec2> uv;
    // Exported tangents: xyz = tangent, w = handedness (+1/-1) for B = w*cross(N,T).
    std::vector<float> tan; // 4 floats per vertex, empty until computeTangents()
    std::vector<uint32_t> idx;
};

// Per-triangle tangent frame from position/UV gradients (Lengyel's method).
// Returns false when the UV triangle is degenerate (zero area in UV space).
// Handedness is NOT taken from the UV determinant sign alone: that flips
// with triangle winding. Callers derive it from sign(cross(N,T) . B), which
// is winding-independent and still flips on truly mirrored UVs.
inline bool triangleTangentFrame(const Vec3& p0, const Vec3& p1, const Vec3& p2,
                                 const Vec2& uv0, const Vec2& uv1, const Vec2& uv2,
                                 Vec3& T, Vec3& B) {
    Vec3 e1 = p1 - p0, e2 = p2 - p0;
    Vec2 d1 = uv1 - uv0, d2 = uv2 - uv0;
    float det = d1.x * d2.y - d2.x * d1.y;
    // Guard: degenerate UV (mirrored-to-a-line, collapsed, or unmapped).
    if (std::fabs(det) < 1e-12f || !std::isfinite(det)) return false;
    float r = 1.0f / det;
    T = e1 * d2.y * r - e2 * d1.y * r;
    B = e2 * d1.x * r - e1 * d2.x * r;
    return true;
}

// Winding-independent handedness: negative exactly when the UV parameter-
// ization is mirrored relative to the geometric normal.
inline float tangentHandedness(const Vec3& N, const Vec3& T, const Vec3& B) {
    return N.cross(T).dot(B) < 0.0f ? -1.0f : 1.0f;
}

// Accumulate per-vertex "exported" tangents (like a DCC exporter would).
// Vertices touched only by degenerate UV triangles get a fallback basis
// derived from the normal, so no NaN ever propagates.
inline void computeTangents(Mesh& m) {
    size_t n = m.pos.size();
    std::vector<Vec3> accT(n, {0, 0, 0}), accB(n, {0, 0, 0});
    for (size_t i = 0; i + 2 < m.idx.size(); i += 3) {
        uint32_t a = m.idx[i], b = m.idx[i + 1], c = m.idx[i + 2];
        Vec3 T, B;
        if (!triangleTangentFrame(m.pos[a], m.pos[b], m.pos[c],
                                  m.uv[a], m.uv[b], m.uv[c], T, B))
            continue; // degenerate UV: contributes nothing
        accT[a] += T; accT[b] += T; accT[c] += T;
        accB[a] += B; accB[b] += B; accB[c] += B;
    }
    m.tan.assign(n * 4, 0.0f);
    for (size_t v = 0; v < n; v++) {
        Vec3 N = m.nrm[v];
        Vec3 T = accT[v];
        Vec3 B = accB[v];
        float h = 1.0f;
        if (T.length() < 1e-8f) {
            // Degenerate UV fallback: any consistent orthonormal frame.
            orthonormalBasis(N, T, B);
        } else {
            // Gram-Schmidt orthogonalize against the normal.
            T = safeNormalize(T - N * N.dot(T), T);
            // Mirrored UV islands keep w = -1 via the triple product.
            if (B.length() > 1e-8f)
                h = tangentHandedness(N, T, B);
        }
        m.tan[v * 4 + 0] = T.x;
        m.tan[v * 4 + 1] = T.y;
        m.tan[v * 4 + 2] = T.z;
        m.tan[v * 4 + 3] = h;
    }
}
