#ifndef VK_ENGINE_H
#define VK_ENGINE_H

#include <vulkan/vulkan.h>
#include <stdint.h>
#include <stdbool.h>

typedef struct {
    VkInstance       inst;
    VkPhysicalDevice phys;
    VkDevice         dev;
    VkQueue          queue;
    uint32_t         qfi;
    VkCommandPool    cpool;
    VkDescriptorPool dpool;
    VkQueryPool      queryPool;
    double           timestampPeriod;
    VkDeviceMemory   stageMem;
    VkDeviceSize     stageSize;
    VkBuffer         stageBuf;
} Engine;

typedef struct {
    VkImage       image;
    VkDeviceMemory mem;
    VkImageView   view;
    VkFormat      format;
    uint32_t      width, height;
} Texture;

void engine_init(Engine* e);
void engine_destroy(Engine* e);

uint32_t* load_spv(const char* path, size_t* out_bytes);
VkShaderModule make_shader(Engine* e, const char* spv_path);

Texture tex_create(Engine* e, uint32_t w, uint32_t h, VkFormat fmt,
                   VkImageUsageFlags usage);
void tex_destroy(Engine* e, Texture* t);

VkBuffer buf_create(Engine* e, VkDeviceSize size, VkBufferUsageFlags usage,
                    VkDeviceMemory* outMem, VkMemoryPropertyFlags props);
void write_ubo(Engine* e, VkBuffer buf, VkDeviceSize size, const void* data);

VkDescriptorSetLayout make_dsl(Engine* e,
                               const VkDescriptorSetLayoutBinding* binds,
                               uint32_t count);
VkPipelineLayout make_pipeline_layout(Engine* e, VkDescriptorSetLayout dsl,
                                      uint32_t uboSize);
VkPipeline make_compute(Engine* e, VkShaderModule mod, VkPipelineLayout pl);
VkDescriptorSet alloc_ds(Engine* e, VkDescriptorSetLayout dsl);

void ds_storage_image(Engine* e, VkDescriptorSet ds, uint32_t binding,
                      VkImageView view);
void ds_storage_buffer(Engine* e, VkDescriptorSet ds, uint32_t binding,
                       VkBuffer buf, VkDeviceSize range);
void register_mapped(Engine* e, VkBuffer buf, VkDeviceMemory mem,
                     VkDeviceSize size);
void transition_storage_general(Engine* e, Texture* t);

// GPU timestamp helpers. Slot pairs give elapsed milliseconds.
void ts_reset(Engine* e, VkCommandBuffer cb);
void ts_mark(Engine* e, VkCommandBuffer cb, uint32_t slot);
double ts_elapsed_ms(Engine* e, uint32_t beginSlot, uint32_t endSlot);

VkCommandBuffer begin_cmds(Engine* e);
void submit_wait(Engine* e, VkCommandBuffer cb);

// Blocks until the texture contents are readable in host memory (float4).
void read_texture_f4(Engine* e, Texture* t, float* dst);

double now_seconds(void);

#endif
