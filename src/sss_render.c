#include "platform/egl_app.h"
#include "platform/mat4.h"
#include "platform/mesh.h"
#include "platform/shader_util.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../sandbox/stb/stb_image_write.h"

#include <math.h>

#define W 512
#define H 512

typedef enum {
    MAT_JADE = 0,
    MAT_SKIN = 1
} MaterialKind;

typedef enum {
    LIGHT_FRONT = 0,   // light behind the camera, shining onto the face
    LIGHT_BACK  = 1,   // light behind the object -> transmission regime
    LIGHT_SIDE  = 2    // grazing light -> rim scattering
} LightCase;

typedef struct {
    const char *name;
    float surfaceColor[3];
    float scatterColor[3];
    float curvatureScale;
    float density;
    float wrap;
    float scatterStrength;
    float anisotropy;
    float scatterPower;
    float thicknessScale;
    float specular;
    float shininess;
    float modelScale[3];
} MaterialConfig;

static const MaterialConfig MATERIALS[2] = {
    // Jade: deep green surface, brighter warm-green scatter, fairly dense.
    {
        "jade",
        {0.08f, 0.30f, 0.24f},   // surface (cool deep green, blue-leaning)
        {0.78f, 1.0f, 0.55f},    // scatter (warm yellow-green transmission)
        2.2f,                     // curvatureScale
        1.4f,                     // density
        0.55f,                    // wrap
        1.35f,                    // scatterStrength
        0.35f,                    // anisotropy
        1.6f,                     // scatterPower
        2.4f,                     // thicknessScale (world units -> 1)
        0.35f, 48.0f,
        {1.0f, 1.0f, 1.0f}
    },
    // Skin: warm surface, reddish scatter (blood), softer and less dense.
    {
        "skin",
        {0.78f, 0.55f, 0.45f},
        {0.95f, 0.35f, 0.28f},
        1.6f,
        1.3f,
        0.62f,
        1.15f,
        0.25f,
        2.4f,                     // scatterPower: sharpen the thin rim
        1.1f,                     // thicknessScale: widen thickness contrast
        0.18f, 28.0f,
        {1.25f, 0.9f, 0.42f}      // flattened patch -> visibly thin rim
    }
};

typedef struct {
    GLuint fbo;
    GLuint posTex;
    GLuint normalTex;
    GLuint depthRb;
} PrepTarget;

static GLuint prepProg, sssProg;
static PrepTarget frontTarget, backTarget;
static Mesh sphere;
static int g_lightOn = 1;

static GLuint make_float_texture(int w, int h) {
    GLuint tex;
    glGenTextures(1, &tex);
    glBindTexture(GL_TEXTURE_2D, tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, w, h, 0, GL_RGBA, GL_FLOAT,
                 NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    return tex;
}

static PrepTarget make_prep_target(int w, int h) {
    PrepTarget t;
    glGenFramebuffers(1, &t.fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, t.fbo);
    t.posTex = make_float_texture(w, h);
    t.normalTex = make_float_texture(w, h);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
                           GL_TEXTURE_2D, t.posTex, 0);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT1,
                           GL_TEXTURE_2D, t.normalTex, 0);
    glGenRenderbuffers(1, &t.depthRb);
    glBindRenderbuffer(GL_RENDERBUFFER, t.depthRb);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, w, h);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT,
                              GL_RENDERBUFFER, t.depthRb);
    GLenum bufs[2] = { GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1 };
    glDrawBuffers(2, bufs);
    GLenum st = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (st != GL_FRAMEBUFFER_COMPLETE) {
        fprintf(stderr, "prep FBO incomplete 0x%x\n", st);
        exit(3);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    return t;
}
static void init_resources(const char *shaderDir) {
    char path[640];
    snprintf(path, sizeof(path), "%s/prep.vert", shaderDir);
    char *prepVs = load_shader(path, shaderDir);
    snprintf(path, sizeof(path), "%s/prep.frag", shaderDir);
    char *prepFs = load_shader(path, shaderDir);
    prepProg = link_program(prepVs, prepFs);

    snprintf(path, sizeof(path), "%s/sss.vert", shaderDir);
    char *sssVs = load_shader(path, shaderDir);
    snprintf(path, sizeof(path), "%s/sss.frag", shaderDir);
    char *sssFs = load_shader(path, shaderDir);
    sssProg = link_program(sssVs, sssFs);

    sphere = mesh_create_uv_sphere(48, 64);
    frontTarget = make_prep_target(W, H);
    backTarget = make_prep_target(W, H);
}

