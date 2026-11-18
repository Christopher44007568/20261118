#define _POSIX_C_SOURCE 199309L
#include "vk_engine.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define CK(x) do { VkResult _r = (x); if (_r != VK_SUCCESS) { \
    fprintf(stderr, "vk error %d at %s:%d\n", _r, __FILE__, __LINE__); exit(1); } } while (0)

double now_seconds(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec * 1e-9;
}

uint32_t* load_spv(const char* path, size_t* out_bytes) {
    FILE* f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "missing %s\n", path); exit(1); }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint32_t* buf = malloc(n);
    if (fread(buf, 1, n, f) != (size_t)n) { fprintf(stderr, "read %s fail\n", path); exit(1); }
    fclose(f);
    *out_bytes = (size_t)n;
    return buf;
}

VkShaderModule make_shader(Engine* e, const char* spv_path) {
    size_t n = 0;
    uint32_t* code = load_spv(spv_path, &n);
    VkShaderModuleCreateInfo ci = {VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    ci.codeSize = n; ci.pCode = code;
    VkShaderModule m;
    CK(vkCreateShaderModule(e->dev, &ci, NULL, &m));
    free(code);
    return m;
}

static uint32_t find_memory(Engine* e, uint32_t typeBits, VkMemoryPropertyFlags want) {
    VkPhysicalDeviceMemoryProperties mp;
    vkGetPhysicalDeviceMemoryProperties(e->phys, &mp);
    for (uint32_t i = 0; i < mp.memoryTypeCount; i++) {
        if ((typeBits & (1u << i)) &&
            (mp.memoryTypes[i].propertyFlags & want) == want)
            return i;
    }
    fprintf(stderr, "no memory type\n"); exit(1);
}

void engine_init(Engine* e) {
    memset(e, 0, sizeof(*e));
    VkApplicationInfo app = {VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "volspot";
    app.apiVersion = VK_API_VERSION_1_2;
    VkInstanceCreateInfo ici = {VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    ici.pApplicationInfo = &app;
    CK(vkCreateInstance(&ici, NULL, &e->inst));

    uint32_t n = 0;
    vkEnumeratePhysicalDevices(e->inst, &n, NULL);
    if (!n) { fprintf(stderr, "no vulkan device\n"); exit(1); }
    VkPhysicalDevice all[8];
    vkEnumeratePhysicalDevices(e->inst, &n, all);
    e->phys = all[0];
    VkPhysicalDeviceProperties props;
    vkGetPhysicalDeviceProperties(e->phys, &props);
    fprintf(stderr, "[vk] device: %s\n", props.deviceName);

    uint32_t nqf = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(e->phys, &nqf, NULL);
    VkQueueFamilyProperties qf[16];
    vkGetPhysicalDeviceQueueFamilyProperties(e->phys, &nqf, qf);
    for (uint32_t i = 0; i < nqf; i++)
        if (qf[i].queueFlags & VK_QUEUE_COMPUTE_BIT) { e->qfi = i; break; }

    float prio = 1.f;
    VkDeviceQueueCreateInfo qci = {VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    qci.queueFamilyIndex = e->qfi; qci.queueCount = 1; qci.pQueuePriorities = &prio;
    VkDeviceCreateInfo dci = {VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    dci.queueCreateInfoCount = 1; dci.pQueueCreateInfos = &qci;
    CK(vkCreateDevice(e->phys, &dci, NULL, &e->dev));
    vkGetDeviceQueue(e->dev, e->qfi, 0, &e->queue);

    VkCommandPoolCreateInfo cpi = {VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    cpi.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    cpi.queueFamilyIndex = e->qfi;
    CK(vkCreateCommandPool(e->dev, &cpi, NULL, &e->cpool));

    VkDescriptorPoolSize pools[] = {
        {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 64},
        {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 32},
    };
    VkDescriptorPoolCreateInfo dpci = {VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    dpci.maxSets = 32; dpci.poolSizeCount = 2; dpci.pPoolSizes = pools;
    CK(vkCreateDescriptorPool(e->dev, &dpci, NULL, &e->dpool));

    VkQueryPoolCreateInfo qpci = {VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO};
    qpci.queryType = VK_QUERY_TYPE_TIMESTAMP;
    qpci.queryCount = 16;
    CK(vkCreateQueryPool(e->dev, &qpci, NULL, &e->queryPool));
    VkPhysicalDeviceProperties props2;
    vkGetPhysicalDeviceProperties(e->phys, &props2);
    e->timestampPeriod = props2.limits.timestampPeriod;

    // Persistent host-visible staging buffer (grown on demand).
    e->stageSize = 64u * 1024u * 1024u;
    VkBufferCreateInfo bci = {VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bci.size = e->stageSize;
    bci.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    CK(vkCreateBuffer(e->dev, &bci, NULL, &e->stageBuf));
    VkMemoryRequirements mr;
    vkGetBufferMemoryRequirements(e->dev, e->stageBuf, &mr);
    VkMemoryAllocateInfo mai = {VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex = find_memory(e, mr.memoryTypeBits,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    CK(vkAllocateMemory(e->dev, &mai, NULL, &e->stageMem));
    CK(vkBindBufferMemory(e->dev, e->stageBuf, e->stageMem, 0));
}

void engine_destroy(Engine* e) {
    vkDeviceWaitIdle(e->dev);
    vkDestroyBuffer(e->dev, e->stageBuf, NULL);
    vkFreeMemory(e->dev, e->stageMem, NULL);
    vkDestroyDescriptorPool(e->dev, e->dpool, NULL);
    vkDestroyCommandPool(e->dev, e->cpool, NULL);
    vkDestroyDevice(e->dev, NULL);
    vkDestroyInstance(e->inst, NULL);
}

VkBuffer buf_create(Engine* e, VkDeviceSize size, VkBufferUsageFlags usage,
                    VkDeviceMemory* outMem, VkMemoryPropertyFlags props) {
    VkBufferCreateInfo bci = {VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bci.size = size; bci.usage = usage; bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VkBuffer buf;
    CK(vkCreateBuffer(e->dev, &bci, NULL, &buf));
    VkMemoryRequirements mr;
    vkGetBufferMemoryRequirements(e->dev, buf, &mr);
    VkMemoryAllocateInfo mai = {VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex = find_memory(e, mr.memoryTypeBits, props);
    CK(vkAllocateMemory(e->dev, &mai, NULL, outMem));
    CK(vkBindBufferMemory(e->dev, buf, *outMem, 0));
    return buf;
}

void write_ubo(Engine* e, VkBuffer buf, VkDeviceSize size, const void* data) {
    (void)e;
    extern void* ubo_lookup_mapped(VkBuffer b);
    void* p = ubo_lookup_mapped(buf);
    if (!p) { fprintf(stderr, "ubo not registered\n"); exit(1); }
    memcpy(p, data, (size_t)size);
}

// Persistent mapping registry (small fixed table is enough for this app).
#define MAX_MAPPED 16
typedef struct { VkBuffer buf; void* ptr; } MappedEntry;
static MappedEntry g_mapped[MAX_MAPPED];
static int g_mappedCount = 0;

void* ubo_lookup_mapped(VkBuffer b) {
    for (int i = 0; i < g_mappedCount; i++)
        if (g_mapped[i].buf == b) return g_mapped[i].ptr;
    return NULL;
}

void register_mapped(Engine* e, VkBuffer buf, VkDeviceMemory mem, VkDeviceSize size) {
    void* p;
    CK(vkMapMemory(e->dev, mem, 0, size, 0, &p));
    g_mapped[g_mappedCount++] = (MappedEntry){buf, p};
}

Texture tex_create(Engine* e, uint32_t w, uint32_t h, VkFormat fmt,
                   VkImageUsageFlags usage) {
    Texture t = {0};
    t.width = w; t.height = h; t.format = fmt;
    VkImageCreateInfo ici = {VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    ici.imageType = VK_IMAGE_TYPE_2D;
    ici.format = fmt;
    ici.extent = (VkExtent3D){w, h, 1};
    ici.mipLevels = 1; ici.arrayLayers = 1;
    ici.samples = VK_SAMPLE_COUNT_1_BIT;
    ici.tiling = VK_IMAGE_TILING_OPTIMAL;
    ici.usage = usage | VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;
    ici.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    CK(vkCreateImage(e->dev, &ici, NULL, &t.image));
    VkMemoryRequirements mr;
    vkGetImageMemoryRequirements(e->dev, t.image, &mr);
    VkMemoryAllocateInfo mai = {VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex = find_memory(e, mr.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    CK(vkAllocateMemory(e->dev, &mai, NULL, &t.mem));
    CK(vkBindImageMemory(e->dev, t.image, t.mem, 0));

    VkImageViewCreateInfo vci = {VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    vci.image = t.image; vci.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vci.format = fmt;
    vci.subresourceRange = (VkImageSubresourceRange){
        VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    CK(vkCreateImageView(e->dev, &vci, NULL, &t.view));
    return t;
}

void tex_destroy(Engine* e, Texture* t) {
    vkDestroyImageView(e->dev, t->view, NULL);
    vkDestroyImage(e->dev, t->image, NULL);
    vkFreeMemory(e->dev, t->mem, NULL);
    memset(t, 0, sizeof(*t));
}

VkDescriptorSetLayout make_dsl(Engine* e,
                               const VkDescriptorSetLayoutBinding* binds,
                               uint32_t count) {
    VkDescriptorSetLayoutCreateInfo ci = {VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    ci.bindingCount = count; ci.pBindings = binds;
    VkDescriptorSetLayout dsl;
    CK(vkCreateDescriptorSetLayout(e->dev, &ci, NULL, &dsl));
    return dsl;
}

VkPipelineLayout make_pipeline_layout(Engine* e, VkDescriptorSetLayout dsl,
                                      uint32_t uboSize) {
    (void)uboSize;
    VkPipelineLayoutCreateInfo ci = {VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    ci.setLayoutCount = 1; ci.pSetLayouts = &dsl;
    VkPipelineLayout pl;
    CK(vkCreatePipelineLayout(e->dev, &ci, NULL, &pl));
    return pl;
}

VkPipeline make_compute(Engine* e, VkShaderModule mod, VkPipelineLayout pl) {
    VkComputePipelineCreateInfo ci = {VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    ci.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    ci.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    ci.stage.module = mod;
    ci.stage.pName = "main";
    ci.layout = pl;
    VkPipeline p;
    CK(vkCreateComputePipelines(e->dev, VK_NULL_HANDLE, 1, &ci, NULL, &p));
    return p;
}

VkDescriptorSet alloc_ds(Engine* e, VkDescriptorSetLayout dsl) {
    VkDescriptorSetAllocateInfo ai = {VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    ai.descriptorPool = e->dpool;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &dsl;
    VkDescriptorSet ds;
    CK(vkAllocateDescriptorSets(e->dev, &ai, &ds));
    return ds;
}

void ds_storage_image(Engine* e, VkDescriptorSet ds, uint32_t binding, VkImageView view) {
    VkDescriptorImageInfo ii = {VK_NULL_HANDLE, view,
                                VK_IMAGE_LAYOUT_GENERAL};
    VkWriteDescriptorSet w = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    w.dstSet = ds; w.dstBinding = binding;
    w.descriptorCount = 1;
    w.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
    w.pImageInfo = &ii;
    vkUpdateDescriptorSets(e->dev, 1, &w, 0, NULL);
}

void ds_storage_buffer(Engine* e, VkDescriptorSet ds, uint32_t binding, VkBuffer buf,
                       VkDeviceSize range) {
    VkDescriptorBufferInfo bi = {buf, 0, range};
    VkWriteDescriptorSet w = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    w.dstSet = ds; w.dstBinding = binding;
    w.descriptorCount = 1;
    w.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    w.pBufferInfo = &bi;
    vkUpdateDescriptorSets(e->dev, 1, &w, 0, NULL);
}

VkCommandBuffer begin_cmds(Engine* e) {
    VkCommandBufferAllocateInfo ai = {VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    ai.commandPool = e->cpool;
    ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    ai.commandBufferCount = 1;
    VkCommandBuffer cb;
    CK(vkAllocateCommandBuffers(e->dev, &ai, &cb));
    VkCommandBufferBeginInfo bi = {VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    CK(vkBeginCommandBuffer(cb, &bi));
    return cb;
}

void submit_wait(Engine* e, VkCommandBuffer cb) {
    CK(vkEndCommandBuffer(cb));
    VkSubmitInfo si = {VK_STRUCTURE_TYPE_SUBMIT_INFO};
    si.commandBufferCount = 1; si.pCommandBuffers = &cb;
    CK(vkQueueSubmit(e->queue, 1, &si, VK_NULL_HANDLE));
    CK(vkQueueWaitIdle(e->queue));
    vkFreeCommandBuffers(e->dev, e->cpool, 1, &cb);
}

static void barrier_general(VkCommandBuffer cb, VkImage img) {
    VkImageMemoryBarrier b = {VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    b.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    b.newLayout = VK_IMAGE_LAYOUT_GENERAL;
    b.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b.image = img;
    b.subresourceRange = (VkImageSubresourceRange){
        VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    b.srcAccessMask = 0;
    b.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cb, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 0, NULL, 0, NULL, 1, &b);
}

void transition_storage_general(Engine* e, Texture* t) {
    VkCommandBuffer cb = begin_cmds(e);
    barrier_general(cb, t->image);
    submit_wait(e, cb);
}

void read_texture_f4(Engine* e, Texture* t, float* dst) {
    VkDeviceSize pixel;
    switch (t->format) {
        case VK_FORMAT_R32_SFLOAT:          pixel = 4u;  break;
        case VK_FORMAT_R16G16B16A16_SFLOAT: pixel = 8u;  break;
        default: pixel = 16u; break;
    }
    VkDeviceSize size = pixel * t->width * t->height;
    if (size > e->stageSize) { fprintf(stderr, "staging too small\n"); exit(1); }

    VkCommandBuffer cb = begin_cmds(e);
    VkBufferImageCopy region = {0};
    region.imageSubresource = (VkImageSubresourceLayers){
        VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    region.imageExtent = (VkExtent3D){t->width, t->height, 1};
    vkCmdCopyImageToBuffer(cb, t->image, VK_IMAGE_LAYOUT_GENERAL,
                           e->stageBuf, 1, &region);
    submit_wait(e, cb);

    void* mapped;
    CK(vkMapMemory(e->dev, e->stageMem, 0, size, 0, &mapped));
    if (t->format == VK_FORMAT_R16G16B16A16_SFLOAT) {
        const unsigned short* src16 = (const unsigned short*)mapped;
        uint32_t n4 = t->width * t->height;
        for (uint32_t i = 0; i < n4 * 4; i++) {
            unsigned short h = src16[i];
            unsigned sign = (h >> 15) & 1;
            int exp = (h >> 10) & 0x1f;
            unsigned mant = h & 0x3ff;
            uint32_t f;
            if (exp == 0) {
                f = mant ? ((mant << 13) | (sign << 31)) : (sign << 31);
            } else if (exp == 0x1f) {
                f = (sign << 31) | (0xffu << 23) | (mant << 13);
            } else {
                exp = exp - 15 + 127;
                f = (sign << 31) | ((uint32_t)exp << 23) | (mant << 13);
            }
            float ff;
            memcpy(&ff, &f, 4);
            ((float*)dst)[i] = ff;
        }
    } else {
        memcpy(dst, mapped, (size_t)size);
    }
    VkMappedMemoryRange mr = {VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE};
    mr.memory = e->stageMem; mr.size = VK_WHOLE_SIZE;
    vkFlushMappedMemoryRanges(e->dev, 1, &mr);
    vkUnmapMemory(e->dev, e->stageMem);
}

void ts_reset(Engine* e, VkCommandBuffer cb) {
    vkCmdResetQueryPool(cb, e->queryPool, 0, 16);
}

void ts_mark(Engine* e, VkCommandBuffer cb, uint32_t slot) {
    vkCmdWriteTimestamp(cb, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        e->queryPool, slot);
}

double ts_elapsed_ms(Engine* e, uint32_t beginSlot, uint32_t endSlot) {
    uint32_t count = endSlot - beginSlot + 1;
    uint64_t values[16];
    VkResult r = vkGetQueryPoolResults(
        e->dev, e->queryPool, beginSlot, endSlot - beginSlot + 1,
        sizeof(uint64_t) * count, values, sizeof(uint64_t),
        VK_QUERY_RESULT_64_BIT | VK_QUERY_RESULT_WAIT_BIT);
    if (r != VK_SUCCESS) return -1.0;
    return (double)(values[count - 1] - values[0]) * e->timestampPeriod * 1e-6;
}
