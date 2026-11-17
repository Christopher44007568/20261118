// Environment BRDF LUT generator + validator.
// Usage: brdf_lut [size] [lutSamples] [refSamples]

#include "compare.h"
#include "png_writer.h"
#include <chrono>
#include <cstdio>
#include <string>

static std::string outPath(const char* name) { return std::string("out/") + name; }

int main(int argc, char** argv) {
    const int lutSize = argc > 1 ? std::atoi(argv[1]) : 512;
    const uint32_t lutSamples = argc > 2 ? uint32_t(std::atoi(argv[2])) : 2048;
    const uint32_t refSamples = argc > 3 ? uint32_t(std::atoi(argv[3])) : 8192;

    std::string report;
    auto log = [&](const char* fmt, auto... args) {
        char buf[512];
        std::snprintf(buf, sizeof(buf), fmt, args...);
        report += buf;
        report += '\n';
        std::printf("%s\n", buf);
    };

    // ---- 1. Generate LUT (timed) ----
    auto t0 = std::chrono::steady_clock::now();
    BrdfLut lut = generateLut(lutSize, lutSamples);
    auto t1 = std::chrono::steady_clock::now();
    double genMs = std::chrono::duration<double, std::milli>(t1 - t0).count();

    log("%s", "== Environment BRDF LUT ==");
    log("texture size      : %d x %d  (RG16F-equivalent, R=scale G=bias)", lutSize, lutSize);
    log("texture memory    : %.1f KiB (RG16F) / %.1f KiB (RG8)",
        lutSize * lutSize * 4 / 1024.0, lutSize * lutSize * 2 / 1024.0);
    log("LUT samples/texel : %u", lutSamples);
    log("generation time   : %.2f ms", genMs);

    // Save LUT as 16-bit LA PNG (lossless) + 8-bit RGB preview.
    std::vector<uint16_t> la(size_t(lutSize) * lutSize * 2);
    std::vector<uint8_t> prev(size_t(lutSize) * lutSize * 3);
    for (size_t i = 0; i < size_t(lutSize) * lutSize; ++i) {
        la[2 * i] = uint16_t(clampf(lut.texels[i].x, 0.0f, 1.0f) * 65535.0f + 0.5f);
        la[2 * i + 1] = uint16_t(clampf(lut.texels[i].y, 0.0f, 1.0f) * 65535.0f + 0.5f);
        prev[3 * i] = uint8_t(la[2 * i] >> 8);
        prev[3 * i + 1] = uint8_t(la[2 * i + 1] >> 8);
        prev[3 * i + 2] = 0;
    }
    pngw::writeLA16(outPath("env_brdf_lut.png").c_str(), lutSize, lutSize, la);
    pngw::writeRGB8(outPath("env_brdf_lut_preview.png").c_str(), lutSize, lutSize, prev);

    // ---- 2. Boundary safety: out-of-range coords must clamp, not wrap ----
    bool boundaryOk = true;
    const float probes[][2] = {{-0.25f, 0.3f}, {1.25f, 0.7f}, {0.5f, -0.1f}, {0.5f, 1.1f}};
    for (auto& p : probes) {
        Vec2 a = lut.sample(p[0], p[1]);
        Vec2 b = lut.sample(clampf(p[0], 0.0f, 1.0f), clampf(p[1], 0.0f, 1.0f));
        if (std::fabs(a.x - b.x) > 1e-6f || std::fabs(a.y - b.y) > 1e-6f) boundaryOk = false;
    }
    log("boundary clamp    : %s (uv outside [0,1] clamps to edge texels)",
        boundaryOk ? "PASS" : "FAIL");

    // ---- 3. Roughness continuity: max delta between adjacent fine steps ----
    double maxStep = 0.0;
    for (float ndv : {0.1f, 0.5f, 0.9f}) {
        Vec2 prev2 = lut.sample(ndv, 0.0f);
        for (int i = 1; i <= 4096; ++i) {
            Vec2 cur = lut.sample(ndv, float(i) / 4096.0f);
            maxStep = std::max(maxStep, double(std::fabs(cur.x - prev2.x)));
            maxStep = std::max(maxStep, double(std::fabs(cur.y - prev2.y)));
            prev2 = cur;
        }
    }
    log("roughness continuity: max delta %.6f over 4096 steps (bilinear => C0 continuous)",
        maxStep);

    // ---- 4. Three materials: LUT vs high-sample numeric reference ----
    const Material mats[3] = {
        {"polished_gold  (rough=0.08, metal, F0=(1.00,0.766,0.336))", 0.08f, {1.00f, 0.766f, 0.336f}},
        {"satin_plastic  (rough=0.45, dielectric, F0=0.04)", 0.45f, {0.04f, 0.04f, 0.04f}},
        {"rough_aluminum (rough=0.85, metal, F0=(0.91,0.92,0.92))", 0.85f, {0.91f, 0.92f, 0.92f}},
    };
    log("%s", "");
    log("== LUT vs numeric reference (%u samples/pixel) ==", refSamples);
    double worstErr = 0.0;
    for (int m = 0; m < 3; ++m) {
        CompareResult r = compareMaterial(lut, mats[m], 256, refSamples);
        worstErr = std::max(worstErr, r.maxAbsError);
        log("material %d: %s", m + 1, mats[m].name.c_str());
        log("  max luminance error  : %.6f (at NdotV=%.4f)", r.maxAbsError, r.maxErrNdotV);
        log("  max relative error   : %.4f %%", r.maxRelError * 100.0);
        log("  max error (NdotV>=.05): %.6f", r.maxAbsErrorInner);
        log("  mean luminance error : %.6f  (%d sphere pixels)", r.meanAbsError, r.pixelCount);
        char name[64];
        std::snprintf(name, sizeof(name), "mat%d_lut.png", m + 1);
        pngw::writeRGB8(outPath(name).c_str(), r.imgSize, r.imgSize, r.imgLut);
        std::snprintf(name, sizeof(name), "mat%d_ref.png", m + 1);
        pngw::writeRGB8(outPath(name).c_str(), r.imgSize, r.imgSize, r.imgRef);
        std::snprintf(name, sizeof(name), "mat%d_diff_x10.png", m + 1);
        pngw::writeRGB8(outPath(name).c_str(), r.imgSize, r.imgSize, r.imgDiff);
    }
    log("%s", "");
    log("overall max error : %.6f (luminance, linear space)", worstErr);

    FILE* f = std::fopen(outPath("report.txt").c_str(), "w");
    if (f) {
        std::fwrite(report.data(), 1, report.size(), f);
        std::fclose(f);
    }
    return boundaryOk ? 0 : 1;
}
