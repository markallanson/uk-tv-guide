#!/usr/bin/env python3
"""Regenerate PWA / home-screen icons: 📺 on the app's theme colour.

Pillow is used because Noto Color Emoji is a bitmap (CBDT) font with a single
109px strike — SVG rasterisers (librsvg/cairo) render it as solid black tofu.
The glyph is upscaled with Lanczos from the bitmap strike.

Run:  python3 tools/make-icons.py     (writes ./icons/*.png)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG = (15, 18, 22, 255)  # #0f1216 — <meta name="theme-color"> / --bg
EMOJI = "\U0001F4FA"  # 📺
FONT_PATH = "/usr/share/fonts/noto/NotoColorEmoji.ttf"
FONT_SIZE = 109  # NotoColorEmoji ships exactly one bitmap strike

OUT = Path(__file__).resolve().parent.parent / "icons"


def glyph(px: int) -> Image.Image:
    """The emoji at `px` square, transparent background."""
    base = 128
    img = Image.new("RGBA", (base, base), (0, 0, 0, 0))
    ImageDraw.Draw(img).text(
        (base / 2, base / 2), EMOJI,
        font=ImageFont.truetype(FONT_PATH, FONT_SIZE),
        embedded_color=True, anchor="mm",
    )
    return img.resize((px, px), Image.LANCZOS)


def icon(px: int, name: str, *, radius: float = 0.19, glyph_pct: float = 0.58,
         full_bleed: bool = False) -> None:
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if full_bleed:
        d.rectangle([0, 0, px - 1, px - 1], fill=BG)  # maskable/apple: edge-to-edge
    else:
        d.rounded_rectangle([0, 0, px - 1, px - 1], radius=int(px * radius), fill=BG)
    g = glyph(int(px * glyph_pct))
    img.alpha_composite(g, ((px - g.width) // 2, (px - g.height) // 2))
    OUT.mkdir(exist_ok=True)
    img.save(OUT / name)
    print(f"wrote icons/{name} ({px}x{px})")


if __name__ == "__main__":
    icon(192, "icon-192.png")
    icon(512, "icon-512.png")
    icon(512, "icon-maskable-512.png", radius=0, glyph_pct=0.5, full_bleed=True)
    icon(180, "apple-touch-icon.png", radius=0, glyph_pct=0.62, full_bleed=True)
