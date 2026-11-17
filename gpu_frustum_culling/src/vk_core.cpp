#include "shared.h"

#include <array>
#include <cassert>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace {

#define VK_CHECK(expr)                                                        \
    do {                                                                      \
        VkResult result_ = (expr);                                            \
        if (result_ != VK_SUCCESS) {                                          \
            throw std::runtime_error(std::string("Vulkan error ") +          \
                                     std::to_string(result_) + " at " +      \
                                     __FILE__ + ":" +                         \
                                     std::to_string(__LINE__));               \
        }                                                                     \
    } while (0)

uint32_t findMemoryType(VkPhysicalDevice phys, uint32_t typeBits,
                        VkMemoryPropertyFlags props) {
    VkPhysicalDeviceMemoryProperties memProps;
    vkGetPhysicalDeviceMemoryProperties(phys, &memProps);
    for (uint32_t i = 0; i < memProps.memoryTypeCount; ++i) {
        if ((typeBits & (1u << i)) &&
            (memProps.memoryTypes[i].propertyFlags & props) == props) {
            return i;
        }
    }
    // Relax to the host-visible/coherent subset when the exact combination
    // (e.g. DEVICE_LOCAL|HOST_VISIBLE) is not exposed.
    const VkMemoryPropertyFlags relaxed =
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
        VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
    for (uint32_t i = 0; i < memProps.memoryTypeCount; ++i) {
        if ((typeBits & (1u << i)) &&
            (memProps.memoryTypes[i].propertyFlags & relaxed) == relaxed) {
            return i;
        }
    }
    throw std::runtime_error("no suitable memory type");
}

