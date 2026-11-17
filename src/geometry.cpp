#include "geometry.h"
#include "math_util.h"
#include "gl_loader.h"
#include <GL/gl.h>
#include <vector>
#include <cmath>

namespace {
struct V { float x, y, z; float nx, ny, nz; };

BaseMesh upload(const std::vector<V>& verts) {
    BaseMesh m;
    m.vertex_count = (int)verts.size();
    gl_loader::GenVertexArrays(1, &m.vao);
    gl_loader::GenBuffers(1, &m.vbo);
    gl_loader::BindVertexArray(m.vao);
    gl_loader::BindBuffer(GL_ARRAY_BUFFER, m.vbo);
    gl_loader::BufferData(GL_ARRAY_BUFFER,
                          (GLsizeiptr)(verts.size() * sizeof(V)),
                          verts.data(), GL_STATIC_DRAW);
    gl_loader::EnableVertexAttribArray(0);
    gl_loader::VertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(V),
                                   (void*)0);
    gl_loader::EnableVertexAttribArray(1);
    gl_loader::VertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(V),
                                   (void*)(3 * sizeof(float)));
    gl_loader::BindVertexArray(0);
    return m;
}

// One tapered blade quad from y=0 to y=1, rotated by yaw about Y.
void blade_quad(std::vector<V>& out, float yaw, float half_width) {
    float c = std::cos(yaw), s = std::sin(yaw);
    auto rot = [&](float lx, float lz) {
        return Vec3{c * lx - s * lz, 0.0f, s * lx + c * lz};
    };
    // 4 levels: width tapers to 0 at the tip.
    const int levels = 4;
    Vec3 p[levels][2];
    Vec3 n = norm3(rot(0.0f, 1.0f));
    for (int i = 0; i < levels; ++i) {
        float y = (float)i / (levels - 1);
        float w = half_width * (1.0f - y) * (1.0f - 0.15f * y);
        p[i][0] = rot(-w, 0.0f); p[i][0].y = y;
        p[i][1] = rot(+w, 0.0f); p[i][1].y = y;
    }
    auto push = [&](const Vec3& q) {
        out.push_back({q.x, q.y, q.z, n.x, n.y, n.z});
    };
    for (int i = 0; i < levels - 1; ++i) {
        push(p[i][0]); push(p[i+1][0]); push(p[i+1][1]);
        push(p[i][0]); push(p[i+1][1]); push(p[i][1]);
    }
}
}

BaseMesh build_grass_blade_mesh() {
    std::vector<V> verts;
    blade_quad(verts, 0.0f, 0.06f);
    blade_quad(verts, 1.5707963f, 0.06f); // crossed second blade
    return upload(verts);
}

BaseMesh build_bush_mesh() {
    // Foliage: subdivided icosahedron centered near the top, plus a short
    // trunk quad. Vertices jittered deterministically for an organic look.
    std::vector<V> verts;
    const float t = (1.0f + std::sqrt(5.0f)) / 2.0f;
    Vec3 ico[12] = {
        {-1, t, 0}, {1, t, 0}, {-1,-t, 0}, {1,-t, 0},
        {0,-1, t}, {0, 1, t}, {0,-1,-t}, {0, 1,-t},
        {t, 0,-1}, {t, 0, 1}, {-t, 0,-1}, {-t, 0, 1}
    };
    int faces[20][3] = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    uint32_t seed = 12345;
    auto emit = [&](Vec3 q) {
        Vec3 nrm = norm3(q);
        float jitter = 1.0f + (rand01(seed) - 0.5f) * 0.22f;
        // Sphere radius 0.35 centered at y=0.78 -> occupies roughly 0.5..1.0.
        Vec3 w{nrm.x * 0.35f * jitter,
               0.78f + nrm.y * 0.30f * jitter,
               nrm.z * 0.35f * jitter};
        verts.push_back({w.x, w.y, w.z, nrm.x, nrm.y, nrm.z});
    };
    for (auto& f : faces) {
        Vec3 a = norm3(ico[f[0]]), b = norm3(ico[f[1]]), c = norm3(ico[f[2]]);
        // One level of midpoint subdivision.
        Vec3 ab = norm3(a * 0.5f + b * 0.5f);
        Vec3 bc = norm3(b * 0.5f + c * 0.5f);
        Vec3 ca = norm3(c * 0.5f + a * 0.5f);
        Vec3 tris[4][3] = {{a,ab,ca},{ab,b,bc},{ca,bc,c},{ab,bc,ca}};
        for (auto& tr : tris) { emit(tr[0]); emit(tr[1]); emit(tr[2]); }
    }
    // Simple trunk quad at the base.
    auto tpush = [&](float x, float y, float z) {
        verts.push_back({x, y, z, 0, 1, 0});
    };
    tpush(-0.05f, 0, 0); tpush(-0.05f, 0.55f, 0); tpush(0.05f, 0.55f, 0);
    tpush(-0.05f, 0, 0); tpush(0.05f, 0.55f, 0); tpush(0.05f, 0, 0);
    return upload(verts);
}
