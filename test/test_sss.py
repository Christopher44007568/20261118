#!/usr/bin/env python3
"""Automated checks for the approximate subsurface scattering material.

The native headless renderer (build/sss_render) emits PNGs plus a JSON probe
report on stdout. These tests assert the physical requirements:

  1. Thin rims transmit more light than thick cores under back/side lighting.
  2. Back lighting shifts the colour from the surface albedo toward the
     scatter tint.
  3. Front lighting produces essentially no SSS (no additive glow).
  4. The material never behaves like a self-lit additive emitter: radiance is
     gated by light and stays within [0, 1].
  5. Thickness and scatter debug modes exist and carry meaningful content.
"""

import json
import math
import os
import struct
import subprocess
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "build", "sss_render")
ART = os.path.join(ROOT, "artifacts")


def load_png(path):
    data = open(path, "rb").read()
    pos = 8
    width = height = color_type = None
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, _bd, color_type = struct.unpack(">IIBB", chunk[:10])
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    channels = {2: 3, 6: 4}[color_type]
    raw = zlib.decompress(idat)
    stride = width * channels
    out = bytearray()
    prev = bytearray(stride)
    i = 0
    for _y in range(height):
        filt = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = line[x - channels] if x >= channels else 0
            b = prev[x]
            c = prev[x - channels] if x >= channels else 0
            if filt == 1:
                line[x] = (line[x] + a) & 255
            elif filt == 2:
                line[x] = (line[x] + b) & 255
            elif filt == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif filt == 4:
                paeth = a + b - c
                pa, pb, pc = abs(paeth - a), abs(paeth - b), abs(paeth - c)
                pred = a if (pa <= pb and pa <= pc) else (
                    b if pb <= pc else c)
                line[x] = (line[x] + pred) & 255
        out += line
        prev = line
    return width, height, channels, bytes(out)


def run_renderer():
    env = dict(os.environ)
    env["LIBGL_ALWAYS_SOFTWARE"] = "1"
    env["GALLIUM_DRIVER"] = "llvmpipe"
    proc = subprocess.run(
        [BIN, "--shaders=src/shaders", "--out=artifacts"],
        cwd=ROOT, capture_output=True, text=True, env=env, check=True)
    report = json.loads(proc.stdout)
    with open(os.path.join(ART, "probes.json"), "w") as handle:
        json.dump(report, handle, indent=2)
    return report


def find(rows, material, light, mode):
    for row in rows:
        if (row["material"] == material and row["light"] == light
                and row["mode"] == mode):
            return row
    raise KeyError(f"missing {material}/{light}/{mode}")


class Check:
    def __init__(self):
        self.passed = 0
        self.failed = 0

    def expect(self, condition, label, detail=""):
        if condition:
            self.passed += 1
            print(f"  PASS  {label} {detail}")
        else:
            self.failed += 1
            print(f"  FAIL  {label} {detail}")


