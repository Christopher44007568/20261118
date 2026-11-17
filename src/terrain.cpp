#include "terrain.h"
#include "gl_loader.h"
#include <GL/gl.h>
#include <cmath>

namespace {
float value_noise(float x, float z) {
    int xi = (int)std::floor(x);
    int zi = (int)std::floor(z);
    float fx = x - xi;
    float fz = z - zi;
    auto h = [](int ix, int iz) {
        uint32_t s = hash_u32((uint32_t)(ix * 73856093) ^
                              (uint32_t)(iz * 19349663));
        return (s >> 8) * (1.0f / 16777216.0f);
    };
    float sx = fx*fx*(3.0f - 2.0f*fx);
    float sz = fz*fz*(3.0f - 2.0f*fz);
    float a = h(xi, zi), b = h(xi+1, zi);
    float c = h(xi, zi+1), d = h(xi+1, zi+1);
    return a*(1-sx)*(1-sz) + b*sx*(1-sz) + c*(1-sx)*sz + d*sx*sz;
}
}

float terrain_height(float x, float z) {
    float h = 0.0f;
    h += 2.2f * std::sin(x * 0.045f) * std::cos(z * 0.05f);
    h += 1.1f * std::sin(x * 0.12f + 1.7f) * std::sin(z * 0.1f);
    h += (value_noise(x * 0.08f, z * 0.08f) - 0.5f) * 2.4f;
    h += (value_noise(x * 0.25f, z * 0.25f) - 0.5f) * 0.6f;
    return h;
}

Vec3 terrain_normal(float x, float z) {
    const float e = 0.35f;
    float hL = terrain_height(x - e, z);
    float hR = terrain_height(x + e, z);
    float hD = terrain_height(x, z - e);
    float hU = terrain_height(x, z + e);
    return norm3(Vec3{hL - hR, 2.0f * e, hD - hU});
}

GroundMesh build_ground_mesh(int grid_segments, float half_extent) {
    struct V { float x, y, z; float r, g, b; };
    std::vector<V> verts;
    verts.reserve((size_t)grid_segments * grid_segments * 6);
    auto add = [&](int i, int j) {
        float x = -half_extent + (2.0f * half_extent) * i / grid_segments;
        float z = -half_extent + (2.0f * half_extent) * j / grid_segments;
        float y = terrain_height(x, z);
        // Two-tone ground tint so silhouette/coverage analysis has contrast.
        float tint = 0.5f + 0.5f * std::sin(x * 0.02f) * std::cos(z * 0.03f);
        verts.push_back({x, y, z, 0.16f + 0.05f*tint,
                         0.28f + 0.08f*tint, 0.10f});
    };
    for (int j = 0; j < grid_segments; ++j) {
        for (int i = 0; i < grid_segments; ++i) {
            add(i, j); add(i+1, j); add(i+1, j+1);
            add(i, j); add(i+1, j+1); add(i, j+1);
        }
    }
    GroundMesh gm;
    gm.vertex_count = (int)verts.size();
    gl_loader::GenVertexArrays(1, &gm.vao);
    gl_loader::GenBuffers(1, &gm.vbo);
    gl_loader::BindVertexArray(gm.vao);
    gl_loader::BindBuffer(GL_ARRAY_BUFFER, gm.vbo);
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
    return gm;
}
