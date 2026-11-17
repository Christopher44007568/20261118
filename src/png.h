#pragma once
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>
#include <algorithm>

// Minimal PNG writer (RGB8, no external deps; zlib stream uses stored blocks).
namespace png {

inline uint32_t crc32(const uint8_t* data, size_t len) {
    static uint32_t table[256];
    static bool init = false;
    if (!init) {
        for (uint32_t i = 0; i < 256; ++i) {
            uint32_t c = i;
            for (int k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : (c >> 1);
            table[i] = c;
        }
        init = true;
    }
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; ++i) c = table[(c ^ data[i]) & 0xFF] ^ (c >> 8);
    return c ^ 0xFFFFFFFFu;
}

inline uint32_t adler32(const uint8_t* data, size_t len) {
    uint32_t a = 1, b = 0;
    for (size_t i = 0; i < len; ++i) {
        a = (a + data[i]) % 65521u;
        b = (b + a) % 65521u;
    }
    return (b << 16) | a;
}

inline void put32(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back((v >> 24) & 0xFF);
    out.push_back((v >> 16) & 0xFF);
    out.push_back((v >> 8) & 0xFF);
    out.push_back(v & 0xFF);
}

inline void chunk(std::vector<uint8_t>& out, const char* type, const std::vector<uint8_t>& data) {
    put32(out, (uint32_t)data.size());
    size_t start = out.size();
    out.insert(out.end(), type, type + 4);
    out.insert(out.end(), data.begin(), data.end());
    put32(out, crc32(out.data() + start, out.size() - start));
}

// rgb: width*height*3 bytes, row-major.
inline bool save(const std::string& path, int width, int height, const std::vector<uint8_t>& rgb) {
    std::vector<uint8_t> raw;
    raw.reserve((size_t)height * (1 + (size_t)width * 3));
    for (int y = 0; y < height; ++y) {
        raw.push_back(0); // filter: none
        raw.insert(raw.end(), rgb.begin() + (size_t)y * width * 3,
                   rgb.begin() + (size_t)(y + 1) * width * 3);
    }
    std::vector<uint8_t> z = {0x78, 0x01}; // zlib header: deflate, fastest
    size_t pos = 0;
    while (pos < raw.size()) {
        size_t n = std::min<size_t>(65535, raw.size() - pos);
        bool last = (pos + n == raw.size());
        z.push_back(last ? 1 : 0);
        z.push_back((uint8_t)(n & 0xFF));
        z.push_back((uint8_t)((n >> 8) & 0xFF));
        z.push_back((uint8_t)(~n & 0xFF));
        z.push_back((uint8_t)((~n >> 8) & 0xFF));
        z.insert(z.end(), raw.begin() + pos, raw.begin() + pos + n);
        pos += n;
    }
    put32(z, adler32(raw.data(), raw.size()));

    std::vector<uint8_t> out = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    std::vector<uint8_t> ihdr;
    put32(ihdr, (uint32_t)width);
    put32(ihdr, (uint32_t)height);
    ihdr.insert(ihdr.end(), {8, 2, 0, 0, 0}); // 8-bit, truecolor
    chunk(out, "IHDR", ihdr);
    chunk(out, "IDAT", z);
    chunk(out, "IEND", {});

    FILE* f = fopen(path.c_str(), "wb");
    if (!f) return false;
    fwrite(out.data(), 1, out.size(), f);
    fclose(f);
    return true;
}

} // namespace png
