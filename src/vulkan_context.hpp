#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include <vulkan/vulkan.h>

struct Buffer {
    VkBuffer handle = VK_NULL_HANDLE;
    VkDeviceMemory memory = VK_NULL_HANDLE;
    VkDeviceSize size = 0;
    void* mapped = nullptr;
};

class VulkanContext {
public:
    VulkanContext() = default;
    ~VulkanContext();

    VulkanContext(const VulkanContext&) = delete;
    VulkanContext& operator=(const VulkanContext&) = delete;

    void initialize();
    void shutdown();

    Buffer createBuffer(VkDeviceSize size, VkBufferUsageFlags usage);
    void destroyBuffer(Buffer& buffer);
    void copyToBuffer(const Buffer& buffer, const void* data, VkDeviceSize size) const;
    std::string deviceName() const { return deviceName_; }
    const VkPhysicalDeviceProperties& properties() const { return properties_; }

    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    VkQueue queue = VK_NULL_HANDLE;
    uint32_t queueFamily = 0;
    VkCommandPool commandPool = VK_NULL_HANDLE;
    VkPhysicalDeviceProperties properties_{};
    uint32_t timestampValidBits = 0;
    float timestampPeriod = 1.0f;

private:
    uint32_t findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags flags) const;
    std::string deviceName_;
};

[[noreturn]] void fail(const std::string& message);
void check(VkResult result, const std::string& message);
std::vector<uint32_t> readSpirv(const std::string& path);

