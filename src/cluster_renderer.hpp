#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include <glm/glm.hpp>
#include <vulkan/vulkan.h>

#include "types.hpp"
#include "vulkan_context.hpp"

class ClusterRenderer {
public:
    ClusterRenderer(VulkanContext& context, Config config);
    ~ClusterRenderer();

    ClusterRenderer(const ClusterRenderer&) = delete;
    ClusterRenderer& operator=(const ClusterRenderer&) = delete;

    void run();
    bool verificationPassed() const { return verification_.passed; }

private:
    struct Camera {
        glm::mat4 view;
        glm::mat4 inverseView;
        glm::vec3 position;
    };

    void initialize();
    void createDescriptorLayout();
    void createPipelines();
    void createResources();
    void createQueriesAndCommands();
    void generateLights();
    Camera cameraAt(uint32_t frameIndex, uint32_t totalFrames) const;
    FrameData makeFrameData(const Camera& camera) const;
    void recordFrame(uint32_t frameIndex, uint32_t totalFrames);
    FrameTiming readTimings() const;
    CounterSnapshot readCounters() const;
    void readOutput(const Buffer& buffer, std::vector<float>& output) const;
    VerificationStats verifyOutputs(
        const std::vector<float>& clustered,
        const std::vector<float>& bruteForce) const;
    void writeImages(
        const std::vector<float>& clustered,
        const std::vector<float>& bruteForce,
        const VerificationStats& verification) const;
    void writeReport(
        const std::vector<FrameTiming>& timings,
        const std::vector<CounterSnapshot>& counters,
        const VerificationStats& verification) const;
    void savePixels(
        const std::string& path,
        const std::vector<float>& pixels,
        bool difference) const;
    void destroy();

    VulkanContext& context_;
    Config config_;
    uint32_t tilesX_ = 0;
    uint32_t tilesY_ = 0;
    uint32_t depthSlices_ = 0;
    uint32_t clusterCount_ = 0;

    VkDescriptorSetLayout descriptorSetLayout_ = VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline clusterPipeline_ = VK_NULL_HANDLE;
    VkPipeline shadePipeline_ = VK_NULL_HANDLE;
    VkDescriptorPool descriptorPool_ = VK_NULL_HANDLE;
    VkDescriptorSet clusteredSet_ = VK_NULL_HANDLE;
    VkDescriptorSet bruteForceSet_ = VK_NULL_HANDLE;
    VkShaderModule clusterShader_ = VK_NULL_HANDLE;
    VkShaderModule shadeShader_ = VK_NULL_HANDLE;
    VkQueryPool queryPool_ = VK_NULL_HANDLE;
    VkCommandBuffer commandBuffer_ = VK_NULL_HANDLE;
    VkFence fence_ = VK_NULL_HANDLE;

    Buffer frameUniform_;
    Buffer lightBuffer_;
    Buffer clusterCountBuffer_;
    Buffer clusterLightBuffer_;
    Buffer counterBuffer_;
    Buffer clusteredOutput_;
    Buffer bruteForceOutput_;

    std::vector<GpuLight> lights_;
    std::vector<CounterSnapshot> snapshots_;
    std::vector<FrameTiming> timings_;
    VerificationStats verification_{};
};


