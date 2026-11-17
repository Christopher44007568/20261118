"""HDR env prefilter pipeline: generate, mip, render, verify."""
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import envmap
import prefilter
import brdf_lut
import render
import checks
import hdr_io

ART = "artifacts"
H, W = 512, 1024

MATERIALS = {
    "mirror": {"roughness": 0.0, "f0": (0.92, 0.92, 0.92)},
    "rough_metal": {"roughness": 0.45, "f0": (1.0, 0.71, 0.29)},
    "water": {"roughness": 0.08, "f0": (0.02, 0.02, 0.02),
              "tint": (0.85, 0.95, 1.0),
              "diffuse": 0.1, "albedo": (0.02, 0.09, 0.11)},
}


def main():
    os.makedirs(f"{ART}/mips", exist_ok=True)
    report = []

    t0 = time.time()
    env = envmap.generate_env(H, W)
    hdr_io.save_png(env, f"{ART}/env_original.png")
    hdr_io.save_hdr(env, f"{ART}/env_original.hdr")
    report.append(f"env {W}x{H}, max {env.max():.1f}, "
                  f"weighted mean {prefilter.weighted_mean(env).round(4)}")

    mips = prefilter.build_mip_chain(env)
    for i, m in enumerate(mips):
        hdr_io.save_png(m, f"{ART}/mips/mip_{i}.png")
    contact = np.concatenate(
        [np.repeat(np.repeat(m, H // m.shape[0], axis=0), 2, axis=1)
         if m.shape[0] < H else m for m in mips], axis=1)
    hdr_io.save_png(contact, f"{ART}/mips_contact.png")

    lut = brdf_lut.integrate_brdf_lut(64, 512)
    report.append(f"setup {time.time() - t0:.1f}s, {len(mips)} mip levels")

    spheres = [render.render_sphere(mips, lut, m, size=384)
               for m in MATERIALS.values()]
    hdr_io.save_png(np.concatenate(spheres, axis=1), f"{ART}/spheres.png")

    fr_rows, fr_imgs = checks.white_furnace(lut)
    hdr_io.save_png(np.concatenate(fr_imgs, axis=1), f"{ART}/check_furnace.png")
    report.append("white furnace (constant env=1, F0=1; ideal = 1.0):")
    for r, mean, lo, hi in fr_rows:
        report.append(f"  roughness {r:.2f}: mean {mean:.4f} "
                      f"min {lo:.4f} max {hi:.4f}")

    report.append("real-env reflectance (F0=1 sphere mean / env mean):")
    for r, ratio in checks.env_reflectance(mips, lut):
        report.append(f"  roughness {r:.2f}: {ratio:.4f}")

    report.append("material reflected luminance / env mean (must be <= ~1):")
    for name, ratio in checks.material_energy(mips, lut, MATERIALS):
        report.append(f"  {name}: {ratio:.4f}")

    report.append("seam check per mip (seam diff / interior diff, ~1 = invisible):")
    for i, seam, interior, ratio, pt, pb in checks.seam_stats(mips):
        report.append(f"  mip{i}: seam {seam:.4e} interior {interior:.4e} "
                      f"ratio {ratio:.3f} pole_std {pt:.4e}/{pb:.4e}")

    rolled = [np.roll(m, m.shape[1] // 2, axis=1) for m in mips]
    seam_img = render.render_sphere(rolled, lut, MATERIALS["mirror"], size=384)
    hdr_io.save_png(seam_img, f"{ART}/check_seam_mirror.png")
    pole_img = render.render_sphere(mips, lut, MATERIALS["mirror"], size=384,
                                    cam_pos=(0.0, 3.2, 0.001))
    hdr_io.save_png(pole_img, f"{ART}/check_pole_mirror.png")

    test_dirs = np.array([[0.3, 0.5, 0.8], [-0.6, -0.2, 0.7], [0.9, 0.1, -0.4]])
    test_dirs /= np.linalg.norm(test_dirs, axis=1, keepdims=True)
    jt, jn, tri, near, rough = checks.mip_continuity(mips, test_dirs[0])
    report.append(f"mip continuity: max step jump trilinear {jt:.4e}, "
                  f"nearest {jn:.4e}")
    strip_tri = np.repeat(tri[None, :, :], 96, axis=0)
    strip_near = np.repeat(near[None, :, :], 96, axis=0)
    gap = np.zeros((16, tri.shape[0], 3))
    hdr_io.save_png(np.concatenate([strip_near, gap, strip_tri], axis=0),
                    f"{ART}/mip_continuity.png")

    from PIL import Image

    def _fit_width(img8, width):
        h, w = img8.shape[:2]
        return np.array(Image.fromarray(img8).resize(
            (width, max(1, int(h * width / w))), Image.BILINEAR))

    top8 = hdr_io.to_srgb8(env)
    mid8 = _fit_width(hdr_io.to_srgb8(contact), W)
    sph = np.concatenate(spheres, axis=1)
    sph8 = _fit_width(hdr_io.to_srgb8(sph), W)
    sep = np.zeros((8, W, 3), dtype=np.uint8)
    Image.fromarray(
        np.concatenate([top8, sep, mid8, sep, sph8], axis=0)
    ).save(f"{ART}/comparison.png")

    text = "\n".join(report)
    print(text)
    with open(f"{ART}/report.txt", "w") as f:
        f.write(text + "\n")


if __name__ == "__main__":
    main()