static void set_mat4(GLuint prog, const char *name, Mat4 m) {
    GLint loc = glGetUniformLocation(prog, name);
    glUniformMatrix4fv(loc, 1, GL_FALSE, m.m);
}

// Render the mesh twice to capture front and back view-space surfaces.
static void run_prep(Mat4 model, Mat4 view, Mat4 proj) {
    glUseProgram(prepProg);
    set_mat4(prepProg, "uModel", model);
    set_mat4(prepProg, "uView", view);
    set_mat4(prepProg, "uProj", proj);
    glBindVertexArray(sphere.vao);
    glEnable(GL_DEPTH_TEST);
    glEnable(GL_CULL_FACE);

    // Back (far) surface: cull the near/front faces, keep the far interior.
    glBindFramebuffer(GL_FRAMEBUFFER, backTarget.fbo);
    GLfloat clear[4] = {0, 0, 0, 0};
    glClearBufferfv(GL_COLOR, 0, clear);
    glClearBufferfv(GL_COLOR, 1, clear);
    glClearDepthf(1.0f);
    glClear(GL_DEPTH_BUFFER_BIT);
    glCullFace(GL_FRONT);
    glDrawElements(GL_TRIANGLES, sphere.indexCount, GL_UNSIGNED_INT, 0);

    // Front (near) surface: standard back-face culling keeps the near wall.
    glBindFramebuffer(GL_FRAMEBUFFER, frontTarget.fbo);
    glClearBufferfv(GL_COLOR, 0, clear);
    glClearBufferfv(GL_COLOR, 1, clear);
    glClearDepthf(1.0f);
    glClear(GL_DEPTH_BUFFER_BIT);
    glCullFace(GL_BACK);
    glDrawElements(GL_TRIANGLES, sphere.indexCount, GL_UNSIGNED_INT, 0);

    glDisable(GL_CULL_FACE);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

static Vec3 light_direction(LightCase lc) {
    switch (lc) {
        case LIGHT_FRONT: return (Vec3){ 0.0f, 0.0f, 1.0f };
        case LIGHT_BACK:  return (Vec3){ 0.0f, 0.0f, -1.0f };
        case LIGHT_SIDE:  return (Vec3){ 1.0f, 0.0f, 0.0f };
    }
    return (Vec3){ 0, 0, 1 };
}

static const char *light_name(LightCase lc) {
    return lc == LIGHT_FRONT ? "front" : lc == LIGHT_BACK ? "back" : "side";
}

static void apply_material_uniforms(const MaterialConfig *mc) {
    glUniform3fv(glGetUniformLocation(sssProg, "uSurfaceColor"), 1,
                 mc->surfaceColor);
    glUniform3fv(glGetUniformLocation(sssProg, "uScatterColor"), 1,
                 mc->scatterColor);
    glUniform1f(glGetUniformLocation(sssProg, "uCurvatureScale"),
                mc->curvatureScale);
    glUniform1f(glGetUniformLocation(sssProg, "uDensity"), mc->density);
    glUniform1f(glGetUniformLocation(sssProg, "uWrap"), mc->wrap);
    glUniform1f(glGetUniformLocation(sssProg, "uScatterStrength"),
                mc->scatterStrength);
    glUniform1f(glGetUniformLocation(sssProg, "uAnisotropy"),
                mc->anisotropy);
    glUniform1f(glGetUniformLocation(sssProg, "uScatterPower"),
                mc->scatterPower);
    glUniform1f(glGetUniformLocation(sssProg, "uThicknessScale"),
                mc->thicknessScale);
    glUniform1f(glGetUniformLocation(sssProg, "uSssGain"), 1.8f);
    glUniform1f(glGetUniformLocation(sssProg, "uSpecular"), mc->specular);
    glUniform1f(glGetUniformLocation(sssProg, "uShininess"),
                mc->shininess);
}
static void run_sss(const MaterialConfig *mc, LightCase lc, int debugMode,
                    Mat4 model, Mat4 view, Mat4 proj, int lightOn) {
    glUseProgram(sssProg);
    set_mat4(sssProg, "uModel", model);
    set_mat4(sssProg, "uView", view);
    set_mat4(sssProg, "uProj", proj);

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, frontTarget.posTex);
    glUniform1i(glGetUniformLocation(sssProg, "uFrontPos"), 0);
    glActiveTexture(GL_TEXTURE1);
    glBindTexture(GL_TEXTURE_2D, backTarget.posTex);
    glUniform1i(glGetUniformLocation(sssProg, "uBackPos"), 1);
    glActiveTexture(GL_TEXTURE2);
    glBindTexture(GL_TEXTURE_2D, frontTarget.normalTex);
    glUniform1i(glGetUniformLocation(sssProg, "uFrontNormal"), 2);
    glActiveTexture(GL_TEXTURE0);

    glUniform2f(glGetUniformLocation(sssProg, "uTexel"),
                1.0f / (float)W, 1.0f / (float)H);
    Vec3 L = light_direction(lc);
    glUniform3f(glGetUniformLocation(sssProg, "uLightDir"), L.x, L.y, L.z);
    // Zero light colour is the strict "no emission" guard: every radiance
    // term (diffuse, SSS, specular) is multiplied by this, so the frame must
    // collapse to the background clear colour with no self-lit glow.
    float lightIntensity = lightOn ? 1.0f : 0.0f;
    glUniform3f(glGetUniformLocation(sssProg, "uLightColor"),
                lightIntensity, lightIntensity, lightIntensity);
    glUniform3f(glGetUniformLocation(sssProg, "uCameraPos"), 0.0f, 0.0f,
                4.2f);
    glUniform1i(glGetUniformLocation(sssProg, "uDebugMode"), debugMode);
    apply_material_uniforms(mc);

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glBindVertexArray(sphere.vao);
    // Mesh is CCW with outward normals; cull back faces so the visible
    // fragment always carries the front (camera-facing) normal and depth.
    glEnable(GL_CULL_FACE);
    glCullFace(GL_BACK);
    glEnable(GL_DEPTH_TEST);
    glClearColor(0.02f, 0.02f, 0.03f, 1.0f);
    glClearDepthf(1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glDrawElements(GL_TRIANGLES, sphere.indexCount, GL_UNSIGNED_INT, 0);
}

// Full-frame readback. llvmpipe rejects full-frame GL_FLOAT on the default
// framebuffer (GL_INVALID_OPERATION), so normalized unsigned bytes are used.
static unsigned char *read_frame_rgba(void) {
    unsigned char *buf = (unsigned char *)malloc(4 * W * H);
    glReadPixels(0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, buf);
    return buf;
}

// Average color over a boolean mask (1 = include). Background is the dark
// clear colour, so coverage is derived from luminance above a small epsilon.
static void mask_average(const unsigned char *frame, const unsigned char *mask,
                         float out[4]) {
    double acc[4] = {0, 0, 0, 0};
    long count = 0;
    for (int i = 0; i < W * H; ++i) {
        if (!mask[i]) continue;
        for (int c = 0; c < 4; ++c)
            acc[c] += frame[i * 4 + c] / 255.0;
        ++count;
    }
    for (int c = 0; c < 4; ++c)
        out[c] = count ? (float)(acc[c] / (double)count) : 0.0f;
}

// Build silhouette-aware center and rim masks from the rendered frame.
// The object occupies a roughly elliptical silhouette; the rim is a thin band
// just inside it where geometry is thin, the center is the thick core.
static void build_probe_masks(const unsigned char *frame,
                              unsigned char *centerMask,
                              unsigned char *rimMask) {
    // Find the object bounding box on the central row/column via luminance.
    int minX = W, maxX = 0, minY = H, maxY = 0;
    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            int o = (y * W + x) * 4;
            float lum = 0.2126f * frame[o] + 0.7152f * frame[o + 1] +
                        0.0722f * frame[o + 2];
            if (lum > 12.0f) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    float cx = (minX + maxX) * 0.5f, cy = (minY + maxY) * 0.5f;
    float rx = (maxX - minX) * 0.5f, ry = (maxY - minY) * 0.5f;
    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            float ex = (x - cx) / (rx + 1e-4f);
            float ey = (y - cy) / (ry + 1e-4f);
            float r = sqrtf(ex * ex + ey * ey);
            int idx = y * W + x;
            centerMask[idx] = (r < 0.30f) ? 1 : 0;
            // Thin band: 78%..92% of the way to the silhouette edge.
            rimMask[idx] = (r > 0.78f && r < 0.92f) ? 1 : 0;
        }
    }
}

