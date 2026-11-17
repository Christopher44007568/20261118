#include "osmesa_app.h"
#include "gl_loader.h"
#include <GL/osmesa.h>
#include <GL/gl.h>
#include <cstdio>
#include <cstring>
#include <chrono>

namespace {
OSMesaContext g_ctx = nullptr;
OsWindow g_win;
}

bool os_init(int width, int height) {
    g_win.width = width;
    g_win.height = height;
    g_win.color.assign((size_t)width * height, 0);
    g_win.depth.assign((size_t)width * height, 1.0f);

    // Core-style 3.3+ context; llvmpipe exposes up to 4.5.
    int attribs[] = {
        OSMESA_FORMAT, OSMESA_RGBA,
        OSMESA_DEPTH_BITS, 24,
        OSMESA_STENCIL_BITS, 0,
        OSMESA_PROFILE, OSMESA_CORE_PROFILE,
        OSMESA_CONTEXT_MAJOR_VERSION, 3,
        OSMESA_CONTEXT_MINOR_VERSION, 3,
        0, 0
    };
    g_ctx = OSMesaCreateContextAttribs(attribs, nullptr);
    if (!g_ctx) {
        std::fprintf(stderr, "OSMesaCreateContextAttribs failed\n");
        return false;
    }
    if (!OSMesaMakeCurrent(g_ctx, g_win.color.data(), GL_UNSIGNED_BYTE,
                           width, height)) {
        std::fprintf(stderr, "OSMesaMakeCurrent failed\n");
        return false;
    }
    gl_loader::load();
    std::printf("[gl] %s | %s\n",
                reinterpret_cast<const char*>(glGetString(GL_VERSION)),
                reinterpret_cast<const char*>(glGetString(GL_RENDERER)));
    return true;
}

void os_shutdown() {
    if (g_ctx) OSMesaDestroyContext(g_ctx);
    g_ctx = nullptr;
}

OsWindow& os_window() { return g_win; }

void os_readback() {
    glReadPixels(0, 0, g_win.width, g_win.height, GL_RGBA,
                 GL_UNSIGNED_BYTE, g_win.color.data());
}

bool os_write_ppm(const std::string& path) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;
    std::fprintf(f, "P6\n%d %d\n255\n", g_win.width, g_win.height);
    // GL origin is bottom-left; PPM expects top-down.
    for (int y = g_win.height - 1; y >= 0; --y) {
        for (int x = 0; x < g_win.width; ++x) {
            uint32_t px = g_win.color[(size_t)y * g_win.width + x];
            unsigned char rgb[3] = {
                (unsigned char)(px & 0xff),
                (unsigned char)((px >> 8) & 0xff),
                (unsigned char)((px >> 16) & 0xff)
            };
            std::fwrite(rgb, 1, 3, f);
        }
    }
    std::fclose(f);
    return true;
}

double now_seconds() {
    using clock = std::chrono::steady_clock;
    return std::chrono::duration<double>(clock::now().time_since_epoch()).count();
}

unsigned int compile_shader(unsigned int type, const char* src) {
    unsigned int sh = gl_loader::CreateShader(type);
    gl_loader::ShaderSource(sh, 1, &src, nullptr);
    gl_loader::CompileShader(sh);
    int ok = 0;
    gl_loader::GetShaderiv(sh, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[4096];
        gl_loader::GetShaderInfoLog(sh, sizeof(log), nullptr, log);
        std::fprintf(stderr, "shader compile error:\n%s\n", log);
        std::exit(3);
    }
    return sh;
}

unsigned int link_program(unsigned int vs, unsigned int fs) {
    unsigned int prog = gl_loader::CreateProgram();
    gl_loader::AttachShader(prog, vs);
    gl_loader::AttachShader(prog, fs);
    gl_loader::LinkProgram(prog);
    int ok = 0;
    gl_loader::GetProgramiv(prog, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[4096];
        gl_loader::GetProgramInfoLog(prog, sizeof(log), nullptr, log);
        std::fprintf(stderr, "program link error:\n%s\n", log);
        std::exit(3);
    }
    return prog;
}

unsigned int make_program(const char* vs_src, const char* fs_src) {
    unsigned int vs = compile_shader(GL_VERTEX_SHADER, vs_src);
    unsigned int fs = compile_shader(GL_FRAGMENT_SHADER, fs_src);
    unsigned int prog = link_program(vs, fs);
    gl_loader::DeleteShader(vs);
    gl_loader::DeleteShader(fs);
    return prog;
}
