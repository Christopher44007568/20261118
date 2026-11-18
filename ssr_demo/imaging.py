"""Image export helpers (HDR float -> LDR PNG, contact sheets)."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw


def to_ldr(image: np.ndarray, exposure: float = 1.0, gamma: float = 2.2) -> np.ndarray:
    image = np.clip(image * exposure, 0.0, 1.0)
    image = image ** (1.0 / gamma)
    return (image * 255.0).astype(np.uint8)


def save_png(image: np.ndarray, path: str, exposure: float = 1.0) -> None:
    Image.fromarray(to_ldr(image, exposure)).save(path)


def _label_bar(width: int, height: int = 26, text: str = "") -> np.ndarray:
    img = Image.new("RGB", (width, height), (18, 22, 30))
    draw = ImageDraw.Draw(img)
    draw.text((8, 6), text, fill=(190, 215, 235))
    return np.asarray(img, dtype=np.uint8)


def contact_sheet(panels: list[tuple[str, np.ndarray]], columns: int,
                  exposure: float = 1.0) -> np.ndarray:
    """Stack labelled LDR panels in a grid."""
    bar_h = 26
    rendered = []
    for label, image in panels:
        ldr = to_ldr(image, exposure)
        bar = _label_bar(ldr.shape[1], bar_h, label)
        rendered.append(np.concatenate([bar, ldr], axis=0))
    rows = []
    for i in range(0, len(rendered), columns):
        row_panels = rendered[i:i + columns]
        if len(row_panels) < columns:
            pad = np.zeros_like(rendered[0])
            row_panels += [pad] * (columns - len(row_panels))
        rows.append(np.concatenate(row_panels, axis=1))
    return np.concatenate(rows, axis=0)


def debug_visualization(gbuffer, result, frame) -> list[tuple[str, np.ndarray]]:
    """Panels exposing depth, normals, hit/miss reasons and step counts."""
    depth_viz = (gbuffer.depth / max(gbuffer.depth.max(), 1e-6))[..., None]
    depth_viz = np.repeat(depth_viz, 3, axis=-1)
    normal_viz = gbuffer.view_normal * 0.5 + 0.5
    normal_viz = np.where(gbuffer.material_id[..., None] >= 0, normal_viz, 0.0)

    reason = np.zeros((*gbuffer.depth.shape, 3), dtype=np.float64)
    reason[result.hit] = (0.2, 0.85, 0.45)
    reason[result.miss_reason == 1] = (0.9, 0.45, 0.2)
    reason[result.miss_reason == 2] = (0.9, 0.2, 0.35)

    steps = result.steps.astype(np.float64)
    steps_viz = steps / max(steps.max(), 1)
    steps_viz = np.repeat(steps_viz[..., None], 3, axis=-1)
    steps_viz[..., 0] *= 0.4
    steps_viz[..., 2] = steps / max(steps.max(), 1)

    return [
        ("linear depth", depth_viz),
        ("view normals", normal_viz),
        ("green=hit orange=exit red=occluded", reason),
        ("march iterations (heat)", steps_viz),
    ]
