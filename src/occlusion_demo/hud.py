"""用 Pillow 生成半透明统计面板并作为纹理叠加到画面上。"""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


class HudOverlay:
    def __init__(self, ctx, width: int, height: int):
        self.ctx = ctx
        self.width, self.height = width, height
        self.font = _load_font(16)
        self.title_font = _load_font(20)
        self.texture = ctx.texture((width, height), 4)
        self._image = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    def update(self, stats, total_targets: int) -> None:
        img = self._image
        img.putalpha(0)
        draw = ImageDraw.Draw(img)
        panel_w, panel_h = 330, 292
        x0, y0 = 14, 14
        draw.rounded_rectangle(
            [x0, y0, x0 + panel_w, y0 + panel_h],
            radius=10, fill=(12, 16, 24, 205), outline=(110, 150, 200, 220),
            width=2,
        )
        y = y0 + 10
        draw.text((x0 + 14, y), "Occlusion Query Culling",
                  font=self.title_font, fill=(235, 240, 255, 255))
        y += 30
        draw.text((x0 + 14, y), f"frame {stats.frame:03d}   targets {total_targets}",
                  font=self.font, fill=(170, 190, 220, 255))
        y += 26
        rows = [
            ("candidates", stats.candidates, (200, 215, 240)),
            ("passed", stats.passed, (110, 230, 130)),
            ("occluded", stats.occluded, (255, 120, 110)),
            ("delayed", stats.delayed, (255, 205, 90)),
            ("outside frustum", stats.outside, (150, 150, 160)),
        ]
        for label, value, color in rows:
            draw.ellipse([x0 + 14, y + 5, x0 + 26, y + 17], fill=color + (255,))
            draw.text((x0 + 34, y), f"{label:<16} {value:>3}",
                      font=self.font, fill=(235, 238, 245, 255))
            y += 24
        y += 4
        draw.line([x0 + 14, y, x0 + panel_w - 14, y], fill=(110, 150, 200, 160))
        y += 8
        saved = max(stats.reference_draws - stats.target_draws, 0)
        lines = [
            f"objects drawn      {stats.target_draws:>3} / ref {stats.reference_draws:>3}",
            f"draw batches       {stats.draw_batches:>3}",
            f"queries issued     {stats.queries_issued:>3}  in-flight "
            f"{stats.queries_in_flight_start:>2}/{stats.queries_in_flight_end:<2}",
            f"objects culled     {saved:>3}   pixel diff {stats.diff_pixels:>5}",
        ]
        for line in lines:
            draw.text((x0 + 14, y), line, font=self.font,
                      fill=(190, 210, 235, 255))
            y += 24
        raw = img.tobytes()
        self.texture.write(raw)

    @property
    def gl_texture(self):
        return self.texture
