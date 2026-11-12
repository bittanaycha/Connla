"""Turn the restored 128x128 mark into the app icon set.

Sources of truth in this repo:
  build/icon-flat.svg  — vector design source (win/linux), rendered by
                         scripts/make-icons.mjs with resvg
  build/icon.icon      — Icon Composer document (macOS 26 Assets.car)
  build/icon.icns      — pre-Tahoe fallback, Icon Composer PNG exports

This script writes the SVG + the Icon Composer layers from the mask; the
raster outputs are then produced by scripts/make-icons.mjs and iconutil.
"""
import json
import os
import re

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = os.path.join(ROOT, "image-production", "working")
BUILD = os.path.join(ROOT, "build")

GREEN = "#3DAA39"
PAPER = "#FAF6EA"
GRID = 128
SCALE = 1024 // GRID  # 8

# ---------------------------------------------------------------- tracing


def trace(mask):
    """Clockwise boundary loops (integer lattice, y down) of a cell region."""
    h, w = mask.shape
    edges = {}

    def add(a, b):
        edges.setdefault(a, []).append(b)

    for j in range(h):
        for i in range(w):
            if not mask[j, i]:
                continue
            if j == 0 or not mask[j - 1, i]:
                add((i, j), (i + 1, j))
            if i == w - 1 or not mask[j, i + 1]:
                add((i + 1, j), (i + 1, j + 1))
            if j == h - 1 or not mask[j + 1, i]:
                add((i + 1, j + 1), (i, j + 1))
            if i == 0 or not mask[j, i - 1]:
                add((i, j + 1), (i, j))

    def turn_rank(prev, cur, nxt):
        din = (cur[0] - prev[0], cur[1] - prev[1])
        dout = (nxt[0] - cur[0], nxt[1] - cur[1])
        cross = din[0] * dout[1] - din[1] * dout[0]
        dot = din[0] * dout[0] + din[1] * dout[1]
        if cross > 0:
            return 0  # right turn — take first (keeps the region on the right)
        if dot > 0:
            return 1
        return 2

    loops = []
    while edges:
        start = next(iter(edges))
        loop = [start]
        prev = None
        cur = start
        while True:
            outs = edges.get(cur, [])
            if not outs:
                break
            if prev is None or len(outs) == 1:
                nxt = outs[0]
            else:
                nxt = sorted(outs, key=lambda o: turn_rank(prev, cur, o))[0]
            outs.remove(nxt)
            if not outs:
                del edges[cur]
            prev, cur = cur, nxt
            if cur == start:
                break
            loop.append(cur)
        if len(loop) > 3:
            loops.append(loop)
    return loops


def simplify(loop):
    """Drop collinear vertices from a rectilinear loop."""
    pts = []
    n = len(loop)
    for k in range(n):
        a, b, c = loop[k - 1], loop[k], loop[(k + 1) % n]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) != 0:
            pts.append(b)
    return pts


def path_d(loops):
    parts = []
    for loop in loops:
        pts = simplify(loop)
        if len(pts) < 3:
            continue
        d = [f"M{pts[0][0]},{pts[0][1]}"]
        for x, y in pts[1:]:
            d.append(f"L{x},{y}")
        d.append("Z")
        parts.append("".join(d))
    return "".join(parts)


# ---------------------------------------------------------------- squircle

def squircle_d():
    """Reuse the owner's squircle silhouette from the current SVG."""
    svg = open(os.path.join(BUILD, "icon-flat.svg")).read()
    m = re.match(r'.*?<path d="(M1023[^"]+)"', svg, re.S)
    if not m:
        raise SystemExit("squircle path not found in build/icon-flat.svg")
    return m.group(1)


def write_svg(path, art_d, square=False):
    sq = squircle_d() if not square else None
    bg = (f'  <path d="{sq}" fill="{PAPER}"/>\n' if sq
          else f'  <rect x="0" y="0" width="1024" height="1024" fill="{PAPER}"/>\n')
    body = (
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
        'viewBox="0 0 1024 1024" style="fill-rule:evenodd;clip-rule:evenodd">\n'
        f"{bg}"
        f'  <g transform="scale({SCALE})">\n'
        f'    <path d="{art_d}" fill="{GREEN}"/>\n'
        "  </g>\n"
        "</svg>\n"
    )
    with open(path, "w") as f:
        f.write(body)
    return len(body)


def main():
    mask = np.load(os.path.join(WORK, "mark-mask.npy"))
    loops = trace(mask)
    art_d = path_d(loops)
    print(f"{len(loops)} loops, path {len(art_d)/1024:.1f} KB")

    n = write_svg(os.path.join(BUILD, "icon-flat.svg"), art_d)
    print(f"build/icon-flat.svg  {n/1024:.1f} KB")

    # Icon Composer (macOS 26): one opaque full-bleed layer; actool masks it.
    assets = os.path.join(BUILD, "icon.icon", "Assets")
    for stale in os.listdir(assets):
        os.remove(os.path.join(assets, stale))
    layer = "connla-layer.svg"
    write_svg(os.path.join(assets, layer), art_d, square=True)
    doc = {
        "fill": {"automatic-gradient": "srgb:0.07843,0.07843,0.07843,1.00000"},
        "groups": [{"layers": [{"image-name": layer, "name": "connla-layer"}]}],
        "supported-platforms": {"circles": ["watchOS"], "squares": "shared"},
    }
    with open(os.path.join(BUILD, "icon.icon", "icon.json"), "w") as f:
        json.dump(doc, f, indent=2)
    print("build/icon.icon updated (1 layer)")

    # Flat 1024 render (no corners) — README inline mark + archive.
    out = np.empty((1024, 1024, 3), dtype=np.uint8)
    out[:] = tuple(int(PAPER[i:i + 2], 16) for i in (1, 3, 5))
    ys = (np.arange(1024) * GRID // 1024).clip(0, GRID - 1)
    rgb_green = tuple(int(GREEN[i:i + 2], 16) for i in (1, 3, 5))
    out[mask[ys][:, ys]] = rgb_green
    Image.fromarray(out).save(os.path.join(ROOT, "image-production", "exports", "mark-1024.png"))


if __name__ == "__main__":
    main()
