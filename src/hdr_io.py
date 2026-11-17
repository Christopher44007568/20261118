"""HDR image IO: tonemapping, PNG export, Radiance .hdr (RGBE) writer."""
import numpy as np
from PIL import Image


def aces_tonemap(x):
    """Approximate ACES filmic curve, operates on linear HDR radiance."""
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)


def to_srgb8(hdr, exposure=0.0, tonemap=True):
    """Linear HDR float -> gamma-encoded 8-bit."""
    x = hdr * (2.0 ** exposure)
    x = aces_tonemap(x) if tonemap else np.clip(x, 0.0, 1.0)
    x = np.power(np.clip(x, 0.0, 1.0), 1.0 / 2.2)
    return (x * 255.0 + 0.5).astype(np.uint8)


def save_png(hdr, path, exposure=0.0):
    Image.fromarray(to_srgb8(hdr, exposure)).save(path)


def save_hdr(hdr, path):
    """Write Radiance .hdr using new-style RLE scanlines."""
    img = np.ascontiguousarray(hdr.astype(np.float32))
    h, w = img.shape[:2]
    v = img.reshape(h, w, 3)
    m = np.maximum(v[..., 0], np.maximum(v[..., 1], v[..., 2]))
    mant, exp = np.frexp(np.maximum(m, 1e-38))
    scale = mant * 256.0 / np.maximum(m, 1e-38)
    rgbe = np.empty((h, w, 4), dtype=np.uint8)
    rgbe[..., :3] = np.clip(v * scale[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = (exp + 128).astype(np.uint8)
    rgbe[m <= 1e-38] = 0

    with open(path, "wb") as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n")
        f.write(f"-Y {h} +X {w}\n".encode())
        for y in range(h):
            f.write(bytes([2, 2, (w >> 8) & 0xFF, w & 0xFF]))
            for ch in range(4):
                f.write(_rle_channel(rgbe[y, :, ch]))


def _rle_channel(col):
    out = bytearray()
    n = len(col)
    i = 0
    while i < n:
        run = 1
        while i + run < n and run < 127 and col[i + run] == col[i]:
            run += 1
        if run >= 4:
            out += bytes([128 + run, int(col[i])])
            i += run
        else:
            start = i
            i += run
            while i < n:
                run = 1
                while i + run < n and run < 127 and col[i + run] == col[i]:
                    run += 1
                if run >= 4 or i - start >= 127:
                    break
                i += run
            out.append(i - start)
            out += col[start:i].tobytes()
    return bytes(out)
