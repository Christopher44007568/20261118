#pragma once

#include <cstdint>
#include <vector>

#include <vulkan/vulkan.h>

constexpr uint32_t kInstanceCount = 10000;
constexpr uint32_t kCubeIndexCount = 36;
constexpr uint32_t kMaxFrames = 2;

// Must match the InstanceData struct in the shaders.
struct InstanceData {
    float center[4]; // xyz center, w radius
    float color[4];
};

// std140-friendly UBO matching CullParams in the shaders.
struct CullParamsUBO {
    float viewProj[16];
    float frustumPlanes[6][4];
    uint32_t totalInstances;
    uint32_t gpuCullingEnabled;
    uint32_t pad0;
    uint32_t pad1;
};

struct CameraState {
    float eye[3];
    float target[3];
    float up[3];
    float fovYRad;
    float aspect;
    float zNear;
    float zFar;
};

struct CpuVisibility {
    std::vector<uint32_t> visibleIndices;
};

// CPU-side reference frustum culler, independent of the GPU implementation.
CpuVisibility cullOnCpu(const std::vector<InstanceData>& instances,
                        const CameraState& camera);

// Vulkan context owning device, queues and all resources used by the demo.
struct VulkanContext {
    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    uint32_t queueFamily = 0;
    VkQueue queue = VK_NULL_HANDLE;
    VkCommandPool commandPool = VK_NULL_HANDLE;

    VkDescriptorSetLayout descriptorSetLayout = VK_NULL_HANDLE;
    VkPipelineLayout computePipelineLayout = VK_NULL_HANDLE;
    VkPipeline computePipeline = VK_NULL_HANDLE;
    VkPipelineLayout graphicsPipelineLayout = VK_NULL_HANDLE;
    VkPipeline graphicsPipeline = VK_NULL_HANDLE;
    VkDescriptorPool descriptorPool = VK_NULL_HANDLE;
    VkDescriptorSet descriptorSet = VK_NULL_HANDLE;

    VkBuffer instanceBuffer = VK_NULL_HANDLE;
    VkDeviceMemory instanceMemory = VK_NULL_HANDLE;
    VkBuffer visibleIndexBuffer = VK_NULL_HANDLE;
    VkDeviceMemory visibleIndexMemory = VK_NULL_HANDLE;
    VkBuffer indirectBuffer = VK_NULL_HANDLE;
    VkDeviceMemory indirectMemory = VK_NULL_HANDLE;
    VkBuffer uboBuffer = VK_NULL_HANDLE;
    VkDeviceMemory uboMemory = VK_NULL_HANDLE;
    VkBuffer vertexBuffer = VK_NULL_HANDLE;
    VkDeviceMemory vertexMemory = VK_NULL_HANDLE;
    VkBuffer indexBuffer = VK_NULL_HANDLE;
    VkDeviceMemory indexMemory = VK_NULL_HANDLE;

    VkImage colorImage = VK_NULL_HANDLE;
    VkDeviceMemory colorMemory = VK_NULL_HANDLE;
    VkImageView colorView = VK_NULL_HANDLE;
    VkImage depthImage = VK_NULL_HANDLE;
    VkDeviceMemory depthMemory = VK_NULL_HANDLE;
    VkImageView depthView = VK_NULL_HANDLE;
    VkRenderPass renderPass = VK_NULL_HANDLE;
    VkFramebuffer framebuffer = VK_NULL_HANDLE;

    VkQueryPool timestampPool = VK_NULL_HANDLE;
    bool timestampSupported = false;
    float timestampPeriodNs = 0.0f;

    uint32_t renderWidth = 1280;
    uint32_t renderHeight = 720;
};

void vkInit(VulkanContext& ctx);
void vkDestroy(VulkanContext& ctx);

void uploadInstancesOnce(VulkanContext& ctx,
                         const std::vector<InstanceData>& instances);

struct FrameResult {
    uint32_t visibleCount = 0;
    std::vector<uint32_t> visibleIndices;
    float cullGpuTimeMs = 0.0f;
    float drawGpuTimeMs = 0.0f;
    float frameGpuTimeMs = 0.0f;
};

// Runs one frame: updates only the UBO + indirect counter reset, dispatches the
// culling compute shader, then executes the indirect draw. The instance array
// is never re-uploaded.
FrameResult runFrame(VulkanContext& ctx, const CameraState& camera,
                     bool gpuCullingEnabled, bool readBackIndices,
                     const char* label);

VkCommandBuffer beginOneShot(VulkanContext& ctx);
void endAndSubmit(VulkanContext& ctx, VkCommandBuffer cmd);
