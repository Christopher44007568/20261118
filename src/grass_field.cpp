#include "grass_field.h"
#include "terrain.h"
#include "gl_loader.h"
#include <GL/gl.h>
#include <cmath>
#include <algorithm>

namespace {
constexpr int kLodLevels = 4;

// Evenly distributed subset: stride sampling keeps spatial coverage uniform
// instead of clumping the surviving blades, which preserves the silhouette.
int lod_count(int full, int lod) {
    int keep = full;
    for (int i = 0; i < lod && keep > 1; ++i)
        keep = std::max(1, (keep + 1) / 2);
    return keep;
}
}

void GrassField::init(int chunks_per_side, float chunk_world,
                      int base_density, bool bushes) {
    side_ = chunks_per_side;
    chunk_world_ = chunk_world;
    base_density_ = base_density;
    view_radius_ = chunk_world * (chunks_per_side * 0.5f);
    fade_band_ = chunk_world * 1.5f;

    chunks_.clear();
    chunks_.reserve((size_t)side_ * side_);
    float half = chunk_world * side_ * 0.5f;

    for (int cz = 0; cz < side_; ++cz) {
        for (int cx = 0; cx < side_; ++cx) {
            Chunk ch;
            ch.cx = cx; ch.cz = cz;
            float x0 = -half + cx * chunk_world;
            float z0 = -half + cz * chunk_world;

            // Deterministic per-chunk seed so the field is identical in every
            // benchmark run and every render mode.
            uint32_t seed = hash_u32((uint32_t)cx * 2246822519u)
                          ^ hash_u32((uint32_t)cz * 3266489917u);
            std::vector<GrassInstance> inst;
            inst.reserve(base_density);
            float ymin = 1e9f, ymax = -1e9f;
            for (int k = 0; k < base_density; ++k) {
                float fx = rand01(seed);
                float fz = rand01(seed);
                float wx = x0 + fx * chunk_world;
                float wz = z0 + fz * chunk_world;
                float wy = terrain_height(wx, wz);
                ymin = std::min(ymin, wy);
                ymax = std::max(ymax, wy);
                GrassInstance gi;
                gi.root_rot = {wx, wy, wz, rand01(seed) * 6.2831853f};
                float h = bushes ? 1.6f + rand01(seed) * 1.4f
                                 : 0.75f + rand01(seed) * 0.7f;
                gi.height_phase = {h, 0.0f, 0.0f, rand01(seed) * 6.2831853f};
                inst.push_back(gi);
            }
            ch.count_full = base_density;
            ch.capacity = base_density;
            // AABB includes blade/bush height for conservative culling.
            float top = bushes ? 3.2f : 1.6f;
            ch.aabb_min = {x0, ymin - 0.1f, z0};
            ch.aabb_max = {x0 + chunk_world, ymax + top, z0 + chunk_world};

            gl_loader::GenBuffers(1, &ch.instance_vbo);
            gl_loader::BindBuffer(GL_ARRAY_BUFFER, ch.instance_vbo);
            gl_loader::BufferData(GL_ARRAY_BUFFER,
                                  (GLsizeiptr)(inst.size() * sizeof(GrassInstance)),
                                  inst.data(), GL_STATIC_DRAW);
            chunks_.push_back(ch);
        }
    }
}

void GrassField::shutdown() {
    for (Chunk& ch : chunks_)
        gl_loader::DeleteBuffers(1, &ch.instance_vbo);
    chunks_.clear();
}

void GrassField::reset_transient_state() {
    pop_events_ = 0;
    for (Chunk& ch : chunks_) {
        ch.in_range = false;
        ch.frustum_hit = false;
        ch.target_fade = 0.0f;
        ch.fade = 0.0f;
        ch.was_hidden = true;
        ch.active_count = 0;
    }
}

