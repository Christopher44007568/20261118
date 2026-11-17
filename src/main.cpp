#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "png.h"
#include "renderer.h"

// ---------------------------------------------------------------------------
// OIT demo: renders one scene with three transparent surfaces (glass, smoke,
// colored water) in different submission orders through two pipelines and
// compares the final pixels.
// ---------------------------------------------------------------------------

static const int W = 512, H = 384;

struct Scene {
    Quad wall, floor, glass, smoke, water;
    Vec3 sphereC{0.55f, 0.15f, 2.6f};
    float sphereR = 0.55f;
};

static Scene makeScene() {
    Scene s;
    s.wall = {{{-10, -7, 12}, {10, -7, 12}, {10, 7, 12}, {-10, 7, 12}}, shadeWall};
    s.floor = {{{-6, -1.05f, 12}, {6, -1.05f, 12}, {6, -1.05f, 2.0f}, {-6, -1.05f, 2.0f}}, shadeFloor};
    s.glass = {{{-1.5f, -0.9f, 2.2f}, {0.9f, -0.9f, 2.2f}, {0.9f, 0.9f, 2.2f}, {-1.5f, 0.9f, 2.2f}}, shadeGlass};
    s.smoke = {{{-1.1f, -0.8f, 3.5f}, {1.3f, -0.8f, 3.5f}, {1.3f, 0.8f, 3.5f}, {-1.1f, 0.8f, 3.5f}}, shadeSmoke};
    s.water = {{{-1.6f, -0.7f, 5.0f}, {1.6f, -0.7f, 5.0f}, {1.6f, 0.7f, 5.0f}, {-1.6f, 0.7f, 5.0f}}, shadeWater};
    return s;
}

static void renderOpaque(Framebuffer& fb, const Camera& cam, const Scene& s) {
    drawOpaque(fb, cam, s.wall);
    drawOpaque(fb, cam, s.floor);
    drawOpaqueSphere(fb, cam, s.sphereC, s.sphereR, shadeSphere);
}

static Framebuffer renderNaive(const Camera& cam, const Scene& s,
                               const std::vector<const Quad*>& order) {
    Framebuffer fb(W, H);
    renderOpaque(fb, cam, s);
    for (const Quad* q : order) blendNaive(fb, cam, *q);
    return fb;
}

static Framebuffer renderOit(const Camera& cam, const Scene& s,
                             const std::vector<const Quad*>& order) {
    Framebuffer fb(W, H);
    renderOpaque(fb, cam, s);
    OitBuffers buf(W, H);
    for (const Quad* q : order) accumulateOit(buf, fb, cam, *q);
    resolveOit(fb, buf);
    return fb;
}

static std::vector<uint8_t> toRgb8(const Framebuffer& fb) {
    std::vector<uint8_t> rgb((size_t)fb.w * fb.h * 3);
    for (size_t i = 0; i < rgb.size(); ++i) {
        float c = fb.color[i] < 0 ? 0 : (fb.color[i] > 1 ? 1 : fb.color[i]);
        rgb[i] = (uint8_t)(c * 255.0f + 0.5f);
    }
    return rgb;
}

struct DiffStats {
    double meanAbs;   // mean |diff| in 0..255 units
    int maxAbs;       // max  |diff| in 0..255 units
    double pctAbove2; // % of channel samples with |diff| > 2
};

static DiffStats diffImages(const std::vector<uint8_t>& a, const std::vector<uint8_t>& b) {
    DiffStats s{0, 0, 0};
    long long above = 0;
    for (size_t i = 0; i < a.size(); ++i) {
        int d = std::abs((int)a[i] - (int)b[i]);
        s.meanAbs += d;
        s.maxAbs = std::max(s.maxAbs, d);
        if (d > 2) ++above;
    }
    s.meanAbs /= (double)a.size();
    s.pctAbove2 = 100.0 * above / (double)a.size();
    return s;
}

// Amplified absolute-difference visualization (x16, clamped).
static std::vector<uint8_t> diffVisual(const std::vector<uint8_t>& a,
                                       const std::vector<uint8_t>& b) {
    std::vector<uint8_t> out(a.size());
    for (size_t i = 0; i < a.size(); ++i)
        out[i] = (uint8_t)std::min(255, 16 * std::abs((int)a[i] - (int)b[i]));
    return out;
}

