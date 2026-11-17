#include "renderer.h"
#include "terrain.h"
#include "osmesa_app.h"
#include <cstdio>
#include <vector>
#include <string>
#include <algorithm>
#include <cmath>

namespace {

struct ModeSummary {
    const char* name;
    double avg_ms = 0, p95_ms = 0, min_ms = 0, max_ms = 0;
    long total_draw_calls = 0;
    long total_instances = 0;
    int pop_events = 0;
};

Vec3 camera_at(size_t frame, size_t total) {
    // Gentle circular fly-through that repeatedly crosses chunk boundaries.
    float a = 6.2831853f * frame / (float)total;
    float radius = 55.0f + 18.0f * std::sin(a * 2.0f);
    float x = std::cos(a) * radius;
    float z = std::sin(a) * radius;
    float y = terrain_height(x, z) + 6.5f;
    return {x, y, z};
}

ModeSummary run_mode(Renderer& r, RenderMode mode, size_t frames,
                     float dt, bool capture) {
    ModeSummary s;
    s.name = mode == MODE_NO_INSTANCE ? "no-instancing"
           : mode == MODE_STATIC_INSTANCE ? "static-instanced"
           : "dynamic-wind";
    std::vector<double> ms;
    ms.reserve(frames);
    for (size_t f = 0; f < frames; ++f) {
        Vec3 eye = camera_at(f, frames);
        Vec3 look{0, terrain_height(0, 0) + 1.0f, 0};
        FrameResult fr = r.render_frame(mode, eye, look, f * dt, dt);
        ms.push_back(fr.gpu_sync_ms);
        s.total_draw_calls += fr.draw_calls;
        s.total_instances += fr.instances;
        s.pop_events = std::max(s.pop_events, fr.pop_events);
        if (capture && f == frames / 2)
            r.screenshot(std::string(s.name));
    }
    std::sort(ms.begin(), ms.end());
    s.avg_ms = 0;
    for (double v : ms) s.avg_ms += v;
    s.avg_ms /= ms.size();
    s.min_ms = ms.front();
    s.max_ms = ms.back();
    s.p95_ms = ms[(size_t)(0.95 * (ms.size() - 1))];
    return s;
}

void write_csv_header(FILE* f) {
    std::fprintf(f,
        "mode,density,frames,avg_ms,p95_ms,min_ms,max_ms,"
        "draw_calls_per_frame,instances_per_frame,pop_events\n");
}
void write_csv_row(FILE* f, const char* density_tag, size_t frames,
                   const ModeSummary& s) {
    std::fprintf(f,
        "%s,%s,%zu,%.4f,%.4f,%.4f,%.4f,%.2f,%.2f,%d\n",
        s.name, density_tag, frames, s.avg_ms, s.p95_ms, s.min_ms, s.max_ms,
        (double)s.total_draw_calls / frames,
        (double)s.total_instances / frames, s.pop_events);
}

// Snapshot of the current framebuffer for offline comparisons.
std::vector<uint32_t> snapshot() {
    OsWindow& w = os_window();
    os_readback();
    return w.color;
}

bool is_foliage(uint32_t px) {
    uint8_t r = px & 0xff, g = (px >> 8) & 0xff, b = (px >> 16) & 0xff;
    return g > r && g > b && g > 70; // green-dominant foliage
}

// Fraction of non-sky pixels above the horizon band (vegetation coverage).
double vegetation_coverage(const std::vector<uint32_t>& color) {
    OsWindow& w = os_window();
    long veg = 0, band = 0;
    for (int y = w.height / 3; y < w.height; ++y) {
        for (int x = 0; x < w.width; ++x) {
            ++band;
            if (is_foliage(color[(size_t)y * w.width + x])) ++veg;
        }
    }
    return (double)veg / band;
}

// Highest (smallest y) foliage pixel per column: the visible skyline.
std::vector<int> skyline(const std::vector<uint32_t>& color) {
    OsWindow& w = os_window();
    std::vector<int> top(w.width, w.height);
    for (int x = 0; x < w.width; ++x) {
        for (int y = 0; y < w.height; ++y) {
            if (is_foliage(color[(size_t)y * w.width + x])) {
                top[x] = y;
                break;
            }
        }
    }
    return top;
}

// A column's outline is "continuous" if LOD keeps foliage at or within a few
// pixels of the full-density skyline (no gap opening against the sky).
double silhouette_continuity(const std::vector<uint32_t>& full,
                             const std::vector<uint32_t>& lod) {
    OsWindow& w = os_window();
    std::vector<int> a = skyline(full);
    std::vector<int> b = skyline(lod);
    const int tolerance = std::max(2, w.height / 120);
    long comparable = 0, kept = 0;
    for (int x = 0; x < w.width; ++x) {
        if (a[x] >= w.height) continue; // no foliage even at full density
        ++comparable;
        if (b[x] < w.height && b[x] - a[x] <= tolerance)
            ++kept;
    }
    return comparable ? (double)kept / comparable : 1.0;
}

int validate_wind_root_pin(Renderer& r) {
    // Render the same frame with wind off and on; compare pixels at the ground
    // contact band: root-pinned wind must leave terrain/root pixels untouched.
    Vec3 eye{30, terrain_height(30, 10) + 5, 10};
    Vec3 look{0, 0, 0};
    r.render_frame(MODE_STATIC_INSTANCE, eye, look, 1.0f, 0.016f);
    std::vector<uint32_t> ref = snapshot();
    OsWindow& w = os_window();
    r.render_frame(MODE_DYNAMIC_WIND, eye, look, 1.0f, 0.016f);
    std::vector<uint32_t> cur = snapshot();
    long changed_ground = 0, sampled = 0;
    for (int y = 0; y < w.height; ++y) {
        for (int x = 0; x < w.width; ++x) {
            size_t i = (size_t)y * w.width + x;
            // Only compare the lower 18% of the frame (root/ground band).
            if (y < (int)(w.height * 0.82)) continue;
            ++sampled;
            if (ref[i] != cur[i]) ++changed_ground;
        }
    }
    double ratio = (double)changed_ground / sampled;
    std::printf("[check] wind root-pin: changed ground-band pixels %.3f%%\n",
                ratio * 100.0);
    return ratio < 0.02 ? 0 : 1;
}

} // namespace

