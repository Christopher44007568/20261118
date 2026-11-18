#include <cstdio>
#include <string>
#include <vector>
#include <filesystem>
#include "geometry.h"
#include "render.h"

static int RES = 320;
static int g_failures = 0;

static void checkNaN(const std::string& name, const Image& img) {
    int n = img.countNaN();
    if (n > 0) {
        std::printf("FAIL  %-36s %d NaN pixels\n", name.c_str(), n);
        g_failures++;
    } else {
        std::printf("ok    %-36s no NaN\n", name.c_str());
    }
}

static Image gridImage(const std::vector<Image>& imgs, int cols, Vec3 bg) {
    int rows = (int)(imgs.size() + cols - 1) / cols;
    int w = imgs[0].w, h = imgs[0].h, pad = 4;
    Image g(cols * (w + pad) + pad, rows * (h + pad) + pad);
    for (auto& p : g.px) p = bg;
    for (size_t i = 0; i < imgs.size(); i++) {
        int ox = pad + (int)(i % cols) * (w + pad);
        int oy = pad + (int)(i / cols) * (h + pad);
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                g.at(ox + x, oy + y) = imgs[i].at(x, y);
    }
    return g;
}

static Image renderOne(const Mesh& m, const NormalMap& nm, const Camera& cam,
                       ShadingMode mode, VizMode viz, float rot = 0.0f,
                       const Light* light = nullptr) {
    Renderer r(RES, RES, cam);
    if (light) r.light = *light;
    RenderOptions opt;
    opt.mode = mode;
    opt.viz = viz;
    opt.normalRotation = rot;
    r.render(m, nm, opt);
    return r.img;
}

// Centroid angle (degrees, screen space) of bright specular pixels,
// measured around the image center. Returns false if no clear highlight.
static bool highlightAngle(const Image& img, float& angleDeg, float& radius) {
    float mx = 0;
    for (auto& p : img.px) mx = std::max(mx, p.x);
    if (mx < 1e-4f) return false;
    double sx = 0, sy = 0, sw = 0;
    float cx = img.w * 0.5f, cy = img.h * 0.5f;
    for (int y = 0; y < img.h; y++)
        for (int x = 0; x < img.w; x++) {
            float v = img.at(x, y).x;
            if (v < mx * 0.6f) continue;
            sx += x * v; sy += y * v; sw += v;
        }
    if (sw < 1e-6) return false;
    double dx = sx / sw - cx, dy = sy / sw - cy;
    radius = (float)(std::sqrt(dx * dx + dy * dy) / (img.w * 0.5));
    angleDeg = (float)(std::atan2(dy, dx) * 180.0 / 3.14159265358979);
    return radius > 0.03f; // centroid must sit clearly off-center
}

