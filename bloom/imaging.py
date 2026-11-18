"""Tone mapping, preview tiles and PNG export for HDR textures."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def _default_font() -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=14)
    except TypeError:
        return ImageFont.load_default()


FONT = _default_font()


def reinhard_tonemap(image: np.ndarray) -> np.ndarray:
    """Global Reinhard operator; keeps relative brightness comparable."""
    mapped = image / (1.0 + image)
    return np.clip(mapped, 0.0, 1.0).astype(np.float32)


def to_uint8(image: np.ndarray) -> np.ndarray:
    return (np.clip(image, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def save_png(image: np.ndarray, path: str, tonemap: bool = True) -> None:
    pixels = reinhard_tonemap(image) if tonemap else image
    Image.fromarray(to_uint8(pixels), mode="RGB").save(path)


def _fit_to_tile(image: np.ndarray, tile: int) -> np.ndarray:
    pil = Image.fromarray(to_uint8(image), mode="RGB")
    pil = pil.resize((tile, tile), Image.Resampling.BILINEAR)
    return np.asarray(pil, dtype=np.uint8)


def preview_sheet(
    textures: list[np.ndarray],
    labels: list[str],
    path: str,
    tile: int = 192,
    tonemap: bool = True,
) -> None:
    """Lay every pyramid level out as one labelled contact-sheet PNG."""
    label_h = 26
    cols = len(textures)
    sheet = Image.new("RGB", (cols * tile, tile + label_h), (16, 16, 16))
    draw = ImageDraw.Draw(sheet)
    for index, (texture, label) in enumerate(zip(textures, labels)):
        pixels = reinhard_tonemap(texture) if tonemap else texture
        tile_img = Image.fromarray(_fit_to_tile(pixels, tile), mode="RGB")
        x0 = index * tile
        sheet.paste(tile_img, (x0, label_h))
        draw.text((x0 + 6, 5), label, fill=(235, 235, 235), font=FONT)
    sheet.save(path)


def comparison_sheet(
    off_image: np.ndarray,
    on_image: np.ndarray,
    path: str,
    left_label: str = "Bloom OFF",
    right_label: str = "Bloom ON",
) -> None:
    """Side-by-side OFF/ON comparison rendered from the same tone mapper."""
    h, w = off_image.shape[:2]
    label_h = 30
    sheet = Image.new("RGB", (2 * w, h + label_h), (10, 10, 10))
    draw = ImageDraw.Draw(sheet)
    left = Image.fromarray(to_uint8(reinhard_tonemap(off_image)), mode="RGB")
    right = Image.fromarray(to_uint8(reinhard_tonemap(on_image)), mode="RGB")
    sheet.paste(left, (0, label_h))
    sheet.paste(right, (w, label_h))
    draw.text((10, 7), left_label, fill=(235, 235, 235), font=FONT)
    draw.text((w + 10, 7), right_label, fill=(235, 235, 235), font=FONT)
    sheet.save(path)
