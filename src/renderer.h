#pragma once
#include "grass_field.h"
#include "geometry.h"
#include "terrain.h"
#include <string>

struct RenderConfig {
    int chunks_per_side = 16;
    float chunk_world = 12.0f;
    int density = 128;       // instances per chunk at nearest LOD
    bool bushes = false;
    int width = 960;
    int height = 600;
    bool enable_fade = true;
};

struct FrameResult {
    double cpu_frame_ms = 0;
    double gpu_sync_ms = 0;
    int draw_calls = 0;
    int instances = 0;
    int chunks_visible = 0;
    int pop_events = 0;
};

class Renderer {
public:
    bool init(const RenderConfig& cfg);
    void shutdown();

    // Render one frame from a camera position looking toward look_at.
    FrameResult render_frame(RenderMode mode, const Vec3& eye,
                             const Vec3& look_at, float time, float dt);

    // Snapshot the current framebuffer to screenshots/<name>.ppm
    void screenshot(const std::string& name) const;

    const GrassField& field() const { return field_; }
    const RenderConfig& config() const { return cfg_; }
    void set_lod_enabled(bool enabled) { field_.set_lod_enabled(enabled); }
    void set_fade_enabled(bool enabled) {
        cfg_.enable_fade = enabled;
        field_.reset_transient_state();
    }

private:
    RenderConfig cfg_;
    unsigned int ground_prog_ = 0;
    unsigned int grass_prog_ = 0;
    GroundMesh ground_;
    BaseMesh blade_;
    BaseMesh bush_;
    GrassField field_;
    // uniform locations
    int gp_viewproj_ = -1;
    int sp_viewproj_ = -1, sp_time_ = -1, sp_wind_on_ = -1;
    int sp_wind_dir_ = -1, sp_wind_amp_ = -1, sp_fade_ = -1;
    int sp_bush_ = -1, sp_cam_ = -1;
};
