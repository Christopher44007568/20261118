#pragma once
#include <vector>
#include <string>
#include <cstdint>

struct OsWindow {
    int width = 0;
    int height = 0;
    std::vector<uint32_t> color; // RGBA8, bottom-up from GL, flipped on write
    std::vector<float> depth;
};

bool os_init(int width, int height);
void os_shutdown();
OsWindow& os_window();

// Read back the color buffer (RGBA8) into OsWindow.
void os_readback();

// Write the current color buffer as a binary P6 PPM (RGB, top-down).
bool os_write_ppm(const std::string& path);

// Monotonic seconds.
double now_seconds();

// Compile/link helpers shared by all renderers.
unsigned int compile_shader(unsigned int type, const char* src);
unsigned int link_program(unsigned int vs, unsigned int fs);
unsigned int make_program(const char* vs_src, const char* fs_src);
