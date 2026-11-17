#include "renderer.h"
#include "osmesa_app.h"
#include "gl_loader.h"
#include <GL/gl.h>
#include <cstdio>
#include <fstream>
#include <sstream>

namespace {
std::string read_file(const std::string& path) {
    std::ifstream f(path);
    if (!f) {
        std::fprintf(stderr, "cannot open shader %s\n", path.c_str());
        std::exit(4);
    }
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

unsigned int load_program(const std::string& dir,
                          const std::string& vs, const std::string& fs) {
    std::string v = read_file(dir + "/" + vs);
    std::string f = read_file(dir + "/" + fs);
    return make_program(v.c_str(), f.c_str());
}
}

bool Renderer::init(const RenderConfig& cfg) {
    cfg_ = cfg;
    if (!os_init(cfg.width, cfg.height))
        return false;

    const char* sdir = std::getenv("SHADER_DIR");
    std::string dir = sdir ? sdir : "shaders";
    ground_prog_ = load_program(dir, "ground.vert", "ground.frag");
    grass_prog_ = load_program(dir, "grass.vert", "grass.frag");

    gp_viewproj_ = gl_loader::GetUniformLocation(ground_prog_, "u_view_proj");
    sp_viewproj_ = gl_loader::GetUniformLocation(grass_prog_, "u_view_proj");
    sp_time_     = gl_loader::GetUniformLocation(grass_prog_, "u_time");
    sp_wind_on_  = gl_loader::GetUniformLocation(grass_prog_, "u_wind_enabled");
    sp_wind_dir_ = gl_loader::GetUniformLocation(grass_prog_, "u_wind_dir");
    sp_wind_amp_ = gl_loader::GetUniformLocation(grass_prog_, "u_wind_amp");
    sp_fade_     = gl_loader::GetUniformLocation(grass_prog_, "u_fade");
    sp_bush_     = gl_loader::GetUniformLocation(grass_prog_, "u_bush");
    sp_cam_      = gl_loader::GetUniformLocation(grass_prog_, "u_cam_pos");

    ground_ = build_ground_mesh(96, cfg.chunk_world * cfg.chunks_per_side);
    blade_ = build_grass_blade_mesh();
    bush_ = build_bush_mesh();
    field_.init(cfg.chunks_per_side, cfg.chunk_world, cfg.density, cfg.bushes);

    glEnable(GL_DEPTH_TEST);
    glClearColor(0.55f, 0.68f, 0.82f, 1.0f);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    return true;
}

void Renderer::shutdown() {
    field_.shutdown();
    os_shutdown();
}

FrameResult Renderer::render_frame(RenderMode mode, const Vec3& eye,
                                   const Vec3& look_at, float time, float dt) {
    FrameResult fr;
    double t0 = now_seconds();

    Mat4 view = mat_look_at(eye, look_at, {0, 1, 0});
    float aspect = (float)cfg_.width / cfg_.height;
    Mat4 proj = mat_perspective(1.05f, aspect, 0.5f, 420.0f);
    Mat4 vp = mat_mul(proj, view);
    Frustum frustum = frustum_from_view_proj(vp);

    field_.update(eye, frustum, dt, cfg_.enable_fade);

    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    // Ground.
    gl_loader::UseProgram(ground_prog_);
    gl_loader::UniformMatrix4fv(gp_viewproj_, 1, GL_FALSE, vp.m);
    gl_loader::BindVertexArray(ground_.vao);
    glDrawArrays(GL_TRIANGLES, 0, ground_.vertex_count);

    // Grass / bushes.
    gl_loader::UseProgram(grass_prog_);
    gl_loader::UniformMatrix4fv(sp_viewproj_, 1, GL_FALSE, vp.m);
    gl_loader::Uniform1f(sp_time_, time);
    gl_loader::Uniform1f(sp_wind_on_, mode == MODE_DYNAMIC_WIND ? 1.0f : 0.0f);
    gl_loader::Uniform3f(sp_wind_dir_, 0.866f, 0.0f, 0.5f);
    gl_loader::Uniform1f(sp_wind_amp_, cfg_.bushes ? 0.22f : 0.35f);
    gl_loader::Uniform1f(sp_bush_, cfg_.bushes ? 1.0f : 0.0f);
    gl_loader::Uniform3f(sp_cam_, eye.x, eye.y, eye.z);

    BaseMesh& mesh = cfg_.bushes ? bush_ : blade_;
    ChunkCullStats st = field_.draw(mode, mesh.vao, mesh.vertex_count,
                                    sp_fade_);
    gl_loader::BindVertexArray(0);

    double t1 = now_seconds();
    glFinish(); // force llvmpipe work to complete for honest CPU/GPU timing
    double t2 = now_seconds();

    fr.cpu_frame_ms = (t1 - t0) * 1000.0;
    fr.gpu_sync_ms = (t2 - t0) * 1000.0;
    fr.draw_calls = st.draw_calls + 1; // +1 ground draw
    fr.instances = st.instances_submitted;
    fr.chunks_visible = st.chunks_visible;
    fr.pop_events = st.instances_popped;
    return fr;
}

void Renderer::screenshot(const std::string& name) const {
    os_readback();
    std::string path = "screenshots/" + name + ".ppm";
    os_write_ppm(path);
}
