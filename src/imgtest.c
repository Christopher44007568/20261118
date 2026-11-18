#define _POSIX_C_SOURCE 199309L
#include "vk_engine.h"
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    Engine e; engine_init(&e);
    VkShaderModule m = make_shader(&e, "build/spv/imgtest.comp.spv");
    Texture t = tex_create(&e, 16, 16, VK_FORMAT_R16G16B16A16_SFLOAT,
                           VK_IMAGE_USAGE_STORAGE_BIT);
    transition_storage_general(&e, &t);
    VkDescriptorSetLayoutBinding b = {0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1,
                                      VK_SHADER_STAGE_COMPUTE_BIT, NULL};
    VkDescriptorSetLayout dsl = make_dsl(&e, &b, 1);
    VkPipelineLayout pl = make_pipeline_layout(&e, dsl, 0);
    VkPipeline pipe = make_compute(&e, m, pl);
    VkDescriptorSet ds = alloc_ds(&e, dsl);
    ds_storage_image(&e, ds, 0, t.view);
    VkCommandBuffer cb = begin_cmds(&e);
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_COMPUTE, pipe);
    vkCmdBindDescriptorSets(cb, VK_PIPELINE_BIND_POINT_COMPUTE, pl, 0, 1, &ds, 0, NULL);
    vkCmdDispatch(cb, 2, 2, 1);
    submit_wait(&e, cb);

    float* px = malloc(sizeof(float) * 4 * 256);
    read_texture_f4(&e, &t, px);
    printf("px0: %.4f %.4f %.4f %.4f\n", px[0], px[1], px[2], px[3]);
    printf("px1: %.4f %.4f %.4f %.4f\n", px[4], px[5], px[6], px[7]);
    int ok = (px[0] > 0.2 && px[0] < 0.3 && px[3] > 0.9);
    printf(ok ? "IMGTEST OK\n" : "IMGTEST FAIL\n");
    return ok ? 0 : 1;
}
