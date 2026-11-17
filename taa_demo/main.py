"""TAA demo: three test scenes, three-view panels, rejection metrics."""
import os
import numpy as np
from PIL import Image, ImageDraw

from taa_demo.renderer import Mesh, Camera, rasterize, jitter_sequence
from taa_demo.taa import TAA

W, H = 384, 216
OUT = os.path.join(os.path.dirname(__file__), "..", "artifacts", "taa")


def build_mesh(mover_x=None):
    m = Mesh()
    m.add_box((0, 2.0, -8), (14, 4, 0.3), (0.8, 0.75, 0.7), checker=2.0)
    m.add_box((0, -0.05, -12), (40, 0.1, 23), (0.5, 0.5, 0.55), checker=0.5)
    m.add_box((-6.5, 1.5, -6), (0.3, 3, 6), (0.6, 0.55, 0.5), checker=1.5)
    for x in np.arange(-2.2, 2.21, 0.4):
        m.add_box((x, 1.0, -4), (0.045, 2.0, 0.045), (0.12, 0.12, 0.15))
    m.add_box((0, 2.05, -4), (4.6, 0.08, 0.08), (0.2, 0.2, 0.22))
    if mover_x is not None:
        m.add_box((mover_x, 0.6, -3.2), (0.9, 1.2, 0.9), (0.85, 0.3, 0.2))
    return m


def render_reference(mesh, cam, scale=4):
    c, _, _ = rasterize(mesh, cam, W * scale, H * scale)
    return c.reshape(H, scale, W, scale, 3).mean((1, 3))


def make_panel(images, labels, path, scale=2):
    ims = [Image.fromarray((np.clip(i, 0, 1) * 255).astype(np.uint8))
           for i in images]
    ims = [i.resize((W * scale, H * scale), Image.NEAREST) for i in ims]
    bar, pad = 18, 6
    pw, ph = ims[0].size
    panel = Image.new("RGB", (len(ims) * (pw + pad) + pad, ph + bar + 2 * pad),
                      (24, 24, 24))
    d = ImageDraw.Draw(panel)
    for k, (im, lab) in enumerate(zip(ims, labels)):
        x = pad + k * (pw + pad)
        panel.paste(im, (x, pad + bar))
        d.text((x + 4, pad + 3), lab, fill=(230, 230, 230))
    panel.save(path)


def make_zoom_panel(images, labels, crop, path, scale=6):
    x0, y0, cw, ch = crop
    ims = []
    for img in images:
        im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
        im = im.crop((x0, y0, x0 + cw, y0 + ch))
        ims.append(im.resize((cw * scale, ch * scale), Image.NEAREST))
    bar, pad = 18, 6
    pw, ph = ims[0].size
    panel = Image.new("RGB", (len(ims) * (pw + pad) + pad, ph + bar + 2 * pad),
                      (24, 24, 24))
    d = ImageDraw.Draw(panel)
    for k, (im, lab) in enumerate(zip(ims, labels)):
        x = pad + k * (pw + pad)
        panel.paste(im, (x, pad + bar))
        d.text((x + 4, pad + 3), lab, fill=(230, 230, 230))
    panel.save(path)


