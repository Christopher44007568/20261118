#ifndef MESH_H
#define MESH_H

#include <GLES3/gl3.h>
#include <math.h>
#include <stdlib.h>

// UV sphere. Position and normal are generated on the unit sphere; callers
// apply non-uniform scale through the model matrix to make ellipsoids /
// flattened skin patches (which naturally produce thin rims).
// UV sphere. Position and normal are generated on the unit sphere; callers
// apply non-uniform scale through the model matrix to make ellipsoids /
// flattened skin patches (which naturally produce thin rims).
// Triangles are emitted counter-clockwise (front faces point outward) so the
// default GL_BACK culling keeps the near surface, matching OpenGL conventions.
typedef struct {
    GLuint vao;
    GLuint vbo;
    GLuint ibo;
    int    indexCount;
} Mesh;

static Mesh mesh_create_uv_sphere(int stacks, int slices) {
    int vertexCount = (stacks + 1) * (slices + 1);
    int indexCount = stacks * slices * 6;
    float *verts = malloc(sizeof(float) * 6 * vertexCount);
    unsigned int *indices = malloc(sizeof(unsigned int) * indexCount);

    int vi = 0;
    for (int i = 0; i <= stacks; ++i) {
        float phi = (float)i / (float)stacks * (float)M_PI;
        float y = cosf(phi);
        float ring = sinf(phi);
        for (int j = 0; j <= slices; ++j) {
            float theta = (float)j / (float)slices * 2.0f * (float)M_PI;
            float x = ring * cosf(theta);
            float z = ring * sinf(theta);
            verts[vi++] = x; verts[vi++] = y; verts[vi++] = z;
            verts[vi++] = x; verts[vi++] = y; verts[vi++] = z;
        }
    }

    int ii = 0;
    for (int i = 0; i < stacks; ++i) {
        for (int j = 0; j < slices; ++j) {
            unsigned int a = i * (slices + 1) + j;
            unsigned int b = (i + 1) * (slices + 1) + j;
            unsigned int c = (i + 1) * (slices + 1) + j + 1;
            unsigned int d = i * (slices + 1) + j + 1;
            indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
            indices[ii++] = b; indices[ii++] = d; indices[ii++] = c;
        }
    }

    Mesh mesh;
    mesh.indexCount = indexCount;
    glGenVertexArrays(1, &mesh.vao);
    glBindVertexArray(mesh.vao);
    glGenBuffers(1, &mesh.vbo);
    glBindBuffer(GL_ARRAY_BUFFER, mesh.vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(float) * 6 * vertexCount,
                 verts, GL_STATIC_DRAW);
    glGenBuffers(1, &mesh.ibo);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, mesh.ibo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER,
                 sizeof(unsigned int) * indexCount, indices, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 6 * sizeof(float),
                          (void *)0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 6 * sizeof(float),
                          (void *)(3 * sizeof(float)));
    glBindVertexArray(0);
    free(verts);
    free(indices);
    return mesh;
}

#endif
