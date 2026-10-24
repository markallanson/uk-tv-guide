#!/usr/bin/env python3
"""Regenerate PWA / home-screen icons.

Motif: a TV screen with two programme bars and the app's signature red
"now line" overshooting the screen — the guide's core visual, drawn with
plain Pillow shapes (no emoji font dependency).

Run:  python3 tools/make-icons.py     (writes ./icons/*.png)
"""
from pathlib import Path

from PIL import Image, ImageDraw

# palette (css/style.css)
BG = (14, 17, 22, 255)        # --bg        #0e1116
SCREEN = (30, 37, 45, 255)    # slate panel
SCREEN_EDGE = (71, 81, 94, 255)
BAR = (51, 61, 75, 255)       # programme blocks
BAR_DIM = (42, 50, 62, 255)
RED = (255, 77, 94, 255)      # --accent    #ff4d5e (now line)
STAND = (71, 81, 94, 255)

OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 2  # supersampling factor for smooth edges


def draw_master(px: int, glyph: float = 1.0) -> Image.Image:
    """The icon composition at `px` square, full-bleed background.

    `glyph` scales the composition around the centre — maskable icons need
    everything inside the central 80% circle (glyph=0.85).
    """
    s = px / 1024 * glyph  # design grid is 1024
    c = px * (1 - glyph) / 2  # re-centre scaled composition

    def r(*vals):  # scale design coords
        return [int(round(v * s + c)) for v in vals]

    img = Image.new("RGBA", (px, px), BG)
    d = ImageDraw.Draw(img)

    # screen
    d.rounded_rectangle(r(160, 260, 864, 700), radius=r(56)[0],
                        fill=SCREEN, outline=SCREEN_EDGE, width=max(1, r(16)[0]))
    # programme bars (guide rows) — Now & Next
    d.rounded_rectangle(r(216, 316, 560, 392), radius=r(20)[0], fill=BAR)
    d.rounded_rectangle(r(216, 448, 424, 524), radius=r(20)[0], fill=BAR_DIM)
    # the now line — overshoots the screen top and bottom
    d.rounded_rectangle(r(640, 212, 670, 748), radius=r(15)[0], fill=RED)
    # TV stand
    d.rounded_rectangle(r(432, 748, 592, 800), radius=r(18)[0], fill=STAND)
    return img


def rounded(img: Image.Image, radius_pct: float) -> Image.Image:
    """Knock transparent rounded corners into a full-bleed square."""
    px = img.width
    mask = Image.new("L", (px, px), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, px - 1, px - 1], radius=int(px * radius_pct), fill=255)
    img = img.copy()
    img.putalpha(mask)
    return img


def write(img: Image.Image, name: str) -> None:
    OUT.mkdir(exist_ok=True)
    img.save(OUT / name)
    print(f"wrote icons/{name} ({img.width}x{img.height})")


def icon(px: int, name: str, *, radius_pct: float = 0.0, glyph: float = 1.0) -> None:
    img = draw_master(px * SS, glyph).resize((px, px), Image.LANCZOS)
    if radius_pct:
        img = rounded(img, radius_pct)
    write(img, name)


if __name__ == "__main__":
    icon(192, "icon-192.png", radius_pct=0.20)
    icon(512, "icon-512.png", radius_pct=0.20)
    icon(512, "icon-maskable-512.png", glyph=0.85)  # keeps content in the 80% safe zone
    icon(180, "apple-touch-icon.png")               # iOS applies its own mask