def run_scene(name, n_frames, cam_fn, mover_fn=None, naive_compare=False,
              reference=False, panel_frames=()):
    os.makedirs(OUT, exist_ok=True)
    jit = jitter_sequence(n_frames)
    taa = TAA(W, H)
    taa_naive = TAA(W, H) if naive_compare else None
    ref = None
    rows = []
    print(f"\n=== {name} ===")
    hdr = "frame  valid%  rejected%   mse_raw   mse_taa"
    if naive_compare:
        hdr += "  mse_naive"
    print(hdr)
    for i in range(n_frames):
        cam = cam_fn(i)
        mesh = build_mesh(mover_fn(i) if mover_fn else None)
        color, depth, _ = rasterize(mesh, cam, W, H, tuple(jit[i]))
        V = cam.view_matrix()
        P = cam.proj_matrix(W / H, (0.0, 0.0), (W, H))
        hist_view = taa.history_color if taa.has_history else color
        out, st = taa.process(color, depth, V, P, tuple(jit[i]))
        out_nv = None
        if naive_compare:
            out_nv, _ = taa_naive.process(color, depth, V, P, tuple(jit[i]),
                                          naive=True)
        mse_raw = mse_taa = mse_naive = float("nan")
        if reference:
            if ref is None:
                ref = render_reference(build_mesh(mover_fn(0) if mover_fn else None),
                                       cam_fn(0))
            mse_raw = float(((color - ref) ** 2).mean())
            mse_taa = float(((out - ref) ** 2).mean())
        if naive_compare:
            sharp, _, _ = rasterize(mesh, cam, W, H)  # unjittered current frame
            mse_raw = float(((color - sharp) ** 2).mean())
            mse_taa = float(((out - sharp) ** 2).mean())
            mse_naive = float(((out_nv - sharp) ** 2).mean())
        rows.append((i, st["valid_ratio"], st["rejected_ratio"], mse_raw,
                     mse_taa, mse_naive))
        line = (f"{i:4d}  {st['valid_ratio']*100:6.1f}  "
                f"{st['rejected_ratio']*100:8.1f}   {mse_raw:8.5f}  {mse_taa:8.5f}")
        if naive_compare:
            line += f"  {mse_naive:9.5f}"
        print(line)
        if i in panel_frames:
            views = [color, hist_view, out]
            labels = ["1 current (jittered input)", "2 history buffer",
                      "3 TAA result"]
            if naive_compare:
                views.append(out_nv)
                labels.append("4 naive blend (no rejection)")
            make_panel(views, labels,
                       os.path.join(OUT, f"{name}_frame{i:03d}_views.png"))
            make_zoom_panel(views, labels, (128, 60, 128, 72),
                            os.path.join(OUT, f"{name}_frame{i:03d}_zoom.png"))
    return rows


def plot_convergence(rows, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fr = [r[0] for r in rows]
    plt.figure(figsize=(6, 4))
    plt.plot(fr, [r[3] for r in rows], "o--", label="raw jittered input")
    plt.plot(fr, [r[4] for r in rows], "s-", label="TAA output")
    plt.xlabel("frame")
    plt.ylabel("MSE vs 4x supersampled reference")
    plt.title("Static camera: TAA convergence")
    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(path, dpi=110)
    plt.close()


def main():
    os.makedirs(OUT, exist_ok=True)
    # Scene 1: thin railings, static camera -> must converge
    rows1 = run_scene(
        "railings_static", 24,
        cam_fn=lambda i: Camera((0, 1.2, 0), 0, -5),
        reference=True, panel_frames=(0, 23))
    plot_convergence(rows1, os.path.join(OUT, "railings_static_convergence.png"))

    # Scene 2: fast camera pan -> history must be rejected, no ghost walls
    rows2 = run_scene(
        "fast_pan", 20,
        cam_fn=lambda i: Camera((0, 1.2, 0), -30 + 60 * i / 19, -5),
        naive_compare=True, panel_frames=(10,))

    # Scene 3: dynamic object crossing -> disocclusion rejection
    rows3 = run_scene(
        "dynamic_object", 24,
        cam_fn=lambda i: Camera((0, 1.2, 0), -4 + 8 * i / 23, -5),
        mover_fn=lambda i: -3.0 + 6.0 * i / 23,
        panel_frames=(12,))

    summary = os.path.join(OUT, "metrics.txt")
    with open(summary, "w") as f:
        for name, rows in (("railings_static", rows1), ("fast_pan", rows2),
                           ("dynamic_object", rows3)):
            f.write(f"[{name}]\n")
            f.write("frame valid_ratio rejected_ratio mse_raw mse_taa mse_naive\n")
            for r in rows:
                f.write(f"{r[0]} {r[1]:.4f} {r[2]:.4f} {r[3]:.6f} {r[4]:.6f}"
                        f" {r[5]:.6f}\n")
            v = np.mean([r[1] for r in rows[1:]])
            rej = np.mean([r[2] for r in rows[1:]])
            f.write(f"mean_valid={v:.4f} mean_rejected={rej:.4f}\n\n")
    print(f"\nArtifacts written to {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
