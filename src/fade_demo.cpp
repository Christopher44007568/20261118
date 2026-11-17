#include "renderer.h"
#include "terrain.h"
#include "osmesa_app.h"
#include <cstdio>

// Standalone helper: render a fresh field and step only a few updates so the
// edge chunks are caught mid fade-in, proving chunks scale/fade rather than
// appearing at full strength in one frame.
int main() {
    RenderConfig cfg;
    cfg.density = 128;
    Renderer r;
    if (!r.init(cfg)) return 1;

    Vec3 eye{30, terrain_height(30, 10) + 6, 10};
    Vec3 look{0, 0, 0};
    // First frame establishes chunks at fade 0; subsequent frames ease them in.
    r.render_frame(MODE_DYNAMIC_WIND, eye, look, 0.0f, 0.016f);
    r.screenshot("fade_frame1");
    r.render_frame(MODE_DYNAMIC_WIND, eye, look, 0.016f, 0.016f);
    r.screenshot("fade_frame2");
    r.render_frame(MODE_DYNAMIC_WIND, eye, look, 0.032f, 0.016f);
    r.screenshot("fade_frame3");

    int fading = 0, full = 0;
    for (const Chunk& c : r.field().chunks()) {
        if (c.fade > 0.01f && c.fade < 0.99f) ++fading;
        if (c.fade >= 0.99f) ++full;
    }
    std::printf("[fade-demo] chunks mid-fade=%d fully-in=%d after 3 frames\n",
                fading, full);
    r.shutdown();
    return fading > 0 ? 0 : 1;
}
