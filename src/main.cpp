#include <cstdlib>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>

#include "cluster_renderer.hpp"
#include "types.hpp"
#include "vulkan_context.hpp"

namespace {

uint32_t parseU32(const std::string& value, const std::string& option) {
    size_t consumed = 0;
    unsigned long parsed = std::stoul(value, &consumed);
    if (consumed != value.size() || parsed > 0xfffffffful) {
        throw std::runtime_error("invalid value for " + option + ": " + value);
    }
    return static_cast<uint32_t>(parsed);
}

void printUsage() {
    std::cout
        << "Usage: clustered_lighting [options]\n"
        << "  --lights N        point light count (default 100)\n"
        << "  --width N         output width (default 960)\n"
        << "  --height N        output height (default 540)\n"
        << "  --frames N        measured frames (default 60)\n"
        << "  --warmup N        warmup frames (default 8)\n"
        << "  --tile N          cluster tile size in pixels (default 16)\n"
        << "  --slices N        logarithmic depth slices (default 24)\n"
        << "  --out DIR         output directory (default artifacts)\n"
        << "  --shader-dir DIR  directory containing compiled SPIR-V\n";
}

}  // namespace

int main(int argc, char** argv) {
    try {
        Config config;
        for (int i = 1; i < argc; ++i) {
            std::string option = argv[i];
            if (option == "--help" || option == "-h") {
                printUsage();
                return 0;
            }
            if (i + 1 >= argc) {
                throw std::runtime_error("missing value for " + option);
            }
            std::string value = argv[++i];
            if (option == "--lights") {
                config.lights = parseU32(value, option);
            } else if (option == "--width") {
                config.width = parseU32(value, option);
            } else if (option == "--height") {
                config.height = parseU32(value, option);
            } else if (option == "--frames") {
                config.frames = parseU32(value, option);
            } else if (option == "--warmup") {
                config.warmupFrames = parseU32(value, option);
            } else if (option == "--tile") {
                config.tilePixels = parseU32(value, option);
            } else if (option == "--slices") {
                config.depthSlices = parseU32(value, option);
            } else if (option == "--out") {
                config.outputDir = value;
            } else if (option == "--shader-dir") {
                config.shaderDir = value;
            } else {
                throw std::runtime_error("unknown option: " + option);
            }
        }

        VulkanContext context;
        context.initialize();
        std::cout << "Vulkan device: " << context.deviceName() << "\n";

        ClusterRenderer renderer(context, config);
        renderer.run();
        return renderer.verificationPassed() ? 0 : 2;
    } catch (const std::exception& error) {
        std::cerr << "error: " << error.what() << "\n";
        return 1;
    }
}