VkDeviceMemory allocateMemory(VulkanContext& ctx, VkMemoryRequirements req,
                              VkMemoryPropertyFlags props) {
    VkMemoryAllocateInfo info{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    info.allocationSize = req.size;
    info.memoryTypeIndex = findMemoryType(ctx.physicalDevice,
                                          req.memoryTypeBits, props);
    VkDeviceMemory memory = VK_NULL_HANDLE;
    VK_CHECK(vkAllocateMemory(ctx.device, &info, nullptr, &memory));
    return memory;
}

struct Buffer {
    VkBuffer handle = VK_NULL_HANDLE;
    VkDeviceMemory memory = VK_NULL_HANDLE;
};

Buffer createBuffer(VulkanContext& ctx, VkDeviceSize size,
                    VkBufferUsageFlags usage, VkMemoryPropertyFlags props) {
    Buffer buffer;
    VkBufferCreateInfo info{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    info.size = size;
    info.usage = usage;
    info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VK_CHECK(vkCreateBuffer(ctx.device, &info, nullptr, &buffer.handle));
    VkMemoryRequirements req;
    vkGetBufferMemoryRequirements(ctx.device, buffer.handle, &req);
    buffer.memory = allocateMemory(ctx, req, props);
    vkBindBufferMemory(ctx.device, buffer.handle, buffer.memory, 0);
    return buffer;
}

void copyBuffer(VulkanContext& ctx, VkBuffer src, VkBuffer dst,
                VkDeviceSize size) {
    VkCommandBuffer cmd = beginOneShot(ctx);
    VkBufferCopy region{};
    region.size = size;
    vkCmdCopyBuffer(cmd, src, dst, 1, &region);
    endAndSubmit(ctx, cmd);
}

std::vector<char> readSpv(const char* path) {
    std::ifstream file(path, std::ios::ate | std::ios::binary);
    if (!file) {
        throw std::runtime_error(std::string("missing shader: ") + path);
    }
    const size_t size = static_cast<size_t>(file.tellg());
    std::vector<char> data(size);
    file.seekg(0);
    file.read(data.data(), size);
    return data;
}

VkShaderModule makeShader(VulkanContext& ctx, const std::vector<char>& spv) {
    VkShaderModuleCreateInfo info{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    info.codeSize = spv.size();
    info.pCode = reinterpret_cast<const uint32_t*>(spv.data());
    VkShaderModule module = VK_NULL_HANDLE;
    VK_CHECK(vkCreateShaderModule(ctx.device, &info, nullptr, &module));
    return module;
}

struct CubeVertex {
    float position[3];
    float normal[3];
};

const std::array<CubeVertex, 24> kCubeVertices = {{
    {{-0.5f, -0.5f, 0.5f}, {0, 0, 1}},  {{0.5f, -0.5f, 0.5f}, {0, 0, 1}},
    {{0.5f, 0.5f, 0.5f}, {0, 0, 1}},    {{-0.5f, 0.5f, 0.5f}, {0, 0, 1}},
    {{0.5f, -0.5f, -0.5f}, {0, 0, -1}}, {{-0.5f, -0.5f, -0.5f}, {0, 0, -1}},
    {{-0.5f, 0.5f, -0.5f}, {0, 0, -1}}, {{0.5f, 0.5f, -0.5f}, {0, 0, -1}},
    {{-0.5f, 0.5f, 0.5f}, {0, 1, 0}},   {{0.5f, 0.5f, 0.5f}, {0, 1, 0}},
    {{0.5f, 0.5f, -0.5f}, {0, 1, 0}},   {{-0.5f, 0.5f, -0.5f}, {0, 1, 0}},
    {{-0.5f, -0.5f, -0.5f}, {0, -1, 0}},{{0.5f, -0.5f, -0.5f}, {0, -1, 0}},
    {{0.5f, -0.5f, 0.5f}, {0, -1, 0}},  {{-0.5f, -0.5f, 0.5f}, {0, -1, 0}},
    {{0.5f, -0.5f, 0.5f}, {1, 0, 0}},   {{0.5f, -0.5f, -0.5f}, {1, 0, 0}},
    {{0.5f, 0.5f, -0.5f}, {1, 0, 0}},   {{0.5f, 0.5f, 0.5f}, {1, 0, 0}},
    {{-0.5f, -0.5f, -0.5f}, {-1, 0, 0}},{{-0.5f, -0.5f, 0.5f}, {-1, 0, 0}},
    {{-0.5f, 0.5f, 0.5f}, {-1, 0, 0}},  {{-0.5f, 0.5f, -0.5f}, {-1, 0, 0}},
}};

const std::array<uint16_t, kCubeIndexCount> kCubeIndices = {{
    0, 1, 2, 0, 2, 3,      // front
    4, 5, 6, 4, 6, 7,      // back
    8, 9, 10, 8, 10, 11,   // top
    12, 13, 14, 12, 14, 15,// bottom
    16, 17, 18, 16, 18, 19,// right
    20, 21, 22, 20, 22, 23 // left
}};

} // namespace

// buildUbo is defined below in this translation unit.
CullParamsUBO buildUbo(const CameraState& camera, bool gpuCullingEnabled);

FrameResult runFrame(VulkanContext& ctx, const CameraState& camera,
                     bool gpuCullingEnabled, bool readBackIndices,
                     const char* label) {
    (void)label;
    const CullParamsUBO ubo = buildUbo(camera, gpuCullingEnabled);
    void* uboMapped = nullptr;
    vkMapMemory(ctx.device, ctx.uboMemory, 0, sizeof(ubo), 0, &uboMapped);
    std::memcpy(uboMapped, &ubo, sizeof(ubo));
    vkUnmapMemory(ctx.device, ctx.uboMemory);

    VkCommandBuffer cmd = beginOneShot(ctx);

    if (ctx.timestampSupported) {
        vkCmdResetQueryPool(cmd, ctx.timestampPool, 0, 4);
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                            ctx.timestampPool, 0);
    }

    // Per-frame work: reset only the indirect counter; the instance array is
    // never touched. indexCount/firstIndex/vertexOffset/firstInstance are
    // restored because vkCmdFillBuffer zeros the whole command struct slot
    // (we fill only the instanceCount dword below instead, see note).
    const uint32_t zero = 0u;
    vkCmdFillBuffer(cmd, ctx.indirectBuffer,
                    offsetof(VkDrawIndexedIndirectCommand, instanceCount),
                    sizeof(uint32_t), zero);
    VkBufferMemoryBarrier fillBarrier{
        VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
    fillBarrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    fillBarrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT |
                                VK_ACCESS_SHADER_WRITE_BIT;
    fillBarrier.buffer = ctx.indirectBuffer;
    fillBarrier.size = VK_WHOLE_SIZE;
    vkCmdPipelineBarrier(
        cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0, nullptr, 1,
        &fillBarrier, 0, nullptr);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                      ctx.computePipeline);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            ctx.computePipelineLayout, 0, 1,
                            &ctx.descriptorSet, 0, nullptr);
    const uint32_t groups =
        (kInstanceCount + 255u) / 256u;
    vkCmdDispatch(cmd, groups, 1, 1);

    if (ctx.timestampSupported) {
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                            ctx.timestampPool, 1);
    }

    // Compute writes -> indirect draw / vertex shader reads.
    VkBufferMemoryBarrier cullBarrier{
        VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
    cullBarrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    cullBarrier.dstAccessMask = VK_ACCESS_INDIRECT_COMMAND_READ_BIT |
                                VK_ACCESS_SHADER_READ_BIT;
    cullBarrier.buffer = ctx.indirectBuffer;
    cullBarrier.size = VK_WHOLE_SIZE;
    VkBufferMemoryBarrier indexBarrier{
        VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
    indexBarrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    indexBarrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    indexBarrier.buffer = ctx.visibleIndexBuffer;
    indexBarrier.size = VK_WHOLE_SIZE;
    VkBufferMemoryBarrier barriers[2] = {cullBarrier, indexBarrier};
    vkCmdPipelineBarrier(
        cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT |
            VK_PIPELINE_STAGE_VERTEX_SHADER_BIT,
        0, 0, nullptr, 2, barriers, 0, nullptr);

    VkClearValue clears[2]{};
    clears[0].color = {{0.05f, 0.06f, 0.09f, 1.0f}};
    clears[1].depthStencil = {1.0f, 0};
    VkRenderPassBeginInfo rpBegin{
        VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    rpBegin.renderPass = ctx.renderPass;
    rpBegin.framebuffer = ctx.framebuffer;
    rpBegin.renderArea.extent = {ctx.renderWidth, ctx.renderHeight};
    rpBegin.clearValueCount = 2;
    rpBegin.pClearValues = clears;
    vkCmdBeginRenderPass(cmd, &rpBegin, VK_SUBPASS_CONTENTS_INLINE);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                      ctx.graphicsPipeline);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                            ctx.graphicsPipelineLayout, 0, 1,
                            &ctx.descriptorSet, 0, nullptr);
    VkDeviceSize vertexOffset = 0;
    vkCmdBindVertexBuffers(cmd, 0, 1, &ctx.vertexBuffer, &vertexOffset);
    vkCmdBindIndexBuffer(cmd, ctx.indexBuffer, 0,
                         VK_INDEX_TYPE_UINT16);

    // Zero visible instances: instanceCount == 0 is a valid no-op indirect
    // draw in Vulkan (the command is simply skipped), so no special-casing or
    // validation error is possible here.
    vkCmdDrawIndexedIndirect(cmd, ctx.indirectBuffer, 0, 1,
                             sizeof(VkDrawIndexedIndirectCommand));

    vkCmdEndRenderPass(cmd);

    if (ctx.timestampSupported) {
        vkCmdWriteTimestamp(cmd,
                            VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
                            ctx.timestampPool, 2);
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT,
                            ctx.timestampPool, 3);
    }
    endAndSubmit(ctx, cmd);

    FrameResult result;
    uint64_t timestamps[4]{};
    if (ctx.timestampSupported) {
        vkGetQueryPoolResults(
            ctx.device, ctx.timestampPool, 0, 4, sizeof(timestamps),
            timestamps, sizeof(uint64_t),
            VK_QUERY_RESULT_64_BIT | VK_QUERY_RESULT_WAIT_BIT);
        auto ms = [&](uint64_t a, uint64_t b) {
            return static_cast<float>(
                       static_cast<double>(timestamps[b] - timestamps[a]) *
                       ctx.timestampPeriodNs / 1.0e6);
        };
        result.cullGpuTimeMs = ms(0, 1);
        result.drawGpuTimeMs = ms(1, 2);
        result.frameGpuTimeMs = ms(0, 3);
    }

    VkDrawIndexedIndirectCommand indirect{};
    void* indirectMapped = nullptr;
    vkMapMemory(ctx.device, ctx.indirectMemory, 0, sizeof(indirect), 0,
                &indirectMapped);
    std::memcpy(&indirect, indirectMapped, sizeof(indirect));
    vkUnmapMemory(ctx.device, ctx.indirectMemory);
    result.visibleCount = indirect.instanceCount;

    if (readBackIndices && result.visibleCount > 0) {
        const VkDeviceSize bytes =
            sizeof(uint32_t) * result.visibleCount;
        Buffer readback = createBuffer(
            ctx, bytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT,
            VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
        VkCommandBuffer copyCmd = beginOneShot(ctx);
        VkBufferCopy region{};
        region.size = bytes;
        vkCmdCopyBuffer(copyCmd, ctx.visibleIndexBuffer,
                        readback.handle, 1, &region);
        endAndSubmit(ctx, copyCmd);
        void* data = nullptr;
        vkMapMemory(ctx.device, readback.memory, 0, bytes, 0, &data);
        result.visibleIndices.resize(result.visibleCount);
        std::memcpy(result.visibleIndices.data(), data, bytes);
        vkUnmapMemory(ctx.device, readback.memory);
        vkDestroyBuffer(ctx.device, readback.handle, nullptr);
        vkFreeMemory(ctx.device, readback.memory, nullptr);
    }
    return result;
}

