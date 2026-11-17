#pragma once
#include "math_util.h"
#include <vector>

struct GroundMesh {
    unsigned int vao = 0, vbo = 0;
    int vertex_count = 0;
};

// Smooth, deterministic height field: layered sines + value noise.
float terrain_height(float x, float z);
Vec3 terrain_normal(float x, float z);

// Build a tessellated ground quad covering [half] in x/z centered at origin.
GroundMesh build_ground_mesh(int grid_segments, float half_extent);
