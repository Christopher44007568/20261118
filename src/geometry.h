#pragma once

struct BaseMesh {
    unsigned int vao = 0, vbo = 0;
    int vertex_count = 0;
};

// Two crossed, tapered quads (a few verts), height axis 0..1.
BaseMesh build_grass_blade_mesh();

// Low-poly bush: trunk + jittered icosphere-like foliage blob, height 0..1.
BaseMesh build_bush_mesh();
