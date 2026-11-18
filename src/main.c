#include "vk_engine.h"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../third_party/stb_image_write.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    float camPos[4];
    float camRight[4];
    float camUp[4];
    float camForward[4];
    float lightPos[4];
    float lightDir[4];
    float lightColor[4];
    float medium[4];
    float controls[4];
    float targetSize[4];
    float timing[4];
} ParamsC;

typedef struct {
    int width, height;
    int steps;
    float scatterScale;
    float noiseSeed;
    int volumeEnabled;
    int halfRes;
    int jitter;
    int frames;
        int stats;
    int dumpF32;
    float camZ;
    const char* outPath;
    const char* spvDir;
} Options;

typedef struct {
    float pos[3], target[3];
} Camera;

static void v3sub(float* o, const float* a, const float* b) {
    for (int i = 0; i < 3; i++) o[i] = a[i] - b[i];
}
static float v3dot(const float* a, const float* b) {
    float s = 0; for (int i = 0; i < 3; i++) s += a[i] * b[i]; return s;
}
static void v3norm(float* a) {
    float l = sqrtf(v3dot(a, a));
    for (int i = 0; i < 3; i++) a[i] /= l;
}
static void v3cross(float* o, const float* a, const float* b) {
    o[0] = a[1] * b[2] - a[2] * b[1];
    o[1] = a[2] * b[0] - a[0] * b[2];
    o[2] = a[0] * b[1] - a[1] * b[0];
}

static void build_params(ParamsC* P, const Options* o, const Camera* cam, float frameIdx) {
    memset(P, 0, sizeof(*P));
    float fwd[3], right[3], up[3];
    v3sub(fwd, cam->target, cam->pos); v3norm(fwd);
    float worldUp[3] = {0, 1, 0};
    v3cross(right, fwd, worldUp); v3norm(right);
    v3cross(up, right, fwd);
    float aspect = (float)o->width / (float)o->height;
    float fovy = 55.f * 3.14159265f / 180.f;
    float halfH = tanf(fovy * 0.5f);
    float halfW = halfH * aspect;
    for (int i = 0; i < 3; i++) {
        P->camPos[i] = cam->pos[i];
        P->camRight[i] = right[i];
        P->camUp[i] = up[i];
        P->camForward[i] = fwd[i];
    }
    P->camRight[3] = halfW;
    P->camUp[3] = halfH;
    P->camForward[3] = 0.08f; // near plane

    // Spot light behind the slit, pointing toward the camera space.
    P->lightPos[0] = 0.f; P->lightPos[1] = 1.4f; P->lightPos[2] = -12.0f;
    P->lightPos[3] = 22.f; // range
    float ldir[3] = {0.0f, -0.12f, 1.0f}; v3norm(ldir);
    P->lightDir[0] = ldir[0]; P->lightDir[1] = ldir[1]; P->lightDir[2] = ldir[2];
    P->lightDir[3] = cosf(15.f * 3.14159265f / 180.f); // cos inner
    P->lightColor[0] = 8.0f; P->lightColor[1] = 7.0f; P->lightColor[2] = 5.4f;
    P->lightColor[3] = cosf(23.f * 3.14159265f / 180.f); // cos outer

    // Medium: base haze, noise density, scattering, absorption.
    // Kept optically thin so the beam stays visible over several metres.
    P->medium[0] = 0.28f;
    P->medium[1] = 0.16f;
    P->medium[2] = 0.7f;
    P->medium[3] = 0.03f;

    P->controls[0] = o->scatterScale;
    P->controls[1] = (float)o->steps;
    P->controls[2] = o->noiseSeed;
    P->controls[3] = o->volumeEnabled ? 1.f : 0.f;

    P->targetSize[0] = (float)o->width;
    P->targetSize[1] = (float)o->height;
    P->targetSize[2] = (float)(o->halfRes ? (o->width + 1) / 2 : o->width);
    P->targetSize[3] = (float)(o->halfRes ? (o->height + 1) / 2 : o->height);

    // Jitter mode: frameIdx < 0 freezes the pattern for deterministic capture.
    P->timing[0] = o->jitter ? frameIdx : 0.f;
}

static void usage(const char* exe) {
    fprintf(stderr,
        "usage: %s [options]\n"
        "  --width N --height N   output resolution (default 960x540)\n"
        "  --steps N              volume march steps (default 48)\n"
        "  --scatter F            scattering intensity (default 1.0)\n"
        "  --seed F               noise seed (default 4.0)\n"
        "  --no-volume            disable volumetrics (base lighting only)\n"
        "  --full-res             run volume pass at full resolution\n"
        "  --no-jitter            freeze dithering (deterministic)\n"
        "  --frames N             camera sweep frame count (default 1)\n"
        "  --cam NAME             a|b|c|d|path preset camera\n"
        "  --out PATH             output PNG (single frame) or prefix (sweep)\n"
        "  --spv DIR              directory with compiled shaders\n",
        exe);
}

