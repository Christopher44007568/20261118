#include "cluster_renderer.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <numeric>
#include <random>
#include <sstream>

#include <glm/gtc/matrix_transform.hpp>

#include "png_writer.hpp"

namespace {

constexpr float kNearPlane = 0.15f;
constexpr float kFarPlane = 25.0f;
constexpr float kVerticalFovRadians = 0.872664626f;

double elapsedMs(
    const std::chrono::steady_clock::time_point& start,
    const std::chrono::steady_clock::time_point& end) {
    return std::chrono::duration<double, std::milli>(end - start).count();
}

double mean(const std::vector<double>& values) {
    if (values.empty()) {
        return 0.0;
    }
    return std::accumulate(values.begin(), values.end(), 0.0) /
           static_cast<double>(values.size());
}

double percentile(std::vector<double> values, double fraction) {
    if (values.empty()) {
        return 0.0;
    }
    std::sort(values.begin(), values.end());
    size_t index = static_cast<size_t>(fraction * static_cast<double>(values.size() - 1));
    return values[index];
}

}  // namespace

ClusterRenderer::ClusterRenderer(VulkanContext& context, Config config)
    : context_(context), config_(std::move(config)) {
    if (config_.width == 0 || config_.height == 0 || config_.tilePixels == 0 ||
        config_.depthSlices == 0 || config_.frames == 0) {
        fail("width, height, tile size, depth slices and frames must be non-zero");
    }
    if (config_.lights == 0 || config_.lights > kMaxClusterLights) {
        fail("light count must be between 1 and " + std::to_string(kMaxClusterLights));
    }

    depthSlices_ = config_.depthSlices;
    tilesX_ = (config_.width + config_.tilePixels - 1u) / config_.tilePixels;
    tilesY_ = (config_.height + config_.tilePixels - 1u) / config_.tilePixels;
    clusterCount_ = tilesX_ * tilesY_ * depthSlices_;
}

ClusterRenderer::~ClusterRenderer() {
    destroy();
}

void ClusterRenderer::initialize() {
    createDescriptorLayout();
    createResources();
    createPipelines();
    createQueriesAndCommands();
    generateLights();
    context_.copyToBuffer(
        lightBuffer_, lights_.data(),
        static_cast<VkDeviceSize>(lights_.size() * sizeof(GpuLight)));
}

