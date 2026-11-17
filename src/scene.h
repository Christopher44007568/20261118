#pragma once
#include <cmath>
#include <cstdint>

// ---------------------------------------------------------------------------
// Scene: an opaque backdrop (gradient wall + checker floor + a red sphere)
// and three transparent surfaces at different depths:
//   glass pane (near), smoke puff (mid), colored water sheet (far).
// Camera sits at the origin looking down +Z. Image plane: z = 1.
// ---------------------------------------------------------------------------

struct Vec3 {
    float x, y, z;
};

struct Frag {
    float r, g, b; // premultiplied color for transparent, straight for opaque
    float a;
    float depth;   // view-space z
};

inline float hashNoise(float x, float y) {
    float s = std::sin(x * 12.9898f + y * 78.233f) * 43758.5453f;
    return s - std::floor(s);
}

// Smooth 2D value noise for the smoke alpha map.
inline float noise2(float x, float y) {
    float xi = std::floor(x), yi = std::floor(y);
    float xf = x - xi, yf = y - yi;
    float u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    float a = hashNoise(xi, yi), b = hashNoise(xi + 1, yi);
    float c = hashNoise(xi, yi + 1), d = hashNoise(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Opaque background wall (far plane z = 12), soft vertical gradient.
inline Frag shadeWall(float, float v, float z) {
    float t = 0.5f + 0.5f * v;
    Frag f{0.55f + 0.25f * t, 0.58f + 0.22f * t, 0.70f + 0.15f * t, 1.0f, z};
    return f;
}

// Opaque checker floor strip (bottom of the frame), z varies with v.
inline Frag shadeFloor(float u, float v, float z) {
    int cx = (int)std::floor(u * 8.0f), cy = (int)std::floor(v * 4.0f);
    float c = ((cx + cy) & 1) ? 0.75f : 0.45f;
    Frag f{c, c * 0.95f, c * 0.85f, 1.0f, z};
    return f;
}

// Opaque red sphere, Lambert shaded. uv in [-1,1] over the bounding disc.
inline Frag shadeSphere(float u, float v, float z) {
    float nz = std::sqrt(std::max(0.0f, 1.0f - u * u - v * v));
    float lx = -0.5f, ly = 0.7f, lz = 0.5f;
    float diff = std::max(0.0f, u * lx + v * ly + nz * lz);
    float k = 0.25f + 0.75f * diff;
    Frag f{0.85f * k, 0.20f * k, 0.15f * k, 1.0f, z};
    return f;
}

// --- Transparent surfaces (return premultiplied color + alpha) --------------

// Glass pane, near (z ~ 2.2): faint blue tint with diagonal highlight streaks.
inline Frag shadeGlass(float u, float v, float z) {
    float streak = std::pow(0.5f + 0.5f * std::sin((u + v) * 9.0f), 8.0f);
    float alpha = 0.22f + 0.25f * streak;
    float r = 0.75f, g = 0.85f, b = 0.95f;
    Frag f{alpha * r, alpha * g, alpha * b, alpha, z};
    return f;
}

// Smoke puff, mid (z ~ 3.5): grey, soft noisy alpha blobs.
inline Frag shadeSmoke(float u, float v, float z) {
    float d1 = (u + 0.3f) * (u + 0.3f) + (v - 0.1f) * (v - 0.1f);
    float d2 = (u - 0.35f) * (u - 0.35f) + (v + 0.25f) * (v + 0.25f);
    float blob = std::exp(-6.0f * d1) + 0.8f * std::exp(-7.0f * d2);
    float n = noise2(u * 4.0f + 3.0f, v * 4.0f + 7.0f);
    float alpha = std::min(0.85f, blob * (0.35f + 0.55f * n));
    float g = 0.62f + 0.20f * n;
    Frag f{alpha * g, alpha * g, alpha * (g + 0.03f), alpha, z};
    return f;
}

// Colored water sheet, far (z ~ 5.0): cyan-green with wave bands.
inline Frag shadeWater(float u, float v, float z) {
    float wave = 0.5f + 0.5f * std::sin(u * 14.0f + 3.0f * std::sin(v * 6.0f));
    float alpha = 0.45f + 0.20f * wave;
    float r = 0.15f, g = 0.75f + 0.15f * wave, b = 0.65f;
    Frag f{alpha * r, alpha * g, alpha * b, alpha, z};
    return f;
}