int main(int argc, char** argv) {
    Options o = {
        .width = 960, .height = 540, .steps = 48, .scatterScale = 1.f,
        .noiseSeed = 4.f, .volumeEnabled = 1, .halfRes = 1, .jitter = 1,
        .frames = 1, .outPath = "results/frame.png",
        .spvDir = "build/spv", .stats = 0, .dumpF32 = 0, .camZ = 0.f,
    };
    const char* camName = "a";
    for (int i = 1; i < argc; i++) {
        #define NEXT() (i + 1 < argc ? argv[++i] : NULL)
        if (!strcmp(argv[i], "--width")) o.width = atoi(NEXT());
        else if (!strcmp(argv[i], "--height")) o.height = atoi(NEXT());
        else if (!strcmp(argv[i], "--steps")) o.steps = atoi(NEXT());
        else if (!strcmp(argv[i], "--scatter")) o.scatterScale = atof(NEXT());
        else if (!strcmp(argv[i], "--seed")) o.noiseSeed = atof(NEXT());
        else if (!strcmp(argv[i], "--no-volume")) o.volumeEnabled = 0;
        else if (!strcmp(argv[i], "--full-res")) o.halfRes = 0;
        else if (!strcmp(argv[i], "--no-jitter")) o.jitter = 0;
        else if (!strcmp(argv[i], "--frames")) o.frames = atoi(NEXT());
        else if (!strcmp(argv[i], "--cam")) camName = NEXT();
        else if (!strcmp(argv[i], "--out")) o.outPath = NEXT();
        else if (!strcmp(argv[i], "--spv")) o.spvDir = NEXT();
        else if (!strcmp(argv[i], "--stats")) o.stats = 1;
        else if (!strcmp(argv[i], "--dump-f32")) o.dumpF32 = 1;
        else if (!strcmp(argv[i], "--cam-z")) o.camZ = atof(NEXT());
        else { usage(argv[0]); return 1; }
    }
    fprintf(stderr, "[cfg] %dx%d steps=%d scatter=%.2f seed=%.1f vol=%d half=%d\n",
            o.width, o.height, o.steps, o.scatterScale, o.noiseSeed,
            o.volumeEnabled, o.halfRes);

    Engine eng;
    engine_init(&eng);

    char spv[256];
    VkShaderModule baseMod, volMod, compMod;
    snprintf(spv, sizeof spv, "%s/base.comp.spv", o.spvDir);
    baseMod = make_shader(&eng, spv);
    snprintf(spv, sizeof spv, "%s/volume.comp.spv", o.spvDir);
    volMod = make_shader(&eng, spv);
    snprintf(spv, sizeof spv, "%s/composite.comp.spv", o.spvDir);
    compMod = make_shader(&eng, spv);

    int vw = o.halfRes ? (o.width + 1) / 2 : o.width;
    int vh = o.halfRes ? (o.height + 1) / 2 : o.height;
    Texture baseColor = tex_create(&eng, o.width, o.height, VK_FORMAT_R16G16B16A16_SFLOAT,
                                   VK_IMAGE_USAGE_STORAGE_BIT);
    Texture baseDepth = tex_create(&eng, o.width, o.height, VK_FORMAT_R32_SFLOAT,
                                   VK_IMAGE_USAGE_STORAGE_BIT);
    Texture volScatter = tex_create(&eng, vw, vh, VK_FORMAT_R16G16B16A16_SFLOAT,
                                    VK_IMAGE_USAGE_STORAGE_BIT);
    Texture volTrans = tex_create(&eng, vw, vh, VK_FORMAT_R32_SFLOAT,
                                  VK_IMAGE_USAGE_STORAGE_BIT);
    Texture finalColor = tex_create(&eng, o.width, o.height, VK_FORMAT_R16G16B16A16_SFLOAT,
                                    VK_IMAGE_USAGE_STORAGE_BIT);
    Texture* allTex[] = {&baseColor, &baseDepth, &volScatter, &volTrans, &finalColor};
    for (int i = 0; i < 5; i++) transition_storage_general(&eng, allTex[i]);

    // UBO (persistently mapped).
    VkDeviceMemory uboMem;
    VkBuffer ubo = buf_create(&eng, sizeof(ParamsC),
                              VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT,
                              &uboMem,
                              VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                              VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    register_mapped(&eng, ubo, uboMem, sizeof(ParamsC));

    // Descriptor set layouts.
    VkDescriptorSetLayoutBinding baseB[] = {
        {0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
        {1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
        {2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
    };
    VkDescriptorSetLayoutBinding volB[] = {
        {0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
        {1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
        {2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
    };
    VkDescriptorSetLayoutBinding compB[] = {
        {0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
        {1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
        {2, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
        {3, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
        {4, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
        {5, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, NULL},
    };
    VkDescriptorSetLayout baseDsl = make_dsl(&eng, baseB, 3);
    VkDescriptorSetLayout volDsl = make_dsl(&eng, volB, 3);
    VkDescriptorSetLayout compDsl = make_dsl(&eng, compB, 6);
    VkPipelineLayout basePl = make_pipeline_layout(&eng, baseDsl, 0);
    VkPipelineLayout volPl = make_pipeline_layout(&eng, volDsl, 0);
    VkPipelineLayout compPl = make_pipeline_layout(&eng, compDsl, 0);
    VkPipeline basePipe = make_compute(&eng, baseMod, basePl);
    VkPipeline volPipe = make_compute(&eng, volMod, volPl);
    VkPipeline compPipe = make_compute(&eng, compMod, compPl);

    VkDescriptorSet baseDs = alloc_ds(&eng, baseDsl);
    ds_storage_image(&eng, baseDs, 0, baseColor.view);
    ds_storage_image(&eng, baseDs, 1, baseDepth.view);
    ds_storage_buffer(&eng, baseDs, 2, ubo, sizeof(ParamsC));
    VkDescriptorSet volDs = alloc_ds(&eng, volDsl);
    ds_storage_image(&eng, volDs, 0, volScatter.view);
    ds_storage_image(&eng, volDs, 1, volTrans.view);
    ds_storage_buffer(&eng, volDs, 2, ubo, sizeof(ParamsC));
    VkDescriptorSet compDs = alloc_ds(&eng, compDsl);
    ds_storage_image(&eng, compDs, 0, baseColor.view);
    ds_storage_image(&eng, compDs, 1, baseDepth.view);
    ds_storage_image(&eng, compDs, 2, volScatter.view);
    ds_storage_image(&eng, compDs, 3, volTrans.view);
    ds_storage_image(&eng, compDs, 4, finalColor.view);
    ds_storage_buffer(&eng, compDs, 5, ubo, sizeof(ParamsC));

    // Camera presets.
    Camera presets[4] = {
        {{0.0f, 0.4f, 4.2f}, {0.0f, 0.2f, -6.0f}},   // a: head-on view
        {{1.6f, 0.9f, 3.2f}, {0.3f, 0.1f, -5.5f}},   // b: oblique
        {{0.0f, 0.35f, 0.9f}, {0.0f, 0.0f, -6.0f}},  // c: inside the shaft
        {{-2.2f, 0.6f, 2.4f}, {0.6f, 0.0f, -4.5f}},  // d: side view
    };
    int presetIdx = 0;
    if (camName[0] >= 'b' && camName[0] <= 'd') presetIdx = camName[0] - 'a';

    float* pixels = malloc(sizeof(float) * 4 * o.width * o.height);
    float* depthPx = malloc(sizeof(float) * o.width * o.height);
    unsigned char* png = malloc(3 * o.width * o.height);

    for (int frame = 0; frame < o.frames; frame++) {
        Camera cam;
        if (o.frames > 1) {
            // Sweep: move the camera forward through the beam then back.
            float k = sinf((float)frame / (float)(o.frames - 1) * 3.14159265f);
            cam.pos[0] = 0.0f;
            cam.pos[1] = 0.35f;
            cam.pos[2] = 4.2f - 3.4f * k; // crosses z~0.9 inside the shaft
            cam.target[0] = 0.0f; cam.target[1] = 0.1f; cam.target[2] = -6.0f;
        } else {
            cam = presets[presetIdx];
            if (o.camZ != 0.f) cam.pos[2] = o.camZ;
        }
        ParamsC P;
        build_params(&P, &o, &cam, (float)frame);
        write_ubo(&eng, ubo, sizeof P, &P);

        VkCommandBuffer cb = begin_cmds(&eng);
        ts_reset(&eng, cb);
        ts_mark(&eng, cb, 0);
        vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_COMPUTE, basePipe);
        vkCmdBindDescriptorSets(cb, VK_PIPELINE_BIND_POINT_COMPUTE, basePl,
                                0, 1, &baseDs, 0, NULL);
        vkCmdDispatch(cb, (o.width + 7) / 8, (o.height + 7) / 8, 1);
        vkCmdPipelineBarrier(cb, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             0, 0, NULL, 0, NULL, 0, NULL);

        ts_mark(&eng, cb, 1);
        if (o.volumeEnabled) {
            vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_COMPUTE, volPipe);
            vkCmdBindDescriptorSets(cb, VK_PIPELINE_BIND_POINT_COMPUTE, volPl,
                                    0, 1, &volDs, 0, NULL);
            vkCmdDispatch(cb, (vw + 7) / 8, (vh + 7) / 8, 1);
            vkCmdPipelineBarrier(cb, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                 0, 0, NULL, 0, NULL, 0, NULL);
        }
        ts_mark(&eng, cb, 2);
        vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_COMPUTE, compPipe);
        vkCmdBindDescriptorSets(cb, VK_PIPELINE_BIND_POINT_COMPUTE, compPl,
                                0, 1, &compDs, 0, NULL);
        vkCmdDispatch(cb, (o.width + 7) / 8, (o.height + 7) / 8, 1);
        ts_mark(&eng, cb, 3);
        submit_wait(&eng, cb);
        double gpuBase = ts_elapsed_ms(&eng, 0, 1);
        double gpuVol = ts_elapsed_ms(&eng, 1, 2);
        double gpuComp = ts_elapsed_ms(&eng, 2, 3);
        double gpuTotal = ts_elapsed_ms(&eng, 0, 3);

        read_texture_f4(&eng, &finalColor, pixels);
        if (o.stats) {
            read_texture_f4(&eng, &baseDepth, depthPx);
            double lumSum = 0, lumMax = 0; int hits = 0;
            for (int i = 0; i < o.width * o.height; i++) {
                float r = pixels[i*4], g = pixels[i*4+1], b = pixels[i*4+2];
                double lum = 0.2126*r + 0.7152*g + 0.0722*b;
                lumSum += lum;
                if (lum > lumMax) lumMax = lum;
                if (depthPx[i] > 0) hits++;
            }
            int n = o.width * o.height;
            printf("stats: meanLum=%.5f maxLum=%.5f hitRatio=%.3f\n",
                   lumSum / n, lumMax, (double)hits / n);
        }
        if (o.stats && o.volumeEnabled) {
            float* volPx = malloc(sizeof(float) * 4 * vw * vh);
            read_texture_f4(&eng, &volScatter, volPx);
            double vsum = 0, vmax = 0; int lit = 0;
            for (int i = 0; i < vw * vh; i++) {
                double lum = 0.2126*volPx[i*4] + 0.7152*volPx[i*4+1] + 0.0722*volPx[i*4+2];
                vsum += lum; if (lum > vmax) vmax = lum;
                if (lum > 0.001) lit++;
            }
            printf("volScatter: mean=%.6f max=%.5f litRatio=%.4f\n",
                   vsum / (vw * vh), vmax, (double)lit / (vw * vh));
            free(volPx);
        }
        for (int i = 0; i < o.width * o.height; i++) {
            for (int c = 0; c < 3; c++) {
                float v = pixels[i * 4 + c];
                int g = (int)(powf(fminf(fmaxf(v, 0.f), 1.f), 1.f / 2.2f) * 255.f + 0.5f);
                png[i * 3 + c] = (unsigned char)g;
            }
        }
        char path[320];
        if (o.frames > 1)
            snprintf(path, sizeof path, "%s_%03d.png", o.outPath, frame);
        else
            snprintf(path, sizeof path, "%s", o.outPath);
        stbi_write_png(path, o.width, o.height, 3, png, o.width * 3);
        if (o.dumpF32) {
            char binPath[320];
            snprintf(binPath, sizeof binPath, "%s.f32.bin", path);
            FILE* bf = fopen(binPath, "wb");
            fwrite(pixels, sizeof(float), (size_t)(4 * o.width * o.height), bf);
            fclose(bf);
        }
        if (o.stats) {
            char ppmPath[320];
            snprintf(ppmPath, sizeof ppmPath, "%s.ppm", path);
            FILE* pf = fopen(ppmPath, "wb");
            fprintf(pf, "P6\n%d %d\n255\n", o.width, o.height);
            fwrite(png, 1, (size_t)(3 * o.width * o.height), pf);
            fclose(pf);
            float rs = 0, gs = 0, bs = 0;
            for (int i = 0; i < o.width * o.height; i++) {
                rs += pixels[i*4]; gs += pixels[i*4+1]; bs += pixels[i*4+2];
            }
            int nn = o.width * o.height;
            printf("rawRGB means: %.5f %.5f %.5f\n", rs/nn, gs/nn, bs/nn);
            printf("center pixel rgba: %.4f %.4f %.4f %.4f\n",
                   pixels[(o.height/2*o.width + o.width/2)*4],
                   pixels[(o.height/2*o.width + o.width/2)*4+1],
                   pixels[(o.height/2*o.width + o.width/2)*4+2],
                   pixels[(o.height/2*o.width + o.width/2)*4+3]);
        }
        printf("frame %d [gpu]: base=%.3fms volume=%.3fms composite=%.3fms total=%.3fms -> %s\n",
               frame, gpuBase, gpuVol, gpuComp, gpuTotal, path);
    }

    free(png); free(pixels); free(depthPx);
    engine_destroy(&eng);
    return 0;
}