void ClusterRenderer::createDescriptorLayout() {
    std::array<VkDescriptorSetLayoutBinding, 6> bindings{};
    const std::array<VkDescriptorType, 6> types = {
        VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,
        VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
        VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
        VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
        VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
        VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
    };
    for (uint32_t i = 0; i < bindings.size(); ++i) {
        bindings[i].binding = i;
        bindings[i].descriptorType = types[i];
        bindings[i].descriptorCount = 1;
        bindings[i].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    }

    VkDescriptorSetLayoutCreateInfo layoutInfo{
        VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    layoutInfo.bindingCount = static_cast<uint32_t>(bindings.size());
    layoutInfo.pBindings = bindings.data();
    check(vkCreateDescriptorSetLayout(
              context_.device, &layoutInfo, nullptr, &descriptorSetLayout_),
          "vkCreateDescriptorSetLayout failed");

    VkDescriptorPoolSize poolSizes[2]{};
    poolSizes[0].type = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    poolSizes[0].descriptorCount = 2;
    poolSizes[1].type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    poolSizes[1].descriptorCount = 10;

    VkDescriptorPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    poolInfo.maxSets = 2;
    poolInfo.poolSizeCount = 2;
    poolInfo.pPoolSizes = poolSizes;
    check(vkCreateDescriptorPool(context_.device, &poolInfo, nullptr, &descriptorPool_),
          "vkCreateDescriptorPool failed");

    VkDescriptorSetLayout layouts[2] = {descriptorSetLayout_, descriptorSetLayout_};
    VkDescriptorSetAllocateInfo allocateInfo{
        VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    allocateInfo.descriptorPool = descriptorPool_;
    allocateInfo.descriptorSetCount = 2;
    allocateInfo.pSetLayouts = layouts;
    VkDescriptorSet sets[2]{};
    check(vkAllocateDescriptorSets(context_.device, &allocateInfo, sets),
          "vkAllocateDescriptorSets failed");
    clusteredSet_ = sets[0];
    bruteForceSet_ = sets[1];
}

void ClusterRenderer::createPipelines() {
    std::vector<uint32_t> clusterCode =
        readSpirv(config_.shaderDir + "/cluster_build.spv");
    std::vector<uint32_t> shadeCode = readSpirv(config_.shaderDir + "/shade.spv");

    VkShaderModuleCreateInfo clusterModuleInfo{
        VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    clusterModuleInfo.codeSize = clusterCode.size() * sizeof(uint32_t);
    clusterModuleInfo.pCode = clusterCode.data();
    check(vkCreateShaderModule(
              context_.device, &clusterModuleInfo, nullptr, &clusterShader_),
          "vkCreateShaderModule(cluster_build) failed");

    VkShaderModuleCreateInfo shadeModuleInfo{
        VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    shadeModuleInfo.codeSize = shadeCode.size() * sizeof(uint32_t);
    shadeModuleInfo.pCode = shadeCode.data();
    check(vkCreateShaderModule(context_.device, &shadeModuleInfo, nullptr, &shadeShader_),
          "vkCreateShaderModule(shade) failed");

    VkPushConstantRange pushRange{};
    pushRange.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    pushRange.offset = 0;
    pushRange.size = sizeof(uint32_t);

    VkPipelineLayoutCreateInfo layoutInfo{
        VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    layoutInfo.setLayoutCount = 1;
    layoutInfo.pSetLayouts = &descriptorSetLayout_;
    layoutInfo.pushConstantRangeCount = 1;
    layoutInfo.pPushConstantRanges = &pushRange;
    check(vkCreatePipelineLayout(context_.device, &layoutInfo, nullptr, &pipelineLayout_),
          "vkCreatePipelineLayout failed");

    VkPipelineShaderStageCreateInfo clusterStage{
        VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    clusterStage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    clusterStage.module = clusterShader_;
    clusterStage.pName = "main";

    VkComputePipelineCreateInfo clusterInfo{
        VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    clusterInfo.layout = pipelineLayout_;
    clusterInfo.stage = clusterStage;
    check(vkCreateComputePipelines(
              context_.device, VK_NULL_HANDLE, 1, &clusterInfo, nullptr,
              &clusterPipeline_),
          "vkCreateComputePipelines(cluster) failed");

    VkPipelineShaderStageCreateInfo shadeStage{
        VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    shadeStage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    shadeStage.module = shadeShader_;
    shadeStage.pName = "main";

    VkComputePipelineCreateInfo shadeInfo{
        VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    shadeInfo.layout = pipelineLayout_;
    shadeInfo.stage = shadeStage;
    check(vkCreateComputePipelines(
              context_.device, VK_NULL_HANDLE, 1, &shadeInfo, nullptr,
              &shadePipeline_),
          "vkCreateComputePipelines(shade) failed");
}

void ClusterRenderer::createResources() {
    const VkBufferUsageFlags storageUsage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
    frameUniform_ = context_.createBuffer(
        sizeof(FrameData), VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
    lightBuffer_ = context_.createBuffer(
        static_cast<VkDeviceSize>(config_.lights * sizeof(GpuLight)), storageUsage);
    clusterCountBuffer_ = context_.createBuffer(
        static_cast<VkDeviceSize>(clusterCount_ * sizeof(uint32_t)), storageUsage);
    clusterLightBuffer_ = context_.createBuffer(
        static_cast<VkDeviceSize>(clusterCount_) * kMaxClusterLights * sizeof(uint32_t),
        storageUsage);
    counterBuffer_ = context_.createBuffer(
        sizeof(CounterSnapshot),
        storageUsage | VK_BUFFER_USAGE_TRANSFER_DST_BIT);

    const VkDeviceSize pixelBytes =
        static_cast<VkDeviceSize>(config_.width) * config_.height * sizeof(glm::vec4);
    clusteredOutput_ = context_.createBuffer(pixelBytes, storageUsage);
    bruteForceOutput_ = context_.createBuffer(pixelBytes, storageUsage);

    VkDescriptorBufferInfo bufferInfos[6]{};
    bufferInfos[0] = {frameUniform_.handle, 0, VK_WHOLE_SIZE};
    bufferInfos[1] = {lightBuffer_.handle, 0, VK_WHOLE_SIZE};
    bufferInfos[2] = {clusterCountBuffer_.handle, 0, VK_WHOLE_SIZE};
    bufferInfos[3] = {clusterLightBuffer_.handle, 0, VK_WHOLE_SIZE};
    bufferInfos[4] = {counterBuffer_.handle, 0, VK_WHOLE_SIZE};

    for (VkDescriptorSet set : {clusteredSet_, bruteForceSet_}) {
        std::array<VkDescriptorBufferInfo, 6> infos{};
        std::copy(std::begin(bufferInfos), std::end(bufferInfos), infos.begin());
        infos[5] = {set == clusteredSet_ ? clusteredOutput_.handle
                                         : bruteForceOutput_.handle,
                    0, VK_WHOLE_SIZE};

        std::array<VkWriteDescriptorSet, 6> writes{};
        for (uint32_t i = 0; i < writes.size(); ++i) {
            writes[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            writes[i].dstSet = set;
            writes[i].dstBinding = i;
            writes[i].descriptorCount = 1;
            writes[i].descriptorType =
                i == 0 ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER
                       : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            writes[i].pBufferInfo = &infos[i];
        }
        vkUpdateDescriptorSets(
            context_.device, static_cast<uint32_t>(writes.size()), writes.data(),
            0, nullptr);
    }
}

void ClusterRenderer::createQueriesAndCommands() {
    VkQueryPoolCreateInfo queryInfo{VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO};
    queryInfo.queryType = VK_QUERY_TYPE_TIMESTAMP;
    queryInfo.queryCount = 4;
    check(vkCreateQueryPool(context_.device, &queryInfo, nullptr, &queryPool_),
          "vkCreateQueryPool failed");
    if (context_.timestampValidBits == 0 || context_.timestampPeriod == 0.0f) {
        std::cerr << "warning: compute queue does not support timestamps\n";
    }

    VkCommandBufferAllocateInfo allocateInfo{
        VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    allocateInfo.commandPool = context_.commandPool;
    allocateInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    allocateInfo.commandBufferCount = 1;
    check(vkAllocateCommandBuffers(context_.device, &allocateInfo, &commandBuffer_),
          "vkAllocateCommandBuffers failed");

    VkFenceCreateInfo fenceInfo{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
    check(vkCreateFence(context_.device, &fenceInfo, nullptr, &fence_),
          "vkCreateFence failed");
}

void ClusterRenderer::generateLights() {
    lights_.resize(config_.lights);
    std::mt19937 random(0x5eed1234u);
    std::uniform_real_distribution<float> unit(0.0f, 1.0f);
    const glm::vec3 warm(1.0f, 0.47f, 0.20f);
    const glm::vec3 cool(0.24f, 0.62f, 1.0f);
    const glm::vec3 lime(0.40f, 1.0f, 0.56f);

    for (uint32_t i = 0; i < config_.lights; ++i) {
        float angle = static_cast<float>(i) * 2.39996323f +
                      (unit(random) - 0.5f) * 0.35f;
        float shell = (i % 4u == 0u)
                          ? 2.2f + unit(random) * 1.1f
                          : 3.2f + unit(random) * 2.6f;
        float y = -1.25f + unit(random) * 4.5f;
        glm::vec3 position(
            std::cos(angle) * shell * (0.8f + 0.45f * unit(random)),
            y,
            std::sin(angle) * shell * (0.8f + 0.45f * unit(random)));
        float radius = 1.7f + unit(random) * 2.2f;
        float intensity = (i % 9u == 0u) ? 8.5f : 2.4f + unit(random) * 2.8f;
        glm::vec3 color = (i % 3u == 0u) ? warm : ((i % 3u == 1u) ? cool : lime);
        lights_[i].positionRadius = glm::vec4(position, radius);
        lights_[i].colorIntensity = glm::vec4(color, intensity);
    }
}

ClusterRenderer::Camera ClusterRenderer::cameraAt(
    uint32_t frameIndex, uint32_t totalFrames) const {
    float phase = totalFrames > 1u
                      ? static_cast<float>(frameIndex) /
                            static_cast<float>(totalFrames - 1u)
                      : 0.0f;
    float angle = -0.13f + 0.26f * phase;
    float radius = 7.35f;
    glm::vec3 position(
        std::sin(angle) * radius,
        2.55f + 0.18f * std::sin(phase * 3.14159265f),
        std::cos(angle) * radius);
    glm::vec3 target(0.0f, 0.10f, 0.0f);
    glm::mat4 view = glm::lookAt(position, target, glm::vec3(0.0f, 1.0f, 0.0f));
    return {view, glm::inverse(view), position};
}

FrameData ClusterRenderer::makeFrameData(const Camera& camera) const {
    FrameData data{};
    data.view = camera.view;
    data.inverseView = camera.inverseView;
    data.cameraPosition = glm::vec4(camera.position, 1.0f);
    data.screenSize = glm::vec4(
        static_cast<float>(config_.width), static_cast<float>(config_.height),
        1.0f / static_cast<float>(config_.width),
        1.0f / static_cast<float>(config_.height));
    data.clusterGrid = glm::vec4(
        static_cast<float>(tilesX_), static_cast<float>(tilesY_),
        static_cast<float>(depthSlices_), static_cast<float>(config_.tilePixels));
    data.depthParams = glm::vec4(
        kNearPlane, kFarPlane, std::log(kFarPlane / kNearPlane),
        std::tan(kVerticalFovRadians * 0.5f));
    data.lightParams = glm::vec4(
        static_cast<float>(config_.lights),
        static_cast<float>(kMaxClusterLights),
        static_cast<float>(clusterCount_), 0.0f);
    return data;
}

void ClusterRenderer::recordFrame(uint32_t frameIndex, uint32_t totalFrames) {
    Camera camera = cameraAt(frameIndex, totalFrames);
    FrameData frameData = makeFrameData(camera);
    context_.copyToBuffer(frameUniform_, &frameData, sizeof(FrameData));

    check(vkResetCommandBuffer(commandBuffer_, 0), "vkResetCommandBuffer failed");
    VkCommandBufferBeginInfo beginInfo{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    check(vkBeginCommandBuffer(commandBuffer_, &beginInfo),
          "vkBeginCommandBuffer failed");

    VkMemoryBarrier frameBarrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    frameBarrier.srcAccessMask =
        VK_ACCESS_HOST_WRITE_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    frameBarrier.dstAccessMask =
        VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(
        commandBuffer_,
        VK_PIPELINE_STAGE_HOST_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &frameBarrier,
        0, nullptr, 0, nullptr);

    if (context_.timestampValidBits > 0) {
        vkCmdResetQueryPool(commandBuffer_, queryPool_, 0, 4);
    }
    vkCmdFillBuffer(commandBuffer_, counterBuffer_.handle, 0, sizeof(CounterSnapshot), 0);

    VkBufferMemoryBarrier counterBarrier{ VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER };
    counterBarrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    counterBarrier.dstAccessMask =
        VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    counterBarrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    counterBarrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    counterBarrier.buffer = counterBuffer_.handle;
    counterBarrier.offset = 0;
    counterBarrier.size = VK_WHOLE_SIZE;
    vkCmdPipelineBarrier(
        commandBuffer_, VK_PIPELINE_STAGE_TRANSFER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0, nullptr, 1, &counterBarrier,
        0, nullptr);

    if (context_.timestampValidBits > 0) {
        vkCmdWriteTimestamp(
            commandBuffer_, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, queryPool_, 0);
    }
    vkCmdBindPipeline(commandBuffer_, VK_PIPELINE_BIND_POINT_COMPUTE, clusterPipeline_);
    vkCmdBindDescriptorSets(
        commandBuffer_, VK_PIPELINE_BIND_POINT_COMPUTE, pipelineLayout_, 0, 1,
        &clusteredSet_, 0, nullptr);
    vkCmdDispatch(commandBuffer_, (clusterCount_ + 63u) / 64u, 1, 1);
    if (context_.timestampValidBits > 0) {
        vkCmdWriteTimestamp(
            commandBuffer_, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, queryPool_, 1);
    }

    VkBufferMemoryBarrier clusterBarriers[2]{};
    for (auto& barrier : clusterBarriers) {
        barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.offset = 0;
        barrier.size = VK_WHOLE_SIZE;
    }
    clusterBarriers[0].buffer = clusterCountBuffer_.handle;
    clusterBarriers[1].buffer = clusterLightBuffer_.handle;
    vkCmdPipelineBarrier(
        commandBuffer_, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0, nullptr, 2,
        clusterBarriers, 0, nullptr);

    uint32_t shadedWidth = (config_.width + 7u) / 8u;
    uint32_t shadedHeight = (config_.height + 7u) / 8u;

    uint32_t clusteredMode = 0;
    vkCmdBindPipeline(commandBuffer_, VK_PIPELINE_BIND_POINT_COMPUTE, shadePipeline_);
    vkCmdPushConstants(
        commandBuffer_, pipelineLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
        sizeof(clusteredMode), &clusteredMode);
    vkCmdBindDescriptorSets(
        commandBuffer_, VK_PIPELINE_BIND_POINT_COMPUTE, pipelineLayout_, 0, 1,
        &clusteredSet_, 0, nullptr);
    vkCmdDispatch(commandBuffer_, shadedWidth, shadedHeight, 1);
    if (context_.timestampValidBits > 0) {
        vkCmdWriteTimestamp(
            commandBuffer_, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, queryPool_, 2);
    }

    uint32_t bruteForceMode = 1;
    vkCmdPushConstants(
        commandBuffer_, pipelineLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
        sizeof(bruteForceMode), &bruteForceMode);
    vkCmdBindDescriptorSets(
        commandBuffer_, VK_PIPELINE_BIND_POINT_COMPUTE, pipelineLayout_, 0, 1,
        &bruteForceSet_, 0, nullptr);
    vkCmdDispatch(commandBuffer_, shadedWidth, shadedHeight, 1);
    if (context_.timestampValidBits > 0) {
        vkCmdWriteTimestamp(
            commandBuffer_, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, queryPool_, 3);
    }

    VkMemoryBarrier hostBarrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    hostBarrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    hostBarrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
    vkCmdPipelineBarrier(
        commandBuffer_, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_HOST_BIT, 0, 1, &hostBarrier, 0, nullptr, 0, nullptr);

    check(vkEndCommandBuffer(commandBuffer_), "vkEndCommandBuffer failed");
}

FrameTiming ClusterRenderer::readTimings() const {
    FrameTiming timing;
    if (context_.timestampValidBits == 0) {
        return timing;
    }

    std::array<uint64_t, 4> ticks{};
    check(vkGetQueryPoolResults(
              context_.device, queryPool_, 0, 4, sizeof(ticks), ticks.data(),
              sizeof(uint64_t),
              VK_QUERY_RESULT_64_BIT | VK_QUERY_RESULT_WAIT_BIT),
          "vkGetQueryPoolResults failed");

    uint64_t mask = context_.timestampValidBits >= 64u
                        ? std::numeric_limits<uint64_t>::max()
                        : ((uint64_t{1} << context_.timestampValidBits) - 1u);
    auto ticksToMs = [this](uint64_t delta) {
        return static_cast<double>(delta) * context_.timestampPeriod / 1.0e6;
    };
    timing.clusterGpuMs = ticksToMs((ticks[1] - ticks[0]) & mask);
    timing.clusteredShadeGpuMs = ticksToMs((ticks[2] - ticks[1]) & mask);
    timing.bruteShadeGpuMs = ticksToMs((ticks[3] - ticks[2]) & mask);
    return timing;
}

CounterSnapshot ClusterRenderer::readCounters() const {
    CounterSnapshot counters{};
    std::memcpy(&counters, counterBuffer_.mapped, sizeof(CounterSnapshot));
    return counters;
}

void ClusterRenderer::readOutput(
    const Buffer& buffer, std::vector<float>& output) const {
    const size_t floatCount =
        static_cast<size_t>(config_.width) * config_.height * 4u;
    output.resize(floatCount);
    std::memcpy(output.data(), buffer.mapped, floatCount * sizeof(float));
}

VerificationStats ClusterRenderer::verifyOutputs(
    const std::vector<float>& clustered,
    const std::vector<float>& bruteForce) const {
    VerificationStats stats;
    constexpr double tolerance = 1.0e-4;
    const uint64_t pixelCount =
        static_cast<uint64_t>(config_.width) * config_.height;
    stats.comparedPixels = pixelCount;
    double errorSum = 0.0;

    for (uint64_t pixel = 0; pixel < pixelCount; ++pixel) {
        double pixelError = 0.0;
        for (uint32_t channel = 0; channel < 3u; ++channel) {
            size_t index = pixel * 4u + channel;
            double difference =
                std::abs(static_cast<double>(clustered[index]) -
                         static_cast<double>(bruteForce[index]));
            if (!std::isfinite(difference)) {
                difference = std::numeric_limits<double>::max();
            }
            pixelError = std::max(pixelError, difference);
            errorSum += difference;
            stats.maxAbsoluteError = std::max(stats.maxAbsoluteError, difference);
        }
        if (pixelError > tolerance) {
            ++stats.mismatchedPixels;
        }
    }

    stats.meanAbsoluteError =
        errorSum / static_cast<double>(pixelCount * 3u);
    stats.passed =
        stats.mismatchedPixels == 0 && stats.maxAbsoluteError <= tolerance;
    return stats;
}

void ClusterRenderer::savePixels(
    const std::string& path,
    const std::vector<float>& pixels,
    bool difference) const {
    std::vector<uint8_t> rgb(
        static_cast<size_t>(config_.width) * config_.height * 3u);
    for (size_t pixel = 0; pixel < static_cast<size_t>(config_.width) * config_.height;
         ++pixel) {
        glm::vec3 color(pixels[pixel * 4u], pixels[pixel * 4u + 1u],
                        pixels[pixel * 4u + 2u]);
        if (difference) {
            float error = std::max(color.x, std::max(color.y, color.z));
            color = glm::vec3(std::min(error * 12.0f, 1.0f),
                              std::min(error * 2.5f, 1.0f), 0.0f);
        } else {
            color = glm::max(color, glm::vec3(0.0f));
            color = color / (glm::vec3(1.0f) + color);
            color = glm::pow(color, glm::vec3(1.0f / 2.2f));
        }
        for (uint32_t channel = 0; channel < 3u; ++channel) {
            float value = glm::clamp(color[channel], 0.0f, 1.0f);
            rgb[pixel * 3u + channel] =
                static_cast<uint8_t>(std::lround(value * 255.0f));
        }
    }
    if (!writePng(path, config_.width, config_.height, rgb)) {
        fail("failed to write image: " + path);
    }
}

void ClusterRenderer::writeImages(
    const std::vector<float>& clustered,
    const std::vector<float>& bruteForce,
    const VerificationStats& verification) const {
    (void)verification;
    std::vector<float> difference(clustered.size(), 0.0f);
    for (size_t pixel = 0; pixel < difference.size(); pixel += 4u) {
        for (uint32_t channel = 0; channel < 3u; ++channel) {
            difference[pixel + channel] =
                std::abs(clustered[pixel + channel] - bruteForce[pixel + channel]);
        }
    }
    savePixels(config_.outputDir + "/clustered.png", clustered, false);
    savePixels(config_.outputDir + "/bruteforce.png", bruteForce, false);
    savePixels(config_.outputDir + "/difference.png", difference, true);
}

void ClusterRenderer::writeReport(
    const std::vector<FrameTiming>& timings,
    const std::vector<CounterSnapshot>& counters,
    const VerificationStats& verification) const {
    std::vector<double> cpuTimes;
    std::vector<double> clusterGpuTimes;
    std::vector<double> clusteredShadeTimes;
    std::vector<double> bruteShadeTimes;
    std::vector<double> gpuTotals;
    std::vector<double> updatedCounts;
    std::vector<double> updatedRatios;
    std::vector<double> referenceCounts;
    std::vector<double> nonEmptyCounts;
    uint32_t observedMaxLights = 0;

    for (size_t i = 0; i < timings.size(); ++i) {
        cpuTimes.push_back(timings[i].cpuMs);
        clusterGpuTimes.push_back(timings[i].clusterGpuMs);
        clusteredShadeTimes.push_back(timings[i].clusteredShadeGpuMs);
        bruteShadeTimes.push_back(timings[i].bruteShadeGpuMs);
        gpuTotals.push_back(timings[i].clusterGpuMs +
                            timings[i].clusteredShadeGpuMs +
                            timings[i].bruteShadeGpuMs);
        updatedCounts.push_back(counters[i].updatedClusters);
        updatedRatios.push_back(
            static_cast<double>(counters[i].updatedClusters) /
            static_cast<double>(clusterCount_));
        referenceCounts.push_back(counters[i].totalLightReferences);
        nonEmptyCounts.push_back(counters[i].nonEmptyClusters);
        observedMaxLights =
            std::max(observedMaxLights, counters[i].maxLightsPerCluster);
    }

    double totalReferences = std::accumulate(
        referenceCounts.begin(), referenceCounts.end(), 0.0);
    double totalNonEmpty = std::accumulate(
        nonEmptyCounts.begin(), nonEmptyCounts.end(), 0.0);
    double averageAllClusters =
        totalReferences /
        (static_cast<double>(timings.size()) * static_cast<double>(clusterCount_));
    double averageNonEmpty =
        totalNonEmpty > 0.0 ? totalReferences / totalNonEmpty : 0.0;

    const double averageCpu = mean(cpuTimes);
    const double p95Cpu = percentile(cpuTimes, 0.95);
    const double averageClusterGpu = mean(clusterGpuTimes);
    const double averageClusteredShadeGpu = mean(clusteredShadeTimes);
    const double averageBruteShadeGpu = mean(bruteShadeTimes);
    const double averageGpuTotal = mean(gpuTotals);
    const double p95GpuTotal = percentile(gpuTotals, 0.95);
    const double averageUpdated = mean(updatedCounts);
    const double averageUpdatedRatio = mean(updatedRatios);

    std::filesystem::create_directories(config_.outputDir);
    std::ostringstream json;
    json << std::fixed << std::setprecision(6);
    json << "{\n";
    json << "  \"device\": \"" << context_.deviceName() << "\",\n";
    json << "  \"device_type\": \""
         << (context_.properties().deviceType == VK_PHYSICAL_DEVICE_TYPE_CPU
                 ? "CPU (Vulkan software driver)"
                 : "hardware GPU")
         << "\",\n";
    json << "  \"light_count\": " << config_.lights << ",\n";
    json << "  \"frames_measured\": " << timings.size() << ",\n";
    json << "  \"resolution\": [" << config_.width << ", " << config_.height
         << "],\n";
    json << "  \"cluster_grid\": [" << tilesX_ << ", " << tilesY_ << ", "
         << depthSlices_ << "],\n";
    json << "  \"cluster_count\": " << clusterCount_ << ",\n";
    json << "  \"average_lights_per_cluster\": " << averageAllClusters << ",\n";
    json << "  \"average_lights_per_non_empty_cluster\": " << averageNonEmpty
         << ",\n";
    json << "  \"average_non_empty_clusters\": " << mean(nonEmptyCounts) << ",\n";
    json << "  \"max_lights_per_cluster\": " << observedMaxLights << ",\n";
    json << "  \"average_updated_clusters\": " << averageUpdated << ",\n";
    json << "  \"average_updated_cluster_ratio\": " << averageUpdatedRatio << ",\n";
    json << "  \"cpu_frame_ms\": {\"average\": " << averageCpu
         << ", \"p95\": " << p95Cpu << "},\n";
    json << "  \"gpu_ms\": {\n";
    json << "    \"cluster_build_average\": " << averageClusterGpu << ",\n";
    json << "    \"clustered_shade_average\": " << averageClusteredShadeGpu << ",\n";
    json << "    \"brute_force_shade_average\": " << averageBruteShadeGpu << ",\n";
    json << "    \"total_average\": " << averageGpuTotal << ",\n";
    json << "    \"total_p95\": " << p95GpuTotal << "\n";
    json << "  },\n";
    json << "  \"light_sort_operations\": 0,\n";
    json << "  \"light_buffer_uploads\": 1,\n";
    json << "  \"verification\": {\n";
    json << "    \"compared_pixels\": " << verification.comparedPixels << ",\n";
    json << "    \"mismatched_pixels\": " << verification.mismatchedPixels << ",\n";
    json << "    \"max_absolute_error\": " << verification.maxAbsoluteError
         << ",\n";
    json << "    \"mean_absolute_error\": " << verification.meanAbsoluteError
         << ",\n";
    json << "    \"tolerance\": 0.0001,\n";
    json << "    \"passed\": " << (verification.passed ? "true" : "false") << "\n";
    json << "  }\n";
    json << "}\n";

    std::ofstream jsonFile(config_.outputDir + "/report.json");
    if (!jsonFile) {
        fail("could not write report.json");
    }
    jsonFile << json.str();

    std::ostringstream markdown;
    markdown << std::fixed << std::setprecision(4);
    markdown << "# Clustered lighting benchmark\n\n";
    markdown << "- Device: `" << context_.deviceName() << "`";
    if (context_.properties().deviceType == VK_PHYSICAL_DEVICE_TYPE_CPU) {
        markdown << " (Vulkan software driver)";
    }
    markdown << "\n";
    markdown << "- Resolution: `" << config_.width << "x" << config_.height
             << "`, tile: `" << config_.tilePixels << "px`, depth slices: `"
             << depthSlices_ << "`\n";
    markdown << "- Cluster grid: `" << tilesX_ << " x " << tilesY_ << " x "
             << depthSlices_ << " = " << clusterCount_ << "`\n";
    markdown << "- Point lights: `" << config_.lights << "`, measured frames: `"
             << timings.size() << "`\n\n";
    markdown << "## Cluster occupancy\n\n";
    markdown << "| Metric | Value |\n|---|---:|\n";
    markdown << "| Average lights / cluster (all) | " << averageAllClusters
             << " |\n";
    markdown << "| Average lights / non-empty cluster | " << averageNonEmpty
             << " |\n";
    markdown << "| Average non-empty clusters | " << mean(nonEmptyCounts)
             << " |\n";
    markdown << "| Max lights / cluster | " << observedMaxLights << " |\n";
    markdown << "| Average updated clusters / frame | " << averageUpdated
             << " (`" << averageUpdatedRatio * 100.0 << "%`) |\n";
    markdown << "| CPU light sort operations | 0 |\n";
    markdown << "| Light buffer uploads | 1 (initial) |\n\n";
    markdown << "## Timing\n\n";
    markdown << "| Path | Average ms | p95 ms |\n|---|---:|---:|\n";
    markdown << "| CPU frame record + submit | " << averageCpu << " | "
             << p95Cpu << " |\n";
    markdown << "| Vulkan cluster build | " << averageClusterGpu << " | "
             << percentile(clusterGpuTimes, 0.95) << " |\n";
    markdown << "| Vulkan clustered shading | " << averageClusteredShadeGpu
             << " | " << percentile(clusteredShadeTimes, 0.95) << " |\n";
    markdown << "| Vulkan brute-force shading | " << averageBruteShadeGpu
             << " | " << percentile(bruteShadeTimes, 0.95) << " |\n";
    markdown << "| Vulkan total | " << averageGpuTotal << " | " << p95GpuTotal
             << " |\n\n";
    markdown << "## Verification\n\n";
    markdown << "- Compared pixels: `" << verification.comparedPixels << "`\n";
    markdown << "- Mismatched pixels: `" << verification.mismatchedPixels
             << "` (tolerance `1e-4`)\n";
    markdown << "- Max absolute error: `" << verification.maxAbsoluteError << "`\n";
    markdown << "- Mean absolute error: `" << verification.meanAbsoluteError
             << "`\n";
    markdown << "- Result: **" << (verification.passed ? "PASS" : "FAIL")
             << "**\n";

    std::ofstream markdownFile(config_.outputDir + "/report.md");
    if (!markdownFile) {
        fail("could not write report.md");
    }
    markdownFile << markdown.str();
    std::cout << markdown.str();
}

void ClusterRenderer::run() {
    std::filesystem::create_directories(config_.outputDir);
    initialize();

    const uint32_t totalFrames = config_.warmupFrames + config_.frames;
    snapshots_.reserve(config_.frames);
    timings_.reserve(config_.frames);

    for (uint32_t frame = 0; frame < totalFrames; ++frame) {
        auto cpuStart = std::chrono::steady_clock::now();
        recordFrame(frame, totalFrames);
        check(vkResetFences(context_.device, 1, &fence_), "vkResetFences failed");

        VkSubmitInfo submitInfo{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        submitInfo.commandBufferCount = 1;
        submitInfo.pCommandBuffers = &commandBuffer_;
        check(vkQueueSubmit(context_.queue, 1, &submitInfo, fence_),
              "vkQueueSubmit failed");
        auto cpuEnd = std::chrono::steady_clock::now();

        check(vkWaitForFences(
                  context_.device, 1, &fence_, VK_TRUE,
                  std::numeric_limits<uint64_t>::max()),
              "vkWaitForFences failed");

        if (frame >= config_.warmupFrames) {
            FrameTiming timing = readTimings();
            timing.cpuMs = elapsedMs(cpuStart, cpuEnd);
            timings_.push_back(timing);
            snapshots_.push_back(readCounters());
        }
    }

    std::vector<float> clusteredPixels;
    std::vector<float> bruteForcePixels;
    readOutput(clusteredOutput_, clusteredPixels);
    readOutput(bruteForceOutput_, bruteForcePixels);
    verification_ = verifyOutputs(clusteredPixels, bruteForcePixels);
    writeImages(clusteredPixels, bruteForcePixels, verification_);
    writeReport(timings_, snapshots_, verification_);

    if (!verification_.passed) {
        std::cerr << "verification failed: " << verification_.mismatchedPixels
                  << " mismatched pixels, max error "
                  << verification_.maxAbsoluteError << "\n";
    }
}

void ClusterRenderer::destroy() {
    if (context_.device == VK_NULL_HANDLE) {
        return;
    }
    vkDeviceWaitIdle(context_.device);

    context_.destroyBuffer(bruteForceOutput_);
    context_.destroyBuffer(clusteredOutput_);
    context_.destroyBuffer(counterBuffer_);
    context_.destroyBuffer(clusterLightBuffer_);
    context_.destroyBuffer(clusterCountBuffer_);
    context_.destroyBuffer(lightBuffer_);
    context_.destroyBuffer(frameUniform_);

    if (fence_ != VK_NULL_HANDLE) {
        vkDestroyFence(context_.device, fence_, nullptr);
        fence_ = VK_NULL_HANDLE;
    }
    if (commandBuffer_ != VK_NULL_HANDLE) {
        vkFreeCommandBuffers(context_.device, context_.commandPool, 1, &commandBuffer_);
        commandBuffer_ = VK_NULL_HANDLE;
    }
    if (queryPool_ != VK_NULL_HANDLE) {
        vkDestroyQueryPool(context_.device, queryPool_, nullptr);
        queryPool_ = VK_NULL_HANDLE;
    }
    if (shadeShader_ != VK_NULL_HANDLE) {
        vkDestroyShaderModule(context_.device, shadeShader_, nullptr);
        shadeShader_ = VK_NULL_HANDLE;
    }
    if (clusterShader_ != VK_NULL_HANDLE) {
        vkDestroyShaderModule(context_.device, clusterShader_, nullptr);
        clusterShader_ = VK_NULL_HANDLE;
    }
    if (shadePipeline_ != VK_NULL_HANDLE) {
        vkDestroyPipeline(context_.device, shadePipeline_, nullptr);
        shadePipeline_ = VK_NULL_HANDLE;
    }
    if (clusterPipeline_ != VK_NULL_HANDLE) {
        vkDestroyPipeline(context_.device, clusterPipeline_, nullptr);
        clusterPipeline_ = VK_NULL_HANDLE;
    }
    if (pipelineLayout_ != VK_NULL_HANDLE) {
        vkDestroyPipelineLayout(context_.device, pipelineLayout_, nullptr);
        pipelineLayout_ = VK_NULL_HANDLE;
    }
    if (descriptorPool_ != VK_NULL_HANDLE) {
        vkDestroyDescriptorPool(context_.device, descriptorPool_, nullptr);
        descriptorPool_ = VK_NULL_HANDLE;
    }
    if (descriptorSetLayout_ != VK_NULL_HANDLE) {
        vkDestroyDescriptorSetLayout(
            context_.device, descriptorSetLayout_, nullptr);
        descriptorSetLayout_ = VK_NULL_HANDLE;
    }
}