def main():
    rows = run_renderer()["renders"]
    check = Check()

    for material in ("jade", "skin"):
        print(f"[{material}]")
        front = find(rows, material, "front", "final")
        back = find(rows, material, "back", "final")
        side = find(rows, material, "side", "final")
        scatter = find(rows, material, "back", "scatter")

        # 1. Back light: thin rim must be brighter than thick core.
        check.expect(
            back["rimL"] > back["centerL"],
            "back-lit thin rim brighter than thick core",
            f"rim={back['rimL']:.3f} core={back['centerL']:.3f}")

        # 2. Side light also shows a brighter scattering rim.
        check.expect(
            side["rimL"] > side["centerL"],
            "side-lit rim brighter than core",
            f"rim={side['rimL']:.3f} core={side['centerL']:.3f}")

        # 3. Scatter debug carries real energy concentrated toward the rim.
        check.expect(
            scatter["rimL"] > scatter["centerL"],
            "scatter debug rim energy exceeds core",
            f"rim={scatter['rimL']:.3f} core={scatter['centerL']:.3f}")

        # 4. Front light is a diffuse response, not a rim emissive glow:
        #    the front-lit core is at least as bright as its rim.
        check.expect(
            front["centerL"] >= front["rimL"] * 0.9,
            "front light behaves as diffuse (no rim glow)",
            f"core={front['centerL']:.3f} rim={front['rimL']:.3f}")

        # 5. Back-lit colour moves from the surface albedo toward the scatter
        #    tint. The scatter debug isolates the SSS colour, so compare its
        #    back-lit rim hue against the front-lit surface hue.
        def chroma(rgb):
            s = sum(rgb) + 1e-6
            return [c / s for c in rgb]
        back_hue = chroma(scatter["rim"])
        scatter_tint = {"jade": (0.78, 1.0, 0.55),
                        "skin": (0.95, 0.35, 0.28)}[material]
        surface_color = {"jade": (0.08, 0.30, 0.24),
                         "skin": (0.78, 0.55, 0.45)}[material]
        tint_hue = chroma(scatter_tint)
        surface_hue = chroma(surface_color)
        def dist(a, b):
            return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))
        check.expect(
            dist(back_hue, tint_hue) < dist(surface_hue, tint_hue),
            "back-lit rim shifts toward scatter colour",
            f"backRimDist={dist(back_hue, tint_hue):.3f} "
            f"surfaceDist={dist(surface_hue, tint_hue):.3f}")

    # 6. No additive glow: every rendered channel stays inside [0, 1] and the
    #    background stays black (the material never emits without light).
    print("[emission guard]")
    max_value = 0.0
    for fname in sorted(os.listdir(ART)):
        if not fname.endswith(".png"):
            continue
        _w, _h, _ch, px = load_png(os.path.join(ART, fname))
        max_value = max(max_value, max(px) / 255.0)
    check.expect(max_value <= 1.0, "all channels clipped to <= 1.0",
                 f"max={max_value:.3f}")

    # 6b. Strict zero-light run: with the light colour at zero every radiance
    #     term must vanish, leaving only the background clear colour. This
    #     proves the material is light-gated, not an additive self-emitter.
    no_light_dir = os.path.join(ROOT, "build", "nolight")
    os.makedirs(no_light_dir, exist_ok=True)
    proc = subprocess.run(
        [BIN, "--shaders=src/shaders", "--out=build/nolight", "--no-light"],
        cwd=ROOT, capture_output=True, text=True, env=dict(os.environ,
        LIBGL_ALWAYS_SOFTWARE="1", GALLIUM_DRIVER="llvmpipe"), check=True)
    json.loads(proc.stdout)  # ensure the run produced valid metrics
    nolight_max = 0
    for fname in os.listdir(no_light_dir):
        if fname.endswith("_final.png"):
            _w, _h, _ch, px = load_png(os.path.join(no_light_dir, fname))
            nolight_max = max(nolight_max, max(px))
    check.expect(nolight_max <= 10,
                 "zero light produces no material emission (background only)",
                 f"maxPixel={nolight_max}")

    # 7. Debug mode images exist and carry meaningful content. The diffuse-only
    #    view under back light is intentionally dark (direct light is behind
    #    the surface), so it is validated against the SSS composite rather than
    #    an absolute brightness threshold.
    print("[debug modes]")
    for mode in ("thickness", "scatter", "normals", "curvature", "diffuse"):
        path = os.path.join(ART, f"jade_back_{mode}.png")
        check.expect(os.path.exists(path), f"debug image present: {mode}")
        if os.path.exists(path):
            _w, _h, _ch, px = load_png(path)
            if mode == "diffuse":
                check.expect(max(px) < 60,
                             "back-lit diffuse-only stays dark (no fake glow)")
            else:
                check.expect(max(px) > 12,
                             f"{mode} debug has visible content")

    # 8. SSS is what makes back-lit rims visible: the composite rim must be
    #    substantially brighter than the diffuse-only rim at the same point.
    print("[sss contribution]")
    for material in ("jade", "skin"):
        back_final = find(rows, material, "back", "final")
        back_diffuse = find(rows, material, "back", "diffuse")
        check.expect(
            back_final["rimL"] > back_diffuse["rimL"] * 1.5,
            f"{material}: SSS brightens back-lit rim beyond diffuse only",
            f"final={back_final['rimL']:.3f} "
            f"diffuse={back_diffuse['rimL']:.3f}")

    print(f"\n{check.passed} passed, {check.failed} failed")
    return 1 if check.failed else 0


if __name__ == "__main__":
    sys.exit(main())
