#!/usr/bin/env python3
"""
Generate Tidytabs PNG icons using only Python stdlib.
Creates icons/icon16.png, icons/icon48.png, icons/icon128.png
"""
import struct, zlib, os, math


def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def write_rgba_png(path: str, size: int, pixels: list[tuple[int, int, int, int]]):
    """Write a size×size RGBA PNG to path. pixels is a flat list of (R,G,B,A) tuples."""
    raw = b""
    for y in range(size):
        raw += b"\x00"  # filter type None
        for x in range(size):
            r, g, b, a = pixels[y * size + x]
            raw += bytes([r, g, b, a])

    ihdr = make_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    idat = make_chunk(b"IDAT", zlib.compress(raw, 9))
    iend = make_chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + ihdr + idat + iend)


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(v)))


def draw_icon(size: int) -> list[tuple[int, int, int, int]]:
    """
    Draw a rounded-square background with a stylised 'tab' arrow shape.
    Purple gradient background (#6d28d9 → #8b5cf6), white icon shape.
    """
    pixels = []
    cx = cy = size / 2
    r_outer = size / 2 - 0.5          # circle radius
    corner = size * 0.22              # rounded-square corner radius

    # Background gradient colours
    top_c    = (109, 40, 217)   # #6d28d9
    bot_c    = (139, 92, 246)   # #8b5cf6

    for y in range(size):
        for x in range(size):
            # ── Background: rounded square ───────────────────────────────────
            dx = abs(x + 0.5 - cx)
            dy = abs(y + 0.5 - cy)
            half = size / 2 - size * 0.05  # inner half-width

            # Distance to rounded-square edge (signed: <0 = inside)
            qx = max(dx - (half - corner), 0)
            qy = max(dy - (half - corner), 0)
            dist_sq = qx * qx + qy * qy
            dist = math.sqrt(dist_sq) - corner

            # Anti-alias the edge
            aa = clamp(int((0.5 - dist) * 2.5 * 255), 0, 255)
            if aa == 0:
                pixels.append((0, 0, 0, 0))
                continue

            # Vertical gradient
            t = (y + 0.5) / size
            bg = tuple(clamp(lerp(top_c[i], bot_c[i], t)) for i in range(3))

            # ── Icon: hourglass / tidytabs glyph ───────────────────────────
            # Coordinate system: 0..1 within the icon
            nx = (x + 0.5) / size
            ny = (y + 0.5) / size

            # Margin so glyph doesn't touch edge
            m = 0.2
            inset_x = (nx - m) / (1 - 2 * m)   # 0..1 within inset region
            inset_y = (ny - m) / (1 - 2 * m)

            icon_alpha = 0.0

            if 0 <= inset_x <= 1 and 0 <= inset_y <= 1:
                # Top arrow (triangle pointing up) — top 35%
                if inset_y < 0.35:
                    ty = inset_y / 0.35
                    half_w = 0.5 * (1 - ty)
                    if abs(inset_x - 0.5) < half_w:
                        icon_alpha = 0.95
                # Middle bar — 42%–58%
                elif 0.42 <= inset_y <= 0.58:
                    if 0.12 < inset_x < 0.88:
                        icon_alpha = 0.95
                # Bottom arrow (triangle pointing down) — bottom 35%
                elif inset_y > 0.65:
                    ty = (inset_y - 0.65) / 0.35
                    half_w = 0.5 * ty
                    if abs(inset_x - 0.5) < half_w:
                        icon_alpha = 0.95

            # Blend background + white icon
            ia = icon_alpha
            fr = clamp(lerp(bg[0], 255, ia))
            fg = clamp(lerp(bg[1], 255, ia))
            fb = clamp(lerp(bg[2], 255, ia))
            fa = clamp(aa * (0.05 + 0.95))  # background always opaque inside
            fa = aa

            pixels.append((fr, fg, fb, fa))

    return pixels


if __name__ == "__main__":
    os.makedirs("icons", exist_ok=True)
    for size in [16, 48, 128]:
        path = f"icons/icon{size}.png"
        pixels = draw_icon(size)
        write_rgba_png(path, size, pixels)
        print(f"  Created {path} ({size}×{size})")
    print("Icons generated.")