void GrassField::update(const Vec3& cam_pos, const Frustum& frustum,
                        float dt, bool enable_fade) {
    const float fade_speed = 2.2f; // 1/s; ~0.45 s to fully appear
    pop_events_ = 0;
    for (Chunk& ch : chunks_) {
        Vec3 center{
            (ch.aabb_min.x + ch.aabb_max.x) * 0.5f,
            (ch.aabb_min.y + ch.aabb_max.y) * 0.5f,
            (ch.aabb_min.z + ch.aabb_max.z) * 0.5f
        };
        float dx = center.x - cam_pos.x;
        float dz = center.z - cam_pos.z;
        float dist = std::sqrt(dx*dx + dz*dz);

        // Distance ring -> LOD density level.
        float ring = view_radius_ / kLodLevels;
        int lod = lod_enabled_
            ? (int)std::min((float)(kLodLevels - 1), std::floor(dist / ring))
            : 0;
        ch.lod_level = lod;
        ch.active_count = lod_count(ch.count_full, lod);

        // Range test with a soft band for fade transitions.
        ch.in_range = dist <= view_radius_;
        float target = 0.0f;
        if (ch.in_range) {
            float edge = std::max(0.0f, view_radius_ - dist);
            target = enable_fade
                ? std::min(1.0f, edge / fade_band_)
                : 1.0f;
        }
        ch.target_fade = target;

        // Frustum test is independent of fade state: a culled chunk keeps its
        // eased fade value, so panning back never restarts it from zero.
        ch.frustum_hit = frustum_intersects_aabb(frustum,
                                                 ch.aabb_min, ch.aabb_max);

        // Hard-pop diagnostic: appearing at full strength with no soft band.
        bool now_shown = ch.in_range && ch.frustum_hit && ch.target_fade > 0.5f;
        if (now_shown && ch.was_hidden && !enable_fade)
            ++pop_events_;
        ch.was_hidden = !now_shown;

        float step = fade_speed * dt;
        if (ch.fade < ch.target_fade)
            ch.fade = std::min(ch.target_fade, ch.fade + step);
        else if (ch.fade > ch.target_fade)
            ch.fade = std::max(ch.target_fade, ch.fade - step);
    }
}

ChunkCullStats GrassField::draw(RenderMode mode, unsigned int vao,
                                int base_vertex_count, int u_fade) const {
    ChunkCullStats st;
    st.chunks_total = (int)chunks_.size();
    gl_loader::BindVertexArray(vao);

    for (const Chunk& ch : chunks_) {
        if (!ch.in_range || !ch.frustum_hit || ch.fade <= 0.001f)
            continue;
        st.chunks_visible++;
        if (u_fade >= 0)
            gl_loader::Uniform1f(u_fade, ch.fade);

        // Bind this chunk's instance attributes (locations 2 and 3).
        gl_loader::BindBuffer(GL_ARRAY_BUFFER, ch.instance_vbo);
        gl_loader::EnableVertexAttribArray(2);
        gl_loader::VertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE,
                                       sizeof(GrassInstance), (void*)0);
        gl_loader::EnableVertexAttribArray(3);
        gl_loader::VertexAttribPointer(3, 4, GL_FLOAT, GL_FALSE,
                                       sizeof(GrassInstance),
                                       (void*)(4 * sizeof(float)));
        gl_loader::VertexAttribDivisor(2, 1);
        gl_loader::VertexAttribDivisor(3, 1);

        if (mode == MODE_NO_INSTANCE) {
            // Control path: one draw per blade -> draw calls == instances.
            for (int i = 0; i < ch.active_count; ++i) {
                gl_loader::DrawArraysInstanced(GL_TRIANGLES, 0,
                                               base_vertex_count, 1);
                st.draw_calls++;
                st.instances_submitted++;
            }
        } else {
            gl_loader::DrawArraysInstanced(GL_TRIANGLES, 0,
                                           base_vertex_count,
                                           ch.active_count);
            st.draw_calls++;
            st.instances_submitted += ch.active_count;
        }
    }
    gl_loader::VertexAttribDivisor(2, 0);
    gl_loader::VertexAttribDivisor(3, 0);
    st.instances_popped = pop_events_;
    return st;
}