int main() {
    Camera cam(W, H);
    Scene s = makeScene();
    const std::string dir = "artifacts/";

    // Three submission orders of the same transparent surfaces.
    std::vector<const Quad*> orderA{&s.glass, &s.smoke, &s.water}; // near -> far
    std::vector<const Quad*> orderB{&s.water, &s.smoke, &s.glass}; // far -> near
    std::vector<const Quad*> orderC{&s.smoke, &s.water, &s.glass}; // shuffled

    Framebuffer naiveA = renderNaive(cam, s, orderA);
    Framebuffer naiveB = renderNaive(cam, s, orderB);
    Framebuffer oitA = renderOit(cam, s, orderA);
    Framebuffer oitB = renderOit(cam, s, orderB);
    Framebuffer oitC = renderOit(cam, s, orderC);

    std::vector<uint8_t> nA = toRgb8(naiveA), nB = toRgb8(naiveB);
    std::vector<uint8_t> oA = toRgb8(oitA), oB = toRgb8(oitB), oC = toRgb8(oitC);

    png::save(dir + "naive_order_A.png", W, H, nA);
    png::save(dir + "naive_order_B.png", W, H, nB);
    png::save(dir + "naive_diff_AB_x16.png", W, H, diffVisual(nA, nB));
    png::save(dir + "oit_order_A.png", W, H, oA);
    png::save(dir + "oit_order_B.png", W, H, oB);
    png::save(dir + "oit_order_C.png", W, H, oC);
    png::save(dir + "oit_diff_AB_x16.png", W, H, diffVisual(oA, oB));
    png::save(dir + "oit_diff_AC_x16.png", W, H, diffVisual(oA, oC));
    png::save(dir + "oit_diff_BC_x16.png", W, H, diffVisual(oB, oC));

    DiffStats naiveAB = diffImages(nA, nB);
    DiffStats oitAB = diffImages(oA, oB);
    DiffStats oitAC = diffImages(oA, oC);
    DiffStats oitBC = diffImages(oB, oC);

    // Acceptance threshold for order-independence (8-bit channel units).
    const double kMaxMean = 0.05; // mean |diff| must be well below 1 LSB
    const int kMaxAbs = 1;        // no pixel may differ by more than 1 LSB

    FILE* rep = fopen((dir + "report.txt").c_str(), "w");
    auto line = [&](const char* fmt, auto... args) {
        printf(fmt, args...);
        printf("\n");
        if (rep) { fprintf(rep, fmt, args...); fprintf(rep, "\n"); }
    };
    line("=== Transparency order-independence report (%dx%d) ===", W, H);
    line("naive  A vs B : mean=%.4f max=%d px>2=%.2f%%  (expected: LARGE, order-dependent)",
         naiveAB.meanAbs, naiveAB.maxAbs, naiveAB.pctAbove2);
    line("oit    A vs B : mean=%.4f max=%d px>2=%.2f%%", oitAB.meanAbs, oitAB.maxAbs, oitAB.pctAbove2);
    line("oit    A vs C : mean=%.4f max=%d px>2=%.2f%%", oitAC.meanAbs, oitAC.maxAbs, oitAC.pctAbove2);
    line("oit    B vs C : mean=%.4f max=%d px>2=%.2f%%", oitBC.meanAbs, oitBC.maxAbs, oitBC.pctAbove2);

    bool pass = oitAB.meanAbs < kMaxMean && oitAB.maxAbs <= kMaxAbs &&
                oitAC.meanAbs < kMaxMean && oitAC.maxAbs <= kMaxAbs &&
                oitBC.meanAbs < kMaxMean && oitBC.maxAbs <= kMaxAbs;
    line("threshold   : mean < %.2f and max <= %d (8-bit units)", kMaxMean, kMaxAbs);
    line("result      : %s", pass ? "PASS - OIT output is order-independent" : "FAIL");
    if (rep) fclose(rep);
    return pass ? 0 : 1;
}
