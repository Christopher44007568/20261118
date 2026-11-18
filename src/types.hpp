#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include <glm/glm.hpp>

constexpr uint32_t kMaxClusterLights = 128;
constexpr uint32_t kDefaultLightCount = 100;
constexpr uint32_t kDefaultTilePixels = 16;
constexpr uint32_t kDefaultDepthSlices = 24;

struct alignas(16) GpuLight {
    glm::vec4 positionRadius;
    glm::vec4 colorIntensity;
};

struct alignas(16) FrameData {
    glm::mat4 view;
    glm::mat4 inverseView;
    glm::vec4 cameraPosition;
    glm::vec4 screenSize;
    glm::vec4 clusterGrid;
    glm::vec4 depthParams;
    glm::vec4 lightParams;
};

static_assert(sizeof(GpuLight) == 32);
static_assert(sizeof(FrameData) == 208);

struct CounterSnapshot {
    uint32_t updatedClusters = 0;
    uint32_t unchangedClusters = 0;
    uint32_t nonEmptyClusters = 0;
    uint32_t totalLightReferences = 0;
    uint32_t maxLightsPerCluster = 0;
    uint32_t reserved0 = 0;
    uint32_t reserved1 = 0;
    uint32_t reserved2 = 0;
};

struct FrameTiming {
    double cpuMs = 0.0;
    double clusterGpuMs = 0.0;
    double clusteredShadeGpuMs = 0.0;
    double bruteShadeGpuMs = 0.0;
};

struct Config {
    uint32_t width = 960;
    uint32_t height = 540;
    uint32_t lights = kDefaultLightCount;
    uint32_t frames = 60;
    uint32_t warmupFrames = 8;
    uint32_t tilePixels = kDefaultTilePixels;
    uint32_t depthSlices = kDefaultDepthSlices;
    std::string outputDir = "artifacts";
    std::string shaderDir = CLUSTER_SHADER_DIR;
};

struct VerificationStats {
    uint64_t comparedPixels = 0;
    uint64_t mismatchedPixels = 0;
    double maxAbsoluteError = 0.0;
    double meanAbsoluteError = 0.0;
    bool passed = false;
};

static_assert(sizeof(CounterSnapshot) == 32);