void vkDestroy(VulkanContext& ctx) {
    if (ctx.device == VK_NULL_HANDLE) {
        return;
    }
    vkDeviceWaitIdle(ctx.device);
    if (ctx.timestampPool != VK_NULL_HANDLE) {
        vkDestroyQueryPool(ctx.device, ctx.timestampPool, nullptr);
    }
    vkDestroyPipeline(ctx.device, ctx.graphicsPipeline, nullptr);
    vkDestroyPipeline(ctx.device, ctx.computePipeline, nullptr);
    vkDestroyPipelineLayout(ctx.device, ctx.graphicsPipelineLayout, nullptr);
    vkDestroyPipelineLayout(ctx.device, ctx.computePipelineLayout, nullptr);
    vkDestroyDescriptorPool(ctx.device, ctx.descriptorPool, nullptr);
    vkDestroyDescriptorSetLayout(ctx.device, ctx.descriptorSetLayout,
                                 nullptr);
    vkDestroyFramebuffer(ctx.device, ctx.framebuffer, nullptr);
    vkDestroyRenderPass(ctx.device, ctx.renderPass, nullptr);
    vkDestroyImageView(ctx.device, ctx.depthView, nullptr);
    vkDestroyImageView(ctx.device, ctx.colorView, nullptr);
    vkDestroyImage(ctx.device, ctx.depthImage, nullptr);
    vkDestroyImage(ctx.device, ctx.colorImage, nullptr);
    vkFreeMemory(ctx.device, ctx.depthMemory, nullptr);
    vkFreeMemory(ctx.device, ctx.colorMemory, nullptr);
    vkDestroyBuffer(ctx.device, ctx.indexBuffer, nullptr);
    vkDestroyBuffer(ctx.device, ctx.vertexBuffer, nullptr);
    vkDestroyBuffer(ctx.device, ctx.uboBuffer, nullptr);
    vkDestroyBuffer(ctx.device, ctx.indirectBuffer, nullptr);
    vkDestroyBuffer(ctx.device, ctx.visibleIndexBuffer, nullptr);
    vkDestroyBuffer(ctx.device, ctx.instanceBuffer, nullptr);
    vkFreeMemory(ctx.device, ctx.indexMemory, nullptr);
    vkFreeMemory(ctx.device, ctx.vertexMemory, nullptr);
    vkFreeMemory(ctx.device, ctx.uboMemory, nullptr);
    vkFreeMemory(ctx.device, ctx.indirectMemory, nullptr);
    vkFreeMemory(ctx.device, ctx.visibleIndexMemory, nullptr);
    vkFreeMemory(ctx.device, ctx.instanceMemory, nullptr);
    vkDestroyCommandPool(ctx.device, ctx.commandPool, nullptr);
    vkDestroyDevice(ctx.device, nullptr);
    vkDestroyInstance(ctx.instance, nullptr);
}

