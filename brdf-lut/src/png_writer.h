#pragma once
// Minimal dependency-free PNG writer (zlib "stored" deflate blocks).
// Supports RGB8 and LA16 (luminance+alpha, 16-bit per channel) so the
// BRDF LUT can be stored losslessly as R=scale, G=bias.

#include <cstdint>
#include <cstdio>
#include <vector>

namespace pngw {

inline uint32_t crc32(const uint8_t* data, size_t len) {
    static uint32_t table[256];
    static bool init = false;
    if (!init) {
        for (uint32_t n = 0; n < 256; ++n) {
            uint32_t c = n;
            for (int k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            table[n] = c;
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
    out.push_back(uint8_t(v >> 24));
    out.push_back(uint8_t(v >> 16));
    out.push_back(uint8_t(v >> 8));
    out.push_back(uint8_t(v));
}

inline void chunk(std::vector<uint8_t>& out, const char type[4], const std::vector<uint8_t>& data) {
    put32(out, uint32_t(data.size()));
    size_t typePos = out.size();
    out.insert(out.end(), type, type + 4);
    out.insert(out.end(), data.begin(), data.end());
    put32(out, crc32(out.data() + typePos, 4 + data.size()));
}

// raw: scanlines without filter bytes; stride = width * bytesPerPixel.
inline bool write(const char* path, int width, int height, int colorType,
                  int bytesPerPixel, const uint8_t* raw) {
    std::vector<uint8_t> filtered;
    filtered.reserve(size_t(height) * (size_t(width) * bytesPerPixel + 1));
    const size_t stride = size_t(width) * bytesPerPixel;
    for (int y = 0; y < height; ++y) {
        filtered.push_back(0); // filter: none
        filtered.insert(filtered.end(), raw + size_t(y) * stride, raw + (size_t(y) + 1) * stride);
    }

    std::vector<uint8_t> z;
    z.push_back(0x78);
    z.push_back(0x01); // zlib header, fastest/stored
    size_t pos = 0;
    while (pos < filtered.size()) {
        uint32_t blockLen = uint32_t(std::min<size_t>(65535, filtered.size() - pos));
        bool last = (pos + blockLen == filtered.size());
        z.push_back(last ? 1 : 0);
        z.push_back(uint8_t(blockLen & 0xFF));
        z.push_back(uint8_t(blockLen >> 8));
        uint32_t nlen = ~blockLen;
        z.push_back(uint8_t(nlen & 0xFF));
        z.push_back(uint8_t(nlen >> 8));
        z.insert(z.end(), filtered.begin() + pos, filtered.begin() + pos + blockLen);
        pos += blockLen;
    }
    put32(z, adler32(filtered.data(), filtered.size()));

    std::vector<uint8_t> png = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    std::vector<uint8_t> ihdr;
    put32(ihdr, uint32_t(width));
    put32(ihdr, uint32_t(height));
    ihdr.push_back(colorType == 4 ? 16 : 8); // bit depth
    ihdr.push_back(uint8_t(colorType));      // 2 = RGB, 4 = LA
    ihdr.insert(ihdr.end(), {0, 0, 0});      // compression, filter, interlace
    chunk(png, "IHDR", ihdr);
    chunk(png, "IDAT", z);
    chunk(png, "IEND", {});

    FILE* f = std::fopen(path, "wb");
    if (!f) return false;
    size_t written = std::fwrite(png.data(), 1, png.size(), f);
    std::fclose(f);
    return written == png.size();
}

inline bool writeRGB8(const char* path, int w, int h, const std::vector<uint8_t>& rgb) {
    return write(path, w, h, 2, 3, rgb.data());
}

// la16: 2 channels per pixel, big-endian 16-bit (PNG native order).
inline bool writeLA16(const char* path, int w, int h, const std::vector<uint16_t>& la) {
    std::vector<uint8_t> be(la.size() * 2);
    for (size_t i = 0; i < la.size(); ++i) {
        be[2 * i] = uint8_t(la[i] >> 8);
        be[2 * i + 1] = uint8_t(la[i] & 0xFF);
    }
    return write(path, w, h, 4, 4, be.data());
}

} // namespace pngw