int main() {
    std::filesystem::create_directories("out");
    NormalMap brick = makeBrickNormalMap();
    NormalMap bump = makeBumpNormalMap();
    NormalMap slant = makeSlantNormalMap(0.3f, 0.4f);

    Mesh wall = makePlane(32, false);   computeTangents(wall);   // brick wall
    Mesh sphere = makeSphere();          computeTangents(sphere); // sphere
    Mesh plane = makePlane(32, true);    computeTangents(plane);  // mirrored plane
    Mesh degen = makeDegeneratePlane();  computeTangents(degen);  // broken UVs

    Camera cam; // perspective, eye (0,0,3.2) looking at origin

    struct Geom { const char* name; const Mesh* mesh; const NormalMap* nm; };
    std::vector<Geom> geoms = {
        {"brickwall", &wall, &brick},
        {"sphere", &sphere, &bump},
        {"plane", &plane, &brick},
    };
    std::vector<std::pair<std::string, ShadingMode>> modes = {
        {"notangent", ShadingMode::NoTangent},
        {"reconstructed", ShadingMode::Reconstructed},
        {"exported", ShadingMode::Exported},
    };

    std::printf("== 1. geometry x shading-mode comparison ==\n");
    std::vector<Image> grid;
    for (auto& g : geoms)
        for (auto& mo : modes) {
            std::string tag = std::string(g.name) + "_" + mo.first;
            Image img = renderOne(*g.mesh, *g.nm, cam, mo.second, VizMode::Lit);
            checkNaN(tag, img);
            png::write("out/" + tag + ".png", img);
            grid.push_back(img);
        }
    png::write("out/compare.png", gridImage(grid, 3, {0.15f, 0.15f, 0.18f}));

    std::printf("== 2. TBN basis visualization ==\n");
    std::vector<std::pair<std::string, VizMode>> viz = {
        {"T", VizMode::Tangent}, {"B", VizMode::Bitangent}, {"N", VizMode::Normal},
    };
    for (auto& g : geoms) {
        std::vector<Image> row;
        for (auto& mo : {ShadingMode::Reconstructed, ShadingMode::Exported})
            for (auto& vz : viz) {
                Image img = renderOne(*g.mesh, *g.nm, cam, mo, vz.second);
                checkNaN(std::string("tbn_") + g.name + "_" + vz.first, img);
                row.push_back(img);
            }
        png::write(std::string("out/tbn_") + g.name + ".png",
                   gridImage(row, 3, {0.1f, 0.1f, 0.1f}));
    }

    std::printf("== 3. normal-map rotation moves the highlight ==\n");
    {
        const float pi = 3.14159265358979f;
        // A constant slanted normal map on a flat plane puts the specular
        // highlight at a spot set purely by the tilt direction, so rotating
        // the map by theta must rotate the highlight by theta.
        Light headOn;
        headOn.dir = normalize(Vec3{0.0f, 0.0f, -1.0f});
        headOn.specStrength = 3.0f; // brighten the highlight for the strip
        NormalMap slantX = makeSlantNormalMap(0.6f, 0.0f);
        for (auto mode : {ShadingMode::Reconstructed, ShadingMode::Exported}) {
            const char* mname = mode == ShadingMode::Reconstructed
                                    ? "reconstructed" : "exported";
            std::vector<Image> strip;
            std::vector<float> angles;
            bool usable = true;
            for (int deg : {0, 45, 90, 135}) {
                float rot = deg * pi / 180.0f;
                Image spec = renderOne(wall, slantX, cam, mode, VizMode::Specular,
                                       rot, &headOn);
                Image lit = renderOne(wall, slantX, cam, mode, VizMode::Lit,
                                      rot, &headOn);
                checkNaN(std::string("rotate_") + mname + "_" + std::to_string(deg),
                         lit);
                strip.push_back(spec); // specular view shows the moving highlight
                float a, r;
                if (!highlightAngle(spec, a, r)) {
                    std::printf("FAIL  rotate_%s_%d no usable highlight\n", mname, deg);
                    g_failures++;
                    usable = false;
                    break;
                }
                angles.push_back(a);
            }
            if (usable) {
                bool pass = true;
                for (int i = 0; i + 1 < (int)angles.size(); i++) {
                    float d = angles[i + 1] - angles[i];
                    while (d > 180) d -= 360;
                    while (d < -180) d += 360;
                    if (std::fabs(d - 45.0f) > 20.0f) pass = false;
                    std::printf("      %-13s step %d: highlight moved %.1f deg\n",
                                mname, i, d);
                }
                std::printf(pass ? "ok    " : "FAIL  ");
                std::printf("%s highlight follows map rotation\n", mname);
                if (!pass) g_failures++;
            }
            if (mode == ShadingMode::Reconstructed) {
                for (int i = 0; i < 4; i++)
                    png::write("out/rotate_" + std::to_string(i * 45) + ".png",
                               strip[i]);
                png::write("out/rotate_strip.png",
                           gridImage(strip, 4, {0.1f, 0.1f, 0.1f}));
            }
        }
    }

    std::printf("== 4. degenerate UVs produce no NaN ==\n");
    {
        std::vector<Image> row;
        for (auto& mo : modes) {
            Image img = renderOne(degen, brick, cam, mo.second, VizMode::Lit);
            checkNaN("degenerate_" + mo.first, img);
            row.push_back(img);
        }
        for (auto& vz : viz) {
            Image img = renderOne(degen, brick, cam, ShadingMode::Reconstructed,
                                  vz.second);
            checkNaN(std::string("degenerate_tbn_") + vz.first, img);
            row.push_back(img);
        }
        png::write("out/degenerate.png", gridImage(row, 3, {0.1f, 0.1f, 0.1f}));
    }

    std::printf("== 5. mirrored UVs keep lighting consistent ==\n");
    {
        Camera ortho;
        ortho.eye = {0, 0, 50};
        ortho.orthoHalf = 1.05f;
        ortho.build();
        Light sym; // symmetric about the mirror plane (x = 0): L.x == 0
        sym.dir = normalize(Vec3{0.0f, -0.4f, -0.9f});

        auto maxMirrorDiff = [&](const Image& img) {
            float worst = 0;
            for (int y = 0; y < img.h; y++)
                for (int x = 0; x < img.w / 2; x++) {
                    Vec3 a = img.at(x, y), b = img.at(img.w - 1 - x, y);
                    if (a.x + a.y + a.z < 0.03f || b.x + b.y + b.z < 0.03f)
                        continue; // background
                    worst = std::max(worst, std::fabs(a.x - b.x));
                    worst = std::max(worst, std::fabs(a.y - b.y));
                    worst = std::max(worst, std::fabs(a.z - b.z));
                }
            return worst;
        };

        std::vector<Image> row;
        struct MC { const char* name; ShadingMode m; float expect; bool upper; };
        std::vector<MC> cases = {
            {"mirror_reconstructed", ShadingMode::Reconstructed, 0.03f, true},
            {"mirror_exported", ShadingMode::Exported, 0.03f, true},
            {"mirror_naive_no_handedness", ShadingMode::NaiveNoHandedness, 0.05f, false},
        };
        for (auto& c : cases) {
            Image img = renderOne(plane, slant, ortho, c.m, VizMode::Lit, 0.0f, &sym);
            checkNaN(c.name, img);
            png::write(std::string("out/") + c.name + ".png", img);
            row.push_back(img);
            float d = maxMirrorDiff(img);
            bool pass = c.upper ? (d < c.expect) : (d > c.expect);
            std::printf("%s %-30s mirrored-pair max diff %.4f (%s %.2f)\n",
                        pass ? "ok  " : "FAIL", c.name, d,
                        c.upper ? "must be <" : "must be >", c.expect);
            if (!pass) g_failures++;
        }
        png::write("out/mirror.png", gridImage(row, 3, {0.1f, 0.1f, 0.1f}));
    }

    std::printf(g_failures ? "RESULT: %d failure(s)\n" : "RESULT: all checks passed\n",
                g_failures);
    return g_failures;
}
