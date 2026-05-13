#!/usr/bin/env python3
"""Generates extension icon — blue rounded square with three white upward chevrons."""
import math, struct, zlib

W = H = 128
OUT = 'icon.png'

arr = [[(0, 0, 0, 0)] * W for _ in range(H)]

def blend(x, y, color, a):
    x, y = int(x), int(y)
    if not (0 <= x < W and 0 <= y < H): return
    r0,g0,b0,a0 = arr[y][x]
    r1,g1,b1,a1 = color
    # alpha compositing
    out_a = a1*a + a0*(1-a1*a/255)
    if out_a == 0: return
    arr[y][x] = (
        int((r1*a1*a/255 + r0*a0*(1-a1*a/255)) / out_a),
        int((g1*a1*a/255 + g0*a0*(1-a1*a/255)) / out_a),
        int((b1*a1*a/255 + b0*a0*(1-a1*a/255)) / out_a),
        int(min(255, out_a)),
    )

def set_px(x, y, color, a=1.0):
    x, y = int(x), int(y)
    if not (0 <= x < W and 0 <= y < H): return
    r,g,b,_ = color
    if a >= 1.0:
        arr[y][x] = (r,g,b,255)
    else:
        r0,g0,b0,a0 = arr[y][x]
        arr[y][x] = (
            int(r0*(1-a)+r*a),
            int(g0*(1-a)+g*a),
            int(b0*(1-a)+b*a),
            int(a0*(1-a)+255*a),
        )

# ── Rounded rectangle ─────────────────────────────────────────────────────────
BLUE = (25, 118, 210, 255)
RX = 24  # corner radius (scaled from rx=6 at 32px → 24 at 128px)

def fill_rounded_rect(x0, y0, x1, y1, rx, color):
    for y in range(y0, y1+1):
        for x in range(x0, x1+1):
            # distance to nearest corner center
            cx = max(x0+rx, min(x1-rx, x))
            cy = max(y0+rx, min(y1-rx, y))
            dist = math.sqrt((x-cx)**2 + (y-cy)**2)
            a = min(1.0, max(0.0, rx - dist + 0.5))
            if a > 0:
                set_px(x, y, color, a)

fill_rounded_rect(0, 0, W-1, H-1, RX, BLUE)

# ── Line drawing with round caps and thickness ────────────────────────────────
WHITE = (255, 255, 255, 255)

def draw_thick_line(x0, y0, x1, y1, thickness, color):
    """Draws anti-aliased thick line with round caps."""
    dx = x1 - x0
    dy = y1 - y0
    length = math.sqrt(dx*dx + dy*dy)
    if length == 0: return
    nx, ny = -dy/length, dx/length  # normal

    hw = thickness / 2.0
    # bounding box
    bx0 = int(min(x0,x1) - hw - 1)
    bx1 = int(max(x0,x1) + hw + 2)
    by0 = int(min(y0,y1) - hw - 1)
    by1 = int(max(y0,y1) + hw + 2)

    ux, uy = dx/length, dy/length  # unit along line

    for py in range(max(0,by0), min(H,by1+1)):
        for px in range(max(0,bx0), min(W,bx1+1)):
            # project point onto line segment
            qx, qy = px - x0, py - y0
            t = qx*ux + qy*uy
            t = max(0.0, min(length, t))
            # closest point on segment
            cpx = x0 + t*ux
            cpy = y0 + t*uy
            dist = math.sqrt((px-cpx)**2 + (py-cpy)**2)
            a = min(1.0, max(0.0, hw - dist + 0.5))
            if a > 0:
                set_px(px, py, color, a)

# ── Chevrons (scaled 4x from 32px SVG) ───────────────────────────────────────
# SVG: stroke-width=3.2 → 12.8 at 128px
SW = 12.8

CHEVRONS = [
    # (left_x, apex_y, right_x, wing_y)  — upward pointing V
    (28, 72,  100, 104),   # bottom
    (28, 44,  100, 76),    # middle
    (28, 16,  100, 48),    # top
]

for lx, ay, rx, wy in CHEVRONS:
    cx = (lx + rx) / 2
    draw_thick_line(lx, wy, cx, ay, SW, WHITE)
    draw_thick_line(cx, ay, rx, wy, SW, WHITE)

# ── PNG ───────────────────────────────────────────────────────────────────────
def chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

raw = b''
for row in arr:
    raw += b'\x00'
    for r,g,b,a in row:
        raw += bytes([max(0,min(255,v)) for v in (r,g,b,a)])

ihdr = struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0)
png  = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',ihdr) + chunk(b'IDAT',zlib.compress(raw,9)) + chunk(b'IEND',b'')
with open(OUT,'wb') as f: f.write(png)
print(f'Saved {OUT} ({len(png)} bytes)')