VkCommandBuffer beginOneShot(VulkanContext& ctx) {
    VkCommandBufferAllocateInfo info{
        VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    info.commandPool = ctx.commandPool;
    info.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    info.commandBufferCount = 1;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    VK_CHECK(vkAllocateCommandBuffers(ctx.device, &info, &cmd));
    VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(cmd, &begin);
    return cmd;
}

void endAndSubmit(VulkanContext& ctx, VkCommandBuffer cmd) {
    vkEndCommandBuffer(cmd);
    VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &cmd;
    VK_CHECK(vkQueueSubmit(ctx.queue, 1, &submit, VK_NULL_HANDLE));
    vkQueueWaitIdle(ctx.queue);
    vkFreeCommandBuffers(ctx.device, ctx.commandPool, 1, &cmd);
}

void vkInit(VulkanContext& ctx) {
    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "gpu-frustum-culling";
    app.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
    app.pEngineName = "none";
    app.apiVersion = VK_API_VERSION_1_2;

    VkInstanceCreateInfo instanceInfo{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    instanceInfo.pApplicationInfo = &app;
    VK_CHECK(vkCreateInstance(&instanceInfo, nullptr, &ctx.instance));

    uint32_t deviceCount = 0;
    vkEnumeratePhysicalDevices(ctx.instance, &deviceCount, nullptr);
    if (deviceCount == 0) {
        throw std::runtime_error("no Vulkan physical device available");
    }
    std::vector<VkPhysicalDevice> devices(deviceCount);
    vkEnumeratePhysicalDevices(ctx.instance, &deviceCount, devices.data());

    for (VkPhysicalDevice device : devices) {
        uint32_t familyCount = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(device, &familyCount,
                                                 nullptr);
        std::vector<VkQueueFamilyProperties> families(familyCount);
        vkGetPhysicalDeviceQueueFamilyProperties(device, &familyCount,
                                                 families.data());
        for (uint32_t i = 0; i < familyCount; ++i) {
            const VkQueueFlags wanted =
                VK_QUEUE_COMPUTE_BIT | VK_QUEUE_GRAPHICS_BIT;
            if ((families[i].queueFlags & wanted) == wanted) {
                ctx.physicalDevice = device;
                ctx.queueFamily = i;
                break;
            }
        }
        if (ctx.physicalDevice != VK_NULL_HANDLE) {
            break;
        }
    }
    if (ctx.physicalDevice == VK_NULL_HANDLE) {
        throw std::runtime_error("no queue with compute+graphics support");
    }

    VkPhysicalDeviceProperties props;
    vkGetPhysicalDeviceProperties(ctx.physicalDevice, &props);
    std::cout << "[vk] device: " << props.deviceName
              << " (Vulkan " << VK_VERSION_MAJOR(props.apiVersion) << "."
              << VK_VERSION_MINOR(props.apiVersion) << ")\n";

    float priority = 1.0f;
    VkDeviceQueueCreateInfo queueInfo{
        VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    queueInfo.queueFamilyIndex = ctx.queueFamily;
    queueInfo.queueCount = 1;
    queueInfo.pQueuePriorities = &priority;

    VkDeviceCreateInfo deviceInfo{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    deviceInfo.queueCreateInfoCount = 1;
    deviceInfo.pQueueCreateInfos = &queueInfo;
    VK_CHECK(vkCreateDevice(ctx.physicalDevice, &deviceInfo, nullptr,
                            &ctx.device));
    vkGetDeviceQueue(ctx.device, ctx.queueFamily, 0, &ctx.queue);

    VkCommandPoolCreateInfo poolInfo{
        VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    poolInfo.queueFamilyIndex = ctx.queueFamily;
    poolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    VK_CHECK(vkCreateCommandPool(ctx.device, &poolInfo, nullptr,
                                 &ctx.commandPool));

    VkQueryPoolCreateInfo queryInfo{
        VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO};
    queryInfo.queryType = VK_QUERY_TYPE_TIMESTAMP;
    queryInfo.queryCount = 4;
    VkResult qr = vkCreateQueryPool(ctx.device, &queryInfo, nullptr,
                                    &ctx.timestampPool);
    ctx.timestampSupported =
        (qr == VK_SUCCESS &&
         props.limits.timestampComputeAndGraphics != VK_FALSE);
    if (ctx.timestampSupported) {
        ctx.timestampPeriodNs = props.limits.timestampPeriod;
    } else {
        ctx.timestampPool = VK_NULL_HANDLE;
        std::cout << "[vk] timestamp queries unsupported; timing skipped\n";
    }

    const VkDeviceSize instanceBytes =
        sizeof(InstanceData) * kInstanceCount;
    const VkDeviceSize indexBytes =
        sizeof(uint32_t) * kInstanceCount;

    Buffer instances = createBuffer(
        ctx, instanceBytes,
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
            VK_BUFFER_USAGE_TRANSFER_DST_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    ctx.instanceBuffer = instances.handle;
    ctx.instanceMemory = instances.memory;

    Buffer visible = createBuffer(
        ctx, indexBytes,
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
            VK_BUFFER_USAGE_TRANSFER_DST_BIT |
            VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    ctx.visibleIndexBuffer = visible.handle;
    ctx.visibleIndexMemory = visible.memory;

    Buffer indirect = createBuffer(
        ctx, sizeof(VkDrawIndexedIndirectCommand),
        VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT |
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
            VK_BUFFER_USAGE_TRANSFER_DST_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    ctx.indirectBuffer = indirect.handle;
    ctx.indirectMemory = indirect.memory;
    // Static indirect-command fields are written once. At frame time only the
    // instanceCount dword is reset and repopulated by the compute shader.
    VkDrawIndexedIndirectCommand initialCommand{};
    initialCommand.indexCount = kCubeIndexCount;
    initialCommand.instanceCount = 0;
    initialCommand.firstIndex = 0;
    initialCommand.vertexOffset = 0;
    initialCommand.firstInstance = 0;
    void* indirectMapped = nullptr;
    if (vkMapMemory(ctx.device, ctx.indirectMemory, 0,
                    sizeof(initialCommand), 0,
                    &indirectMapped) == VK_SUCCESS) {
        std::memcpy(indirectMapped, &initialCommand,
                    sizeof(initialCommand));
        vkUnmapMemory(ctx.device, ctx.indirectMemory);
    } else {
        Buffer commandStaging = createBuffer(
            ctx, sizeof(initialCommand),
            VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
            VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
        void* stagingMapped = nullptr;
        vkMapMemory(ctx.device, commandStaging.memory, 0,
                    sizeof(initialCommand), 0, &stagingMapped);
        std::memcpy(stagingMapped, &initialCommand,
                    sizeof(initialCommand));
        vkUnmapMemory(ctx.device, commandStaging.memory);
        copyBuffer(ctx, commandStaging.handle, ctx.indirectBuffer,
                   sizeof(initialCommand));
        vkDestroyBuffer(ctx.device, commandStaging.handle, nullptr);
        vkFreeMemory(ctx.device, commandStaging.memory, nullptr);
    }

    Buffer ubo = createBuffer(
        ctx, sizeof(CullParamsUBO),
        VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT |
            VK_BUFFER_USAGE_TRANSFER_DST_BIT,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
            VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    ctx.uboBuffer = ubo.handle;
    ctx.uboMemory = ubo.memory;

    Buffer staging = createBuffer(
        ctx, sizeof(kCubeVertices) + sizeof(kCubeIndices),
        VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
            VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    void* mapped = nullptr;
    vkMapMemory(ctx.device, staging.memory, 0, VK_WHOLE_SIZE, 0, &mapped);
    std::memcpy(mapped, kCubeVertices.data(), sizeof(kCubeVertices));
    std::memcpy(static_cast<char*>(mapped) + sizeof(kCubeVertices),
                kCubeIndices.data(), sizeof(kCubeIndices));
    vkUnmapMemory(ctx.device, staging.memory);

    Buffer vertices = createBuffer(
        ctx, sizeof(kCubeVertices),
        VK_BUFFER_USAGE_VERTEX_BUFFER_BIT |
            VK_BUFFER_USAGE_TRANSFER_DST_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    ctx.vertexBuffer = vertices.handle;
    ctx.vertexMemory = vertices.memory;
    copyBuffer(ctx, staging.handle, ctx.vertexBuffer,
               sizeof(kCubeVertices));

    Buffer indices = createBuffer(
        ctx, sizeof(kCubeIndices),
        VK_BUFFER_USAGE_INDEX_BUFFER_BIT |
            VK_BUFFER_USAGE_TRANSFER_DST_BIT,
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    ctx.indexBuffer = indices.handle;
    ctx.indexMemory = indices.memory;
    VkCommandBuffer geomCmd = beginOneShot(ctx);
    VkBufferCopy indexCopy{};
    indexCopy.srcOffset = sizeof(kCubeVertices);
    indexCopy.size = sizeof(kCubeIndices);
    vkCmdCopyBuffer(geomCmd, staging.handle, ctx.indexBuffer, 1,
                    &indexCopy);
    endAndSubmit(ctx, geomCmd);
    vkDestroyBuffer(ctx.device, staging.handle, nullptr);
    vkFreeMemory(ctx.device, staging.memory, nullptr);

    VkImageCreateInfo colorInfo{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    colorInfo.imageType = VK_IMAGE_TYPE_2D;
    colorInfo.format = VK_FORMAT_R8G8B8A8_UNORM;
    colorInfo.extent = {ctx.renderWidth, ctx.renderHeight, 1};
    colorInfo.mipLevels = 1;
    colorInfo.arrayLayers = 1;
    colorInfo.samples = VK_SAMPLE_COUNT_1_BIT;
    colorInfo.tiling = VK_IMAGE_TILING_OPTIMAL;
    colorInfo.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT |
                      VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
    colorInfo.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    VK_CHECK(vkCreateImage(ctx.device, &colorInfo, nullptr, &ctx.colorImage));
    VkMemoryRequirements colorReq;
    vkGetImageMemoryRequirements(ctx.device, ctx.colorImage, &colorReq);
    ctx.colorMemory = allocateMemory(
        ctx, colorReq, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    vkBindImageMemory(ctx.device, ctx.colorImage, ctx.colorMemory, 0);
    VkImageViewCreateInfo colorViewInfo{
        VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    colorViewInfo.image = ctx.colorImage;
    colorViewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
    colorViewInfo.format = VK_FORMAT_R8G8B8A8_UNORM;
    colorViewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    VK_CHECK(vkCreateImageView(ctx.device, &colorViewInfo, nullptr,
                               &ctx.colorView));

    VkImageCreateInfo depthInfo{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    depthInfo.imageType = VK_IMAGE_TYPE_2D;
    depthInfo.format = VK_FORMAT_D32_SFLOAT;
    depthInfo.extent = {ctx.renderWidth, ctx.renderHeight, 1};
    depthInfo.mipLevels = 1;
    depthInfo.arrayLayers = 1;
    depthInfo.samples = VK_SAMPLE_COUNT_1_BIT;
    depthInfo.tiling = VK_IMAGE_TILING_OPTIMAL;
    depthInfo.usage = VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
    depthInfo.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    VK_CHECK(vkCreateImage(ctx.device, &depthInfo, nullptr, &ctx.depthImage));
    VkMemoryRequirements depthReq;
    vkGetImageMemoryRequirements(ctx.device, ctx.depthImage, &depthReq);
    ctx.depthMemory = allocateMemory(
        ctx, depthReq, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    vkBindImageMemory(ctx.device, ctx.depthImage, ctx.depthMemory, 0);
    VkImageViewCreateInfo depthViewInfo{
        VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    depthViewInfo.image = ctx.depthImage;
    depthViewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
    depthViewInfo.format = VK_FORMAT_D32_SFLOAT;
    depthViewInfo.subresourceRange = {VK_IMAGE_ASPECT_DEPTH_BIT, 0, 1, 0, 1};
    VK_CHECK(vkCreateImageView(ctx.device, &depthViewInfo, nullptr,
                               &ctx.depthView));

    VkAttachmentDescription attachments[2]{};
    attachments[0].format = VK_FORMAT_R8G8B8A8_UNORM;
    attachments[0].samples = VK_SAMPLE_COUNT_1_BIT;
    attachments[0].loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    attachments[0].storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    attachments[0].initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    attachments[0].finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    attachments[1].format = VK_FORMAT_D32_SFLOAT;
    attachments[1].samples = VK_SAMPLE_COUNT_1_BIT;
    attachments[1].loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    attachments[1].storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    attachments[1].initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    attachments[1].finalLayout =
        VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;
    VkAttachmentReference colorRef{0,
                                  VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkAttachmentReference depthRef{
        1, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
    VkSubpassDescription subpass{};
    subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    subpass.colorAttachmentCount = 1;
    subpass.pColorAttachments = &colorRef;
    subpass.pDepthStencilAttachment = &depthRef;
    VkRenderPassCreateInfo rpInfo{
        VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
    rpInfo.attachmentCount = 2;
    rpInfo.pAttachments = attachments;
    rpInfo.subpassCount = 1;
    rpInfo.pSubpasses = &subpass;
    VK_CHECK(vkCreateRenderPass(ctx.device, &rpInfo, nullptr,
                                &ctx.renderPass));

    VkFramebufferCreateInfo fbInfo{
        VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
    VkImageView views[2] = {ctx.colorView, ctx.depthView};
    fbInfo.renderPass = ctx.renderPass;
    fbInfo.attachmentCount = 2;
    fbInfo.pAttachments = views;
    fbInfo.width = ctx.renderWidth;
    fbInfo.height = ctx.renderHeight;
    fbInfo.layers = 1;
    VK_CHECK(vkCreateFramebuffer(ctx.device, &fbInfo, nullptr,
                                 &ctx.framebuffer));

    VkDescriptorSetLayoutBinding bindings[4]{};
    bindings[0].binding = 0;
    bindings[0].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[0].descriptorCount = 1;
    bindings[0].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT |
                             VK_SHADER_STAGE_VERTEX_BIT;
    bindings[1].binding = 1;
    bindings[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[1].descriptorCount = 1;
    bindings[1].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT |
                             VK_SHADER_STAGE_VERTEX_BIT;
    bindings[2].binding = 2;
    bindings[2].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[2].descriptorCount = 1;
    bindings[2].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    bindings[3].binding = 3;
    bindings[3].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    bindings[3].descriptorCount = 1;
    bindings[3].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT |
                             VK_SHADER_STAGE_VERTEX_BIT;
    VkDescriptorSetLayoutCreateInfo layoutInfo{
        VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    layoutInfo.bindingCount = 4;
    layoutInfo.pBindings = bindings;
    VK_CHECK(vkCreateDescriptorSetLayout(ctx.device, &layoutInfo, nullptr,
                                         &ctx.descriptorSetLayout));

    VkPipelineLayoutCreateInfo plInfo{
        VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    plInfo.setLayoutCount = 1;
    plInfo.pSetLayouts = &ctx.descriptorSetLayout;
    VK_CHECK(vkCreatePipelineLayout(ctx.device, &plInfo, nullptr,
                                    &ctx.computePipelineLayout));
    VK_CHECK(vkCreatePipelineLayout(ctx.device, &plInfo, nullptr,
                                    &ctx.graphicsPipelineLayout));

    auto cullSpv = readSpv("shaders/cull.comp.spv");
    VkShaderModule cullModule = makeShader(ctx, cullSpv);
    VkComputePipelineCreateInfo compInfo{
        VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    compInfo.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    compInfo.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    compInfo.stage.module = cullModule;
    compInfo.stage.pName = "main";
    compInfo.layout = ctx.computePipelineLayout;
    VK_CHECK(vkCreateComputePipelines(
        ctx.device, VK_NULL_HANDLE, 1, &compInfo, nullptr,
        &ctx.computePipeline));
    vkDestroyShaderModule(ctx.device, cullModule, nullptr);

    auto vertSpv = readSpv("shaders/cube.vert.spv");
    auto fragSpv = readSpv("shaders/cube.frag.spv");
    VkShaderModule vertModule = makeShader(ctx, vertSpv);
    VkShaderModule fragModule = makeShader(ctx, fragSpv);
    VkPipelineShaderStageCreateInfo stages[2]{
        {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO},
        {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO}};
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vertModule;
    stages[0].pName = "main";
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = fragModule;
    stages[1].pName = "main";

    VkVertexInputBindingDescription vertexBinding{};
    vertexBinding.binding = 0;
    vertexBinding.stride = sizeof(CubeVertex);
    vertexBinding.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
    VkVertexInputAttributeDescription attributes[2]{};
    attributes[0].location = 0;
    attributes[0].binding = 0;
    attributes[0].format = VK_FORMAT_R32G32B32_SFLOAT;
    attributes[0].offset = offsetof(CubeVertex, position);
    attributes[1].location = 1;
    attributes[1].binding = 0;
    attributes[1].format = VK_FORMAT_R32G32B32_SFLOAT;
    attributes[1].offset = offsetof(CubeVertex, normal);
    VkPipelineVertexInputStateCreateInfo vertexInput{
        VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
    vertexInput.vertexBindingDescriptionCount = 1;
    vertexInput.pVertexBindingDescriptions = &vertexBinding;
    vertexInput.vertexAttributeDescriptionCount = 2;
    vertexInput.pVertexAttributeDescriptions = attributes;

    VkPipelineInputAssemblyStateCreateInfo assembly{
        VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
    assembly.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
    VkViewport viewport{0, 0, static_cast<float>(ctx.renderWidth),
                        static_cast<float>(ctx.renderHeight), 0, 1};
    VkRect2D scissor{{0, 0}, {ctx.renderWidth, ctx.renderHeight}};
    VkPipelineViewportStateCreateInfo viewportState{
        VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
    viewportState.viewportCount = 1;
    viewportState.pViewports = &viewport;
    viewportState.scissorCount = 1;
    viewportState.pScissors = &scissor;
    VkPipelineRasterizationStateCreateInfo raster{
        VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
    raster.polygonMode = VK_POLYGON_MODE_FILL;
    raster.cullMode = VK_CULL_MODE_BACK_BIT;
    raster.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    raster.lineWidth = 1.0f;
    VkPipelineMultisampleStateCreateInfo multisample{
        VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
    multisample.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
    VkPipelineDepthStencilStateCreateInfo depthState{
        VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
    depthState.depthTestEnable = VK_TRUE;
    depthState.depthWriteEnable = VK_TRUE;
    depthState.depthCompareOp = VK_COMPARE_OP_LESS;
    VkPipelineColorBlendAttachmentState blendAttachment{};
    blendAttachment.colorWriteMask = VK_COLOR_COMPONENT_R_BIT |
                                    VK_COLOR_COMPONENT_G_BIT |
                                    VK_COLOR_COMPONENT_B_BIT |
                                    VK_COLOR_COMPONENT_A_BIT;
    VkPipelineColorBlendStateCreateInfo blend{
        VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
    blend.attachmentCount = 1;
    blend.pAttachments = &blendAttachment;

    VkGraphicsPipelineCreateInfo graphicInfo{
        VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
    graphicInfo.stageCount = 2;
    graphicInfo.pStages = stages;
    graphicInfo.pVertexInputState = &vertexInput;
    graphicInfo.pInputAssemblyState = &assembly;
    graphicInfo.pViewportState = &viewportState;
    graphicInfo.pRasterizationState = &raster;
    graphicInfo.pMultisampleState = &multisample;
    graphicInfo.pDepthStencilState = &depthState;
    graphicInfo.pColorBlendState = &blend;
    graphicInfo.layout = ctx.graphicsPipelineLayout;
    graphicInfo.renderPass = ctx.renderPass;
    graphicInfo.subpass = 0;
    VK_CHECK(vkCreateGraphicsPipelines(
        ctx.device, VK_NULL_HANDLE, 1, &graphicInfo, nullptr,
        &ctx.graphicsPipeline));
    vkDestroyShaderModule(ctx.device, vertModule, nullptr);
    vkDestroyShaderModule(ctx.device, fragModule, nullptr);

    VkDescriptorPoolSize poolSizes[2]{};
    poolSizes[0].type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    poolSizes[0].descriptorCount = 3;
    poolSizes[1].type = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    poolSizes[1].descriptorCount = 1;
    VkDescriptorPoolCreateInfo descriptorPoolInfo{
        VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    descriptorPoolInfo.maxSets = 1;
    descriptorPoolInfo.poolSizeCount = 2;
    descriptorPoolInfo.pPoolSizes = poolSizes;
    VK_CHECK(vkCreateDescriptorPool(ctx.device, &descriptorPoolInfo,
                                    nullptr, &ctx.descriptorPool));
    VkDescriptorSetAllocateInfo setInfo{
        VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    setInfo.descriptorPool = ctx.descriptorPool;
    setInfo.descriptorSetCount = 1;
    setInfo.pSetLayouts = &ctx.descriptorSetLayout;
    VK_CHECK(vkAllocateDescriptorSets(ctx.device, &setInfo,
                                      &ctx.descriptorSet));

    VkDescriptorBufferInfo bufferInfos[4]{};
    bufferInfos[0].buffer = ctx.instanceBuffer;
    bufferInfos[0].range = instanceBytes;
    bufferInfos[1].buffer = ctx.visibleIndexBuffer;
    bufferInfos[1].range = indexBytes;
    bufferInfos[2].buffer = ctx.indirectBuffer;
    bufferInfos[2].range = sizeof(VkDrawIndexedIndirectCommand);
    bufferInfos[3].buffer = ctx.uboBuffer;
    bufferInfos[3].range = sizeof(CullParamsUBO);
    VkWriteDescriptorSet writes[4]{};
    for (uint32_t i = 0; i < 4; ++i) {
        writes[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[i].dstSet = ctx.descriptorSet;
        writes[i].dstBinding = i;
        writes[i].descriptorCount = 1;
        writes[i].descriptorType =
            i == 3 ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER
                   : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[i].pBufferInfo = &bufferInfos[i];
    }
    vkUpdateDescriptorSets(ctx.device, 4, writes, 0, nullptr);
}

void uploadInstancesOnce(VulkanContext& ctx,
                         const std::vector<InstanceData>& instances) {
    const VkDeviceSize bytes =
        sizeof(InstanceData) * instances.size();
    Buffer staging = createBuffer(
        ctx, bytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
            VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    void* mapped = nullptr;
    vkMapMemory(ctx.device, staging.memory, 0, bytes, 0, &mapped);
    std::memcpy(mapped, instances.data(), bytes);
    vkUnmapMemory(ctx.device, staging.memory);
    copyBuffer(ctx, staging.handle, ctx.instanceBuffer, bytes);
    vkDestroyBuffer(ctx.device, staging.handle, nullptr);
    vkFreeMemory(ctx.device, staging.memory, nullptr);
    std::cout << "[vk] uploaded " << instances.size()
              << " instances once (" << bytes << " bytes); subsequent camera "
                 "moves only update the UBO + visibility query\n";
}

struct Mat4f {
    float m[16]{};
};

Mat4f perspective(float fovY, float aspect, float zNear, float zFar) {
    Mat4f r;
    const float f = 1.0f / std::tan(fovY * 0.5f);
    r.m[0] = f / aspect;
    r.m[5] = f;
    r.m[10] = zFar / (zNear - zFar);
    r.m[11] = -1.0f;
    r.m[14] = (zNear * zFar) / (zNear - zFar);
    return r;
}

Mat4f lookAt(const CameraState& cam) {
    auto normalize = [](float x, float y, float z) {
        const float len = std::sqrt(x * x + y * y + z * z);
        return std::array<float, 3>{x / len, y / len, z / len};
    };
    const auto f = normalize(cam.eye[0] - cam.target[0],
                             cam.eye[1] - cam.target[1],
                             cam.eye[2] - cam.target[2]);
    const auto u = normalize(cam.up[0], cam.up[1], cam.up[2]);
    const float s[3] = {
        u[1] * f[2] - u[2] * f[1],
        u[2] * f[0] - u[0] * f[2],
        u[0] * f[1] - u[1] * f[0]};
    const float uu[3] = {
        f[1] * s[2] - f[2] * s[1],
        f[2] * s[0] - f[0] * s[2],
        f[0] * s[1] - f[1] * s[0]};
    Mat4f r;
    r.m[0] = s[0];
    r.m[4] = s[1];
    r.m[8] = s[2];
    r.m[1] = uu[0];
    r.m[5] = uu[1];
    r.m[9] = uu[2];
    r.m[2] = f[0];
    r.m[6] = f[1];
    r.m[10] = f[2];
    r.m[12] = -(s[0] * cam.eye[0] + s[1] * cam.eye[1] +
                 s[2] * cam.eye[2]);
    r.m[13] = -(uu[0] * cam.eye[0] + uu[1] * cam.eye[1] +
                 uu[2] * cam.eye[2]);
    r.m[14] = -(f[0] * cam.eye[0] + f[1] * cam.eye[1] +
                 f[2] * cam.eye[2]);
    r.m[15] = 1.0f;
    return r;
}

Mat4f multiply(const Mat4f& a, const Mat4f& b) {
    Mat4f r;
    for (int col = 0; col < 4; ++col) {
        for (int row = 0; row < 4; ++row) {
            float sum = 0.0f;
            for (int k = 0; k < 4; ++k) {
                sum += a.m[k * 4 + row] * b.m[col * 4 + k];
            }
            r.m[col * 4 + row] = sum;
        }
    }
    return r;
}

CullParamsUBO buildUbo(const CameraState& camera, bool gpuCullingEnabled) {
    const Mat4f view = lookAt(camera);
    const Mat4f proj = perspective(camera.fovYRad, camera.aspect,
                                   camera.zNear, camera.zFar);
    const Mat4f vp = multiply(proj, view);

    CullParamsUBO ubo{};
    std::memcpy(ubo.viewProj, vp.m, sizeof(vp.m));
    auto row = [&](int r, int c) { return vp.m[c * 4 + r]; };
    float planes[6][4];
    for (int c = 0; c < 4; ++c) {
        planes[0][c] = row(3, c) + row(0, c);
        planes[1][c] = row(3, c) - row(0, c);
        planes[2][c] = row(3, c) + row(1, c);
        planes[3][c] = row(3, c) - row(1, c);
        planes[4][c] = row(3, c) + row(2, c);
        planes[5][c] = row(3, c) - row(2, c);
    }
    for (auto& plane : planes) {
        const float len = std::sqrt(plane[0] * plane[0] +
                                    plane[1] * plane[1] +
                                    plane[2] * plane[2]);
        for (float& v : plane) {
            v /= len;
        }
    }
    std::memcpy(ubo.frustumPlanes, planes, sizeof(planes));
    ubo.totalInstances = kInstanceCount;
    ubo.gpuCullingEnabled = gpuCullingEnabled ? 1u : 0u;
    return ubo;
}