static void save_png(const char *path) {
    unsigned char *rgb = (unsigned char *)malloc(3 * W * H);
    unsigned char *fbuf = (unsigned char *)malloc(4 * W * H);
    glReadPixels(0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, fbuf);
    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            // Flip vertically: GL origin is bottom-left, PNG is top-left.
            int src = ((H - 1 - y) * W + x) * 4;
            int dst = (y * W + x) * 3;
            for (int c = 0; c < 3; ++c) {
                rgb[dst + c] = fbuf[src + c];
            }
        }
    }
    stbi_write_png(path, W, H, 3, rgb, W * 3);
    free(rgb);
    free(fbuf);
    fprintf(stderr, "[png] %s\n", path);
}
#include <string.h>

typedef struct {
    float center[4];
    float rim[4];
} Probes;

// Probes are silhouette-aware so they work for both the round jade sphere and
// the flattened skin ellipsoid without hard-coded screen boxes.
static Probes capture_probes(const unsigned char *frame) {
    Probes p;
    unsigned char *centerMask = (unsigned char *)calloc(W * H, 1);
    unsigned char *rimMask = (unsigned char *)calloc(W * H, 1);
    build_probe_masks(frame, centerMask, rimMask);
    mask_average(frame, centerMask, p.center);
    mask_average(frame, rimMask, p.rim);
    free(centerMask);
    free(rimMask);
    return p;
}

