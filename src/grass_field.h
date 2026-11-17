#pragma once
#include "math_util.h"
#include <vector>
#include <cstdint>

// Per-instance attributes uploaded once per chunk (instance rate = 1).
// xyz: world root position on terrain; w: rotation around Y (radians)
// xyz: blade height scale; w: per-instance wind phase
struct GrassInstance {
    Vec4 root_rot;
    Vec4 height_phase;
};

enum RenderMode {
    MODE_NO_INSTANCE = 0,   // one draw call per blade (control baseline)
    MODE_STATIC_INSTANCE,   // one instanced draw per visible chunk, wind off
    MODE_DYNAMIC_WIND       // instanced draws + GPU wind field
};

struct ChunkCullStats {
    int chunks_total = 0;
    int chunks_visible = 0;
    int draw_calls = 0;
    int instances_submitted = 0;
    int instances_popped = 0; // chunks that switched visible with no fade band
};

struct Chunk {
    int cx = 0, cz = 0;
    Vec3 aabb_min{}, aabb_max{};
    unsigned int instance_vbo = 0;
    int capacity = 0;     // max instances (nearest LOD)
    int count_full = 0;   // generated instance count at full density
    // Per-frame state.
    bool in_range = false;
    bool frustum_hit = false;
    float target_fade = 0.0f; // 0 far/hidden -> 1 near/full
    float fade = 0.0f;        // eased toward target each update
    bool was_hidden = true;   // for hard-pop diagnostics when fade is disabled
    int lod_level = 0;        // 0 nearest ... increases with distance
    int active_count = 0;     // LOD-reduced count actually drawn
};

class GrassField {
public:
    // chunk_world: world size of one chunk; chunks_per_side: grid extent;
    // base_density: instances per chunk at LOD0.
    void init(int chunks_per_side, float chunk_world, int base_density,
              bool bushes);
    void shutdown();

// Recompute visibility/LOD/fade for a camera position and frustum.
    void update(const Vec3& cam_pos, const Frustum& frustum,
                float dt, bool enable_fade);

    // Issue GL draws using the supplied program; returns this frame's stats.
    // The caller binds the program and sets shared uniforms first.
    ChunkCullStats draw(RenderMode mode, unsigned int vao,
                        int base_vertex_count, int u_fade) const;

    const std::vector<Chunk>& chunks() const { return chunks_; }
    int max_instances_per_chunk() const { return base_density_; }
    // When true, distance LOD is disabled and every chunk draws full density.
    void set_lod_enabled(bool enabled) { lod_enabled_ = enabled; }
    bool lod_enabled() const { return lod_enabled_; }
    // Clear all per-frame fade/visibility state (used when switching modes).
    void reset_transient_state();

private:
    std::vector<Chunk> chunks_;
    int side_ = 0;
    float chunk_world_ = 0.0f;
    int base_density_ = 0;
    float view_radius_ = 0.0f;
    float fade_band_ = 0.0f;
    int pop_events_ = 0;
    bool lod_enabled_ = true;
};
