#pragma once
#include <cstdint>
#include <cstdio>
#include <vector>
#include <string>
#include "linalg.h"

struct Image {
    int w = 0, h = 0;
    std::vector<Vec3> px; // linear RGB, 0..1

    Image() = default;
    Image(int w_, int h_) : w(w_), h(h_), px(size_t(w_) * h_, {0, 0, 0}) {}

    Vec3& at(int x, int y) { return px[size_t(y) * w + x]; }
    const Vec3& at(int x, int y) const { return px[size_t(y) * w + x]; }

    int countNaN() const {
        int n = 0;
        for (auto& p : px)
            if (!std::isfinite(p.x) || !std::isfinite(p.y) || !std::isfinite(p.z)) n++;
        return n;
    }
};

namespace png {

inline uint32_t crc32(const uint8_t* data, size_t len) {
    static uint32_t table[256];
    static bool init = false;
    if (!init) {
        for (uint32_t n = 0; n < 256; n++) {
            uint32_t c = n;
            for (int k = 0; k < 8; k++)
                c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            table[n] = c;
        }
        init = true;
    }
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++) c = table[(c ^ data[i]) & 0xFF] ^ (c >> 8);
    return c ^ 0xFFFFFFFFu;
}

inline uint32_t adler32(const uint8_t* data, size_t len) {
    uint32_t a = 1, b = 0;
    for (size_t i = 0; i < len; i++) {
        a = (a + data[i]) % 65521;
        b = (b + a) % 65521;
    }
    return (b << 16) | a;
}

inline void put32(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back((v >> 24) & 0xFF);
    out.push_back((v >> 16) & 0xFF);
    out.push_back((v >> 8) & 0xFF);
    out.push_back(v & 0xFF);
}

inline void chunk(std::vector<uint8_t>& out, const char* type,
                  const std::vector<uint8_t>& data) {
    put32(out, (uint32_t)data.size());
    size_t start = out.size();
    out.insert(out.end(), type, type + 4);
    out.insert(out.end(), data.begin(), data.end());
    put32(out, crc32(out.data() + start, out.size() - start));
}

// Writes an 8-bit RGB PNG using uncompressed (stored) deflate blocks,
// so no zlib dependency is needed.
inline bool write(const std::string& path, const Image& img) {
    std::vector<uint8_t> raw;
    raw.reserve(size_t(img.h) * (1 + 3 * img.w));
    for (int y = 0; y < img.h; y++) {
        raw.push_back(0); // filter: none
        for (int x = 0; x < img.w; x++) {
            const Vec3& p = img.at(x, y);
            raw.push_back((uint8_t)(clampf(p.x, 0, 1) * 255.0f + 0.5f));
            raw.push_back((uint8_t)(clampf(p.y, 0, 1) * 255.0f + 0.5f));
            raw.push_back((uint8_t)(clampf(p.z, 0, 1) * 255.0f + 0.5f));
        }
    }

    std::vector<uint8_t> z;
    z.push_back(0x78);
    z.push_back(0x01); // zlib header: deflate, no preset dict
    size_t pos = 0;
    while (pos < raw.size()) {
        size_t n = std::min<size_t>(65535, raw.size() - pos);
        bool last = (pos + n == raw.size());
        z.push_back(last ? 1 : 0);
        z.push_back(n & 0xFF);
        z.push_back((n >> 8) & 0xFF);
        uint16_t nn = (uint16_t)~n;
        z.push_back(nn & 0xFF);
        z.push_back((nn >> 8) & 0xFF);
        z.insert(z.end(), raw.begin() + pos, raw.begin() + pos + n);
        pos += n;
    }
    put32(z, adler32(raw.data(), raw.size()));

    std::vector<uint8_t> pngBytes = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    std::vector<uint8_t> ihdr;
    put32(ihdr, (uint32_t)img.w);
    put32(ihdr, (uint32_t)img.h);
    ihdr.insert(ihdr.end(), {8, 2, 0, 0, 0}); // 8-bit, truecolor
    chunk(pngBytes, "IHDR", ihdr);
    chunk(pngBytes, "IDAT", z);
    chunk(pngBytes, "IEND", {});

    FILE* f = fopen(path.c_str(), "wb");
    if (!f) return false;
    fwrite(pngBytes.data(), 1, pngBytes.size(), f);
    fclose(f);
    return true;
}

} // namespace png
