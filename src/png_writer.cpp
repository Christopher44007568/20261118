#include "png_writer.hpp"

#include <algorithm>
#include <array>
#include <fstream>
#include <vector>

namespace {

void appendU32(std::vector<uint8_t>& output, uint32_t value) {
    output.push_back(static_cast<uint8_t>((value >> 24) & 0xffu));
    output.push_back(static_cast<uint8_t>((value >> 16) & 0xffu));
    output.push_back(static_cast<uint8_t>((value >> 8) & 0xffu));
    output.push_back(static_cast<uint8_t>(value & 0xffu));
}

void appendChunk(
    std::vector<uint8_t>& png,
    const char type[4],
    const std::vector<uint8_t>& payload) {
    appendU32(png, static_cast<uint32_t>(payload.size()));
    size_t typeOffset = png.size();
    png.insert(png.end(), type, type + 4);
    png.insert(png.end(), payload.begin(), payload.end());
    uint32_t crc = 0xffffffffu;
    for (size_t i = typeOffset; i < png.size(); ++i) {
        crc ^= png[i];
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
        }
    }
    appendU32(png, crc ^ 0xffffffffu);
}

uint32_t adler32(const std::vector<uint8_t>& data) {
    uint32_t a = 1;
    uint32_t b = 0;
    for (uint8_t value : data) {
        a = (a + value) % 65521u;
        b = (b + a) % 65521u;
    }
    return (b << 16) | a;
}

std::vector<uint8_t> deflateStored(const std::vector<uint8_t>& input) {
    std::vector<uint8_t> output;
    output.push_back(0x78);
    output.push_back(0x01);
    size_t offset = 0;
    while (offset < input.size()) {
        size_t count = std::min<size_t>(65535u, input.size() - offset);
        bool finalBlock = offset + count == input.size();
        output.push_back(finalBlock ? 1 : 0);
        output.push_back(static_cast<uint8_t>(count & 0xffu));
        output.push_back(static_cast<uint8_t>((count >> 8) & 0xffu));
        uint16_t inverse = static_cast<uint16_t>(~count);
        output.push_back(static_cast<uint8_t>(inverse & 0xffu));
        output.push_back(static_cast<uint8_t>((inverse >> 8) & 0xffu));
        output.insert(output.end(), input.begin() + offset,
                      input.begin() + offset + count);
        offset += count;
    }
    uint32_t checksum = adler32(input);
    output.push_back(static_cast<uint8_t>((checksum >> 24) & 0xffu));
    output.push_back(static_cast<uint8_t>((checksum >> 16) & 0xffu));
    output.push_back(static_cast<uint8_t>((checksum >> 8) & 0xffu));
    output.push_back(static_cast<uint8_t>(checksum & 0xffu));
    return output;
}

}  // namespace

bool writePng(
    const std::string& path,
    uint32_t width,
    uint32_t height,
    const std::vector<uint8_t>& rgb) {
    if (rgb.size() != static_cast<size_t>(width) * height * 3u) {
        return false;
    }

    std::vector<uint8_t> scanlines;
    scanlines.reserve(static_cast<size_t>(height) * (1u + width * 3u));
    for (uint32_t y = 0; y < height; ++y) {
        scanlines.push_back(0);
        size_t offset = static_cast<size_t>(y) * width * 3u;
        scanlines.insert(scanlines.end(), rgb.begin() + offset,
                         rgb.begin() + offset + width * 3u);
    }

    std::vector<uint8_t> compressed = deflateStored(scanlines);

    std::vector<uint8_t> png = {137, 80, 78, 71, 13, 10, 26, 10};
    std::vector<uint8_t> header(13);
    const std::array<uint32_t, 2> dimensions = {width, height};
    for (size_t i = 0; i < dimensions.size(); ++i) {
        header[i * 4] = static_cast<uint8_t>((dimensions[i] >> 24) & 0xffu);
        header[i * 4 + 1] = static_cast<uint8_t>((dimensions[i] >> 16) & 0xffu);
        header[i * 4 + 2] = static_cast<uint8_t>((dimensions[i] >> 8) & 0xffu);
        header[i * 4 + 3] = static_cast<uint8_t>(dimensions[i] & 0xffu);
    }
    header[8] = 8;
    header[9] = 2;
    appendChunk(png, "IHDR", header);
    appendChunk(png, "IDAT", compressed);
    appendChunk(png, "IEND", {});

    std::ofstream file(path, std::ios::binary);
    if (!file) {
        return false;
    }
    file.write(reinterpret_cast<const char*>(png.data()),
               static_cast<std::streamsize>(png.size()));
    return static_cast<bool>(file);
}