int main(int argc, char** argv) {
    RenderConfig cfg;
    size_t frames = 60;
    bool bushes = false;
    bool wind_demo = false;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--frames" && i + 1 < argc) frames = std::stoul(argv[++i]);
        else if (a == "--density" && i + 1 < argc) cfg.density = std::stoi(argv[++i]);
        else if (a == "--chunks" && i + 1 < argc) cfg.chunks_per_side = std::stoi(argv[++i]);
        else if (a == "--bushes") bushes = true;
        else if (a == "--no-fade") cfg.enable_fade = false;
        else if (a == "--wind-demo") wind_demo = true;
    }
    cfg.bushes = bushes;

    Renderer renderer;
    if (!renderer.init(cfg)) return 1;

    std::printf("== instanced %s renderer: %d chunks/side, %d density, %zu frames ==\n",
                bushes ? "bush" : "grass", cfg.chunks_per_side, cfg.density, frames);

    // Warm up shader compilation / llvmpipe codegen outside the timing loop.
    Vec3 eye0 = camera_at(0, frames);
    renderer.render_frame(MODE_DYNAMIC_WIND, eye0, {0,0,0}, 0.0f, 0.016f);

    if (wind_demo) {
        Vec3 eye{24, terrain_height(24, 10) + 5.5f, 10};
        renderer.render_frame(MODE_STATIC_INSTANCE, eye, {0,0,0}, 0.0f, 0.016f);
        renderer.screenshot("wind_static");
        std::vector<uint32_t> base = snapshot();
        renderer.render_frame(MODE_DYNAMIC_WIND, eye, {0,0,0}, 0.2f, 0.016f);
        renderer.screenshot("wind_t0");
        std::vector<uint32_t> t0 = snapshot();
        renderer.render_frame(MODE_DYNAMIC_WIND, eye, {0,0,0}, 1.7f, 0.016f);
        renderer.screenshot("wind_t1");
        std::vector<uint32_t> t1 = snapshot();
        OsWindow& w = os_window();
        long diff_temporal = 0, diff_static = 0, total = 0;
        for (size_t i = 0; i < t0.size(); ++i) {
            ++total;
            if (t0[i] != t1[i]) ++diff_temporal;
            if (base[i] != t0[i]) ++diff_static;
        }
        // Restrict root-band check to the lower 18% of the image.
        long root_total = 0, root_changed = 0;
        for (int y = (int)(w.height * 0.82f); y < w.height; ++y)
            for (int x = 0; x < w.width; ++x) {
                size_t idx = (size_t)y * w.width + x;
                ++root_total;
                if (t0[idx] != t1[idx]) ++root_changed;
            }
        std::printf("[wind-demo] temporal pixel change %.3f%% (upper motion)\n",
                    100.0 * diff_temporal / total);
        std::printf("[wind-demo] static-vs-wind pixel change %.3f%%\n",
                    100.0 * diff_static / total);
        std::printf("[wind-demo] root-band temporal change %.4f%% (must be ~0)\n",
                    100.0 * root_changed / root_total);
        renderer.shutdown();
        return (root_changed == 0 && diff_temporal > 0) ? 0 : 1;
    }

    std::vector<ModeSummary> results;
    results.push_back(run_mode(renderer, MODE_NO_INSTANCE, frames, 0.016f, true));
    results.push_back(run_mode(renderer, MODE_STATIC_INSTANCE, frames, 0.016f, true));
    results.push_back(run_mode(renderer, MODE_DYNAMIC_WIND, frames, 0.016f, true));

    std::printf("\n%-18s %12s %12s %12s %14s %12s %10s\n",
                "mode", "avg_ms", "p95_ms", "min..max", "draw_calls/fr",
                "instances/fr", "pop_evts");
    for (const ModeSummary& s : results) {
        std::printf("%-18s %12.3f %12.3f %6.2f..%6.2f %14.1f %12.1f %10d\n",
                    s.name, s.avg_ms, s.p95_ms, s.min_ms, s.max_ms,
                    (double)s.total_draw_calls / frames,
                    (double)s.total_instances / frames, s.pop_events);
    }
    {
        FILE* csv = std::fopen("results/benchmark.csv", "w");
        if (csv) {
            write_csv_header(csv);
            char tag[32];
            std::snprintf(tag, sizeof(tag), "%d", cfg.density);
            for (const ModeSummary& s : results)
                write_csv_row(csv, tag, frames, s);
            std::fclose(csv);
            std::printf("\nwrote results/benchmark.csv\n");
        }
    }

    // --- Validation 1: distant density LOD keeps a continuous outline.
    // Same viewpoint/wind frame, only the LOD density policy differs, so any
    // coverage change is attributable to LOD rather than camera movement.
    Vec3 fixed_eye{28, terrain_height(28, 12) + 7, 12};
    int instances_lod0 = 0, instances_lod = 0;
    renderer.set_lod_enabled(false);
    FrameResult fr_full = renderer.render_frame(MODE_DYNAMIC_WIND, fixed_eye,
                                                {0,0,0}, 0.5f, 0.016f);
    std::vector<uint32_t> full_color = snapshot();
    double cov_full = vegetation_coverage(full_color);
    instances_lod0 = fr_full.instances;
    renderer.screenshot("lod_full_density");

    renderer.set_lod_enabled(true);
    FrameResult fr_lod = renderer.render_frame(MODE_DYNAMIC_WIND, fixed_eye,
                                               {0,0,0}, 0.5f, 0.016f);
    std::vector<uint32_t> lod_color = snapshot();
    double cov_lod = vegetation_coverage(lod_color);
    instances_lod = fr_lod.instances;
    renderer.screenshot("lod_reduced_density");
    double cov_delta = std::fabs(cov_lod - cov_full) / cov_full;
    double instance_cut = 1.0 - (double)instances_lod / instances_lod0;
    double continuity = silhouette_continuity(full_color, lod_color);
    std::printf("\n[check] LOD density: instances %d -> %d (saved %.1f%%)\n",
                instances_lod0, instances_lod, instance_cut * 100.0);
    std::printf("[check] silhouette coverage full=%.4f lod=%.4f delta=%.2f%%\n",
                cov_full, cov_lod, cov_delta * 100.0);
    std::printf("[check] terrain/foliage skyline continuity=%.2f%%\n",
                continuity * 100.0);
    // Primary criterion: the outline against the sky stays continuous even
    // though overall fill (coverage) may drop at aggressive density.
    int rc_silhouette = continuity >= 0.97 ? 0 : 1;

    // --- Validation 2: wind only moves the upper blade, roots stay pinned.
    int rc_wind = validate_wind_root_pin(renderer);

    // --- Validation 3: no hard chunk pop with the fade band; contrast with a
    // run where fading is disabled, which must report hard pop events.
    renderer.set_fade_enabled(true); // resets transient fade state
    int pops = 0;
    for (size_t f = 0; f < frames; ++f) {
        Vec3 e = camera_at(f, frames);
        FrameResult fr = renderer.render_frame(MODE_DYNAMIC_WIND, e,
                                               {0,0,0}, f * 0.016f, 0.016f);
        pops = std::max(pops, fr.pop_events);
    }
    std::printf("[check] chunk hard-pop events with fade band: %d\n", pops);
    renderer.set_fade_enabled(false);
    int pops_hard = 0;
    for (size_t f = 0; f < frames; ++f) {
        Vec3 e = camera_at(f, frames);
        FrameResult fr = renderer.render_frame(MODE_DYNAMIC_WIND, e,
                                               {0,0,0}, f * 0.016f, 0.016f);
        pops_hard = std::max(pops_hard, fr.pop_events);
    }
    renderer.set_fade_enabled(true);
    std::printf("[check] chunk hard-pop events WITHOUT fade band: %d\n",
                pops_hard);
    int rc_pop = (pops == 0 && pops_hard > 0) ? 0 : 1;

    renderer.screenshot(bushes ? "final_bush" : "final_grass");
    renderer.shutdown();

    std::printf("\nvalidation: silhouette=%s wind-root=%s no-pop=%s\n",
                rc_silhouette ? "FAIL" : "PASS",
                rc_wind ? "FAIL" : "PASS",
                rc_pop ? "FAIL" : "PASS");
    return rc_silhouette | rc_wind | rc_pop;
}
