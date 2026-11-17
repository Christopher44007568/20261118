#include "shared.h"

#include <array>
#include <cmath>

namespace {

struct Mat4 {
    float m[16]; // column-major, matching Vulkan
};

Mat4 perspective(float fovYRad, float aspect, float zNear, float zFar) {
    Mat4 r{};
    const float f = 1.0f / std::tan(fovYRad * 0.5f);
    r.m[0] = f / aspect;
    r.m[5] = f;
    r.m[10] = zFar / (zNear - zFar);
    r.m[11] = -1.0f;
    r.m[14] = (zNear * zFar) / (zNear - zFar);
    return r;
}

Mat4 lookAt(const float eye[3], const float target[3], const float up[3]) {
    auto sub = [](const float a[3], const float b[3], float out[3]) {
        out[0] = a[0] - b[0];
        out[1] = a[1] - b[1];
        out[2] = a[2] - b[2];
    };
    auto cross = [](const float a[3], const float b[3]) {
        float r[3];
        r[0] = a[1] * b[2] - a[2] * b[1];
        r[1] = a[2] * b[0] - a[0] * b[2];
        r[2] = a[0] * b[1] - a[1] * b[0];
        return std::array<float, 3>{r[0], r[1], r[2]};
    };
    auto norm = [](float v[3]) {
        const float len = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        v[0] /= len;
        v[1] /= len;
        v[2] /= len;
    };

    float f[3];
    sub(eye, target, f);
    norm(f);
    float u[3] = {up[0], up[1], up[2]};
    norm(u);
    auto s = cross(u, f);
    auto uu = cross(f, s.data());

    Mat4 r{};
    r.m[0] = s[0];
    r.m[4] = s[1];
    r.m[8] = s[2];
    r.m[1] = uu[0];
    r.m[5] = uu[1];
    r.m[9] = uu[2];
    r.m[2] = f[0];
    r.m[6] = f[1];
    r.m[10] = f[2];
    r.m[12] = -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]);
    r.m[13] = -(uu[0] * eye[0] + uu[1] * eye[1] + uu[2] * eye[2]);
    r.m[14] = -(f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]);
    r.m[15] = 1.0f;
    return r;
}

Mat4 multiply(const Mat4& a, const Mat4& b) {
    Mat4 r{};
    for (int col = 0; col < 4; ++col) {
        for (int row = 0; row < 4; ++row) {
            float sum = 0.0f;
            for (int k = 0; k < 4; ++k) {
                sum += a.m[k * 4 + row] * b.m[col * 4 + k];
            }
            r.m[col * 4 + row] = sum;
        }
    }
    return r;
}

} // namespace

CpuVisibility cullOnCpu(const std::vector<InstanceData>& instances,
                        const CameraState& camera) {
    const Mat4 view = lookAt(camera.eye, camera.target, camera.up);
    const Mat4 proj = perspective(camera.fovYRad, camera.aspect,
                                  camera.zNear, camera.zFar);
    const Mat4 vp = multiply(proj, view);

    // Gribb-Hartmann extraction from a column-major view-projection matrix.
    // Plane order: left, right, top, bottom, near, far.
    float planes[6][4];
    auto row = [&](int r, int c) { return vp.m[c * 4 + r]; };
    for (int c = 0; c < 4; ++c) {
        planes[0][c] = row(3, c) + row(0, c); // left
        planes[1][c] = row(3, c) - row(0, c); // right
        planes[2][c] = row(3, c) + row(1, c); // top
        planes[3][c] = row(3, c) - row(1, c); // bottom
        planes[4][c] = row(3, c) + row(2, c); // near
        planes[5][c] = row(3, c) - row(2, c); // far
    }
    for (auto& plane : planes) {
        const float len = std::sqrt(plane[0] * plane[0] +
                                    plane[1] * plane[1] +
                                    plane[2] * plane[2]);
        for (float& v : plane) {
            v /= len;
        }
    }

    CpuVisibility result;
    result.visibleIndices.reserve(instances.size());
    for (uint32_t i = 0; i < instances.size(); ++i) {
        const float* c = instances[i].center;
        const float radius = c[3];
        bool visible = true;
        for (const auto& plane : planes) {
            const float d = plane[0] * c[0] + plane[1] * c[1] +
                            plane[2] * c[2] + plane[3];
            if (d < -radius) {
                visible = false;
                break;
            }
        }
        if (visible) {
            result.visibleIndices.push_back(i);
        }
    }
    return result;
}
