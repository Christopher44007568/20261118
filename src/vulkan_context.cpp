#include "vulkan_context.hpp"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>

void fail(const std::string& message) {
    throw std::runtime_error(message);
}

void check(VkResult result, const std::string& message) {
    if (result != VK_SUCCESS) {
        fail(message + " (VkResult=" + std::to_string(static_cast<int>(result)) + ")");
    }
}

VulkanContext::~VulkanContext() {
    shutdown();
}

void VulkanContext::initialize() {
    VkApplicationInfo appInfo{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    appInfo.pApplicationName = "clustered_lighting";
    appInfo.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
    appInfo.pEngineName = "headless-compute";
    appInfo.engineVersion = VK_MAKE_VERSION(1, 0, 0);
    appInfo.apiVersion = VK_API_VERSION_1_2;

    VkInstanceCreateInfo instanceInfo{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    instanceInfo.pApplicationInfo = &appInfo;
    check(vkCreateInstance(&instanceInfo, nullptr, &instance), "vkCreateInstance failed");

    uint32_t deviceCount = 0;
    check(vkEnumeratePhysicalDevices(instance, &deviceCount, nullptr),
          "vkEnumeratePhysicalDevices failed");
    if (deviceCount == 0) {
        fail("no Vulkan physical devices were found");
    }

    std::vector<VkPhysicalDevice> devices(deviceCount);
    check(vkEnumeratePhysicalDevices(instance, &deviceCount, devices.data()),
          "vkEnumeratePhysicalDevices(devices) failed");

    for (VkPhysicalDevice candidate : devices) {
        uint32_t familyCount = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, nullptr);
        std::vector<VkQueueFamilyProperties> families(familyCount);
        vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, families.data());
        for (uint32_t i = 0; i < familyCount; ++i) {
            if ((families[i].queueFlags & VK_QUEUE_COMPUTE_BIT) != 0) {
                physicalDevice = candidate;
                queueFamily = i;
                timestampValidBits = families[i].timestampValidBits;
                break;
            }
        }
        if (physicalDevice != VK_NULL_HANDLE) {
            break;
        }
    }
    if (physicalDevice == VK_NULL_HANDLE) {
        fail("no Vulkan compute queue was found");
    }

    vkGetPhysicalDeviceProperties(physicalDevice, &properties_);
    deviceName_ = properties_.deviceName;
    timestampPeriod = properties_.limits.timestampPeriod;

    float priority = 1.0f;
    VkDeviceQueueCreateInfo queueInfo{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    queueInfo.queueFamilyIndex = queueFamily;
    queueInfo.queueCount = 1;
    queueInfo.pQueuePriorities = &priority;

    VkDeviceCreateInfo deviceInfo{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    deviceInfo.queueCreateInfoCount = 1;
    deviceInfo.pQueueCreateInfos = &queueInfo;
    check(vkCreateDevice(physicalDevice, &deviceInfo, nullptr, &device),
          "vkCreateDevice failed");
    vkGetDeviceQueue(device, queueFamily, 0, &queue);

    VkCommandPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    poolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    poolInfo.queueFamilyIndex = queueFamily;
    check(vkCreateCommandPool(device, &poolInfo, nullptr, &commandPool),
          "vkCreateCommandPool failed");
}

void VulkanContext::shutdown() {
    if (device != VK_NULL_HANDLE) {
        vkDeviceWaitIdle(device);
        if (commandPool != VK_NULL_HANDLE) {
            vkDestroyCommandPool(device, commandPool, nullptr);
            commandPool = VK_NULL_HANDLE;
        }
        vkDestroyDevice(device, nullptr);
        device = VK_NULL_HANDLE;
    }
    if (instance != VK_NULL_HANDLE) {
        vkDestroyInstance(instance, nullptr);
        instance = VK_NULL_HANDLE;
    }
}

uint32_t VulkanContext::findMemoryType(
    uint32_t typeBits, VkMemoryPropertyFlags flags) const {
    VkPhysicalDeviceMemoryProperties memoryProperties{};
    vkGetPhysicalDeviceMemoryProperties(physicalDevice, &memoryProperties);
    for (uint32_t i = 0; i < memoryProperties.memoryTypeCount; ++i) {
        if ((typeBits & (1u << i)) != 0 &&
            (memoryProperties.memoryTypes[i].propertyFlags & flags) == flags) {
            return i;
        }
    }
    fail("no suitable Vulkan memory type found");
}

Buffer VulkanContext::createBuffer(VkDeviceSize size, VkBufferUsageFlags usage) {
    Buffer buffer;
    buffer.size = size;

    VkBufferCreateInfo bufferInfo{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bufferInfo.size = size;
    bufferInfo.usage = usage;
    bufferInfo.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    check(vkCreateBuffer(device, &bufferInfo, nullptr, &buffer.handle),
          "vkCreateBuffer failed");

    VkMemoryRequirements requirements{};
    vkGetBufferMemoryRequirements(device, buffer.handle, &requirements);

    VkMemoryAllocateInfo allocationInfo{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    allocationInfo.allocationSize = requirements.size;
    allocationInfo.memoryTypeIndex = findMemoryType(
        requirements.memoryTypeBits,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    check(vkAllocateMemory(device, &allocationInfo, nullptr, &buffer.memory),
          "vkAllocateMemory failed");
    check(vkBindBufferMemory(device, buffer.handle, buffer.memory, 0),
          "vkBindBufferMemory failed");
    check(vkMapMemory(device, buffer.memory, 0, size, 0, &buffer.mapped),
          "vkMapMemory failed");
    std::memset(buffer.mapped, 0, static_cast<size_t>(size));
    return buffer;
}

void VulkanContext::destroyBuffer(Buffer& buffer) {
    if (buffer.mapped != nullptr) {
        vkUnmapMemory(device, buffer.memory);
        buffer.mapped = nullptr;
    }
    if (buffer.handle != VK_NULL_HANDLE) {
        vkDestroyBuffer(device, buffer.handle, nullptr);
        buffer.handle = VK_NULL_HANDLE;
    }
    if (buffer.memory != VK_NULL_HANDLE) {
        vkFreeMemory(device, buffer.memory, nullptr);
        buffer.memory = VK_NULL_HANDLE;
    }
    buffer.size = 0;
}

void VulkanContext::copyToBuffer(
    const Buffer& buffer, const void* data, VkDeviceSize size) const {
    if (size > buffer.size) {
        fail("buffer upload exceeds allocation");
    }
    std::memcpy(buffer.mapped, data, static_cast<size_t>(size));
}

std::vector<uint32_t> readSpirv(const std::string& path) {
    std::ifstream file(path, std::ios::ate | std::ios::binary);
    if (!file) {
        fail("could not open shader: " + path);
    }
    const size_t byteSize = static_cast<size_t>(file.tellg());
    if (byteSize == 0 || (byteSize % sizeof(uint32_t)) != 0) {
        fail("invalid SPIR-V byte size: " + path);
    }
    std::vector<uint32_t> data(byteSize / sizeof(uint32_t));
    file.seekg(0);
    file.read(reinterpret_cast<char*>(data.data()), static_cast<std::streamsize>(byteSize));
    if (!file) {
        fail("could not read shader: " + path);
    }
    return data;
}