static float luminance(const float c[4]) {
    return 0.2126f * c[0] + 0.7152f * c[1] + 0.0722f * c[2];
}

int main(int argc, char **argv) {
    const char *shaderDir = "src/shaders";
    const char *outDir = "artifacts";
    for (int i = 1; i < argc; ++i) {
        if (strncmp(argv[i], "--shaders=", 10) == 0)
            shaderDir = argv[i] + 10;
        else if (strncmp(argv[i], "--out=", 6) == 0)
            outDir = argv[i] + 6;
        else if (strcmp(argv[i], "--no-light") == 0)
            g_lightOn = 0;
    }

    if (!egl_app_init(W, H)) return 1;
    init_resources(shaderDir);

    Vec3 eye = {0, 0, 4.2f};
    Vec3 center = {0, 0, 0};
    Vec3 up = {0, 1, 0};
    Mat4 view = mat4_look_at(eye, center, up);
    Mat4 proj = mat4_perspective((float)M_PI / 4.0f,
                                 (float)W / (float)H, 0.1f, 100.0f);

    printf("{\n  \"renders\": [\n");
    int first = 1;
    for (int mi = 0; mi < 2; ++mi) {
        const MaterialConfig *mc = &MATERIALS[mi];
        Mat4 model = mat4_scale(mc->modelScale[0], mc->modelScale[1],
                                mc->modelScale[2]);
        run_prep(model, view, proj);

        for (int li = 0; li < 3; ++li) {
            LightCase lc = (LightCase)li;
            // Final composite + every debug mode for the back-lit case.
            for (int dbg = 0; dbg <= 5; ++dbg) {
                if (dbg > 0 && lc != LIGHT_BACK) continue;
                run_sss(mc, lc, dbg, model, view, proj, g_lightOn);
                char name[256];
                const char *dbgName = dbg == 0 ? "final" :
                    dbg == 1 ? "thickness" : dbg == 2 ? "scatter" :
                    dbg == 3 ? "normals" : dbg == 4 ? "curvature" :
                    "diffuse";
                snprintf(name, sizeof(name),
                         "%s/%s_%s_%s.png", outDir, mc->name,
                         light_name(lc), dbgName);
                save_png(name);

                if (dbg == 0 || dbg == 1 || dbg == 2 || dbg == 5) {
                    unsigned char *frame = read_frame_rgba();
                    Probes p = capture_probes(frame);
                    free(frame);
                    if (!first) printf(",\n");
                    first = 0;
                    printf("    {\"material\":\"%s\",\"light\":\"%s\","
                           "\"mode\":\"%s\",\"centerL\":%.4f,"
                           "\"rimL\":%.4f,\"center\":[%.4f,%.4f,%.4f],"
                           "\"rim\":[%.4f,%.4f,%.4f]}",
                           mc->name, light_name(lc), dbgName,
                           luminance(p.center), luminance(p.rim),
                           p.center[0], p.center[1], p.center[2],
                           p.rim[0], p.rim[1], p.rim[2]);
                }
            }
        }
    }
    printf("\n  ]\n}\n");
    glFinish();
    return 0;
}
