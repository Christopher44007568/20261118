#pragma once
#include "mesh.h"

// Grid plane in the XY plane, normal +Z, size 2x2 centered at origin.
// If mirrorRightHalf, vertices with x > 0 sample a U-mirrored UV island
// (seam vertices are duplicated so exported tangents stay clean).
inline Mesh makePlane(int grid = 32, bool mirrorRightHalf = false) {
    Mesh m;
    int n = grid + 1;
    auto uvFor = [&](float x, float y) -> Vec2 {
        float u = (x + 1.0f) * 0.5f;
        float v = (y + 1.0f) * 0.5f;
        if (mirrorRightHalf && x > 0.0f) u = 1.0f - u; // mirrored island
        return {u, v};
    };
    if (!mirrorRightHalf) {
        for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++) {
                float x = 2.0f * i / grid - 1.0f;
                float y = 2.0f * j / grid - 1.0f;
                m.pos.push_back({x, y, 0});
                m.nrm.push_back({0, 0, 1});
                m.uv.push_back(uvFor(x, y));
            }
        for (int j = 0; j < grid; j++)
            for (int i = 0; i < grid; i++) {
                uint32_t a = j * n + i, b = a + 1, c = a + n, d = c + 1;
                m.idx.insert(m.idx.end(), {a, b, c, b, d, c});
            }
        return m;
    }
    // Mirrored variant: the x == 0 seam column is duplicated so each UV
    // island gets its own vertices (standard tangent-space seam practice).
    int half = grid / 2;
    auto addVertex = [&](float x, float y, bool mirrored) -> uint32_t {
        float u = (x + 1.0f) * 0.5f;
        if (mirrored) u = 1.0f - u;
        m.pos.push_back({x, y, 0});
        m.nrm.push_back({0, 0, 1});
        m.uv.push_back({u, (y + 1.0f) * 0.5f});
        return (uint32_t)m.pos.size() - 1;
    };
    // col[i][j]: vertex id at grid column i, row j. Column `half` exists
    // twice: colL[half] (unmirrored island) and colR[0] (mirrored island).
    std::vector<std::vector<uint32_t>> colL(half + 1), colR(grid - half + 1);
    for (int i = 0; i <= half; i++)
        for (int j = 0; j < n; j++)
            colL[i].push_back(addVertex(2.0f * i / grid - 1.0f,
                                        2.0f * j / grid - 1.0f, false));
    for (int i = half; i <= grid; i++)
        for (int j = 0; j < n; j++)
            colR[i - half].push_back(addVertex(2.0f * i / grid - 1.0f,
                                               2.0f * j / grid - 1.0f, true));
    auto quad = [&](uint32_t a, uint32_t b, uint32_t c, uint32_t d) {
        m.idx.insert(m.idx.end(), {a, b, c, b, d, c});
    };
    for (int j = 0; j < grid; j++) {
        for (int i = 0; i < half; i++)
            quad(colL[i][j], colL[i + 1][j], colL[i][j + 1], colL[i + 1][j + 1]);
        for (int i = 0; i < grid - half; i++)
            quad(colR[i][j], colR[i + 1][j], colR[i][j + 1], colR[i + 1][j + 1]);
    }
    return m;
}

// UV sphere, radius 1, centered at origin. Poles have collapsed position
// edges and near-degenerate UV gradients: a real-world robustness case.
inline Mesh makeSphere(int slices = 48, int stacks = 32) {
    Mesh m;
    for (int j = 0; j <= stacks; j++) {
        float v = (float)j / stacks;
        float phi = 3.14159265358979f * v; // 0..pi, top to bottom
        float sp = std::sin(phi), cp = std::cos(phi);
        for (int i = 0; i <= slices; i++) {
            float u = (float)i / slices;
            float theta = 2.0f * 3.14159265358979f * u;
            Vec3 p = {sp * std::cos(theta), cp, sp * std::sin(theta)};
            m.pos.push_back(p);
            m.nrm.push_back(p);
            m.uv.push_back({u, v});
        }
    }
    int n = slices + 1;
    for (int j = 0; j < stacks; j++)
        for (int i = 0; i < slices; i++) {
            uint32_t a = j * n + i, b = a + 1, c = a + n, d = c + 1;
            m.idx.insert(m.idx.end(), {a, b, c, b, d, c});
        }
    return m;
}

// Plane where a band of triangles has fully degenerate UVs (all three
// vertices share one UV coordinate), like a broken asset export.
inline Mesh makeDegeneratePlane(int grid = 32) {
    Mesh m = makePlane(grid, false);
    int n = grid + 1;
    for (int j = 0; j < n; j++)
        for (int i = 0; i < n; i++) {
            float x = 2.0f * i / grid - 1.0f;
            if (x > -0.25f && x < 0.25f)
                m.uv[j * n + i] = {0.5f, 0.5f}; // collapse UVs to a point
        }
    return m;
}
