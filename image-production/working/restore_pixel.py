"""Restore the supplied JPEG pixel-art mark to a clean 128x128 bitmap.

The source is a JPEG (1014x1014) of pixel art rendered on a 128x128 grid
(block period 1014/128 = 7.9219 px, verified with a comb-filter fit against
16/32/64/128 candidates — 128 scored highest on both axes). JPEG leaves
chroma bleed and ringing, so the master is rebuilt cell by cell: average the
interior of each block, classify green vs paper, emit a pure two-tone mask.

Outputs (all under image-production/working/):
  mark-mask.npy      — bool grid, True = green
  mark-restored.png  — 1024 render, 8x NEAREST (exact)
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "image-production", "originals", "fish-c-source.jpg")
WORK = os.path.join(ROOT, "image-production", "working")

GREEN = np.array([61, 170, 57], dtype=float)     # #3DAA39
PAPER = np.array([250, 246, 234], dtype=float)   # #FAF6EA
GRID = 128


def load():
    return np.asarray(Image.open(SRC).convert("RGB"), dtype=float)


def greenness(rgb):
    d_green = ((rgb - GREEN) ** 2).sum(axis=-1)
    d_paper = ((rgb - PAPER) ** 2).sum(axis=-1)
    return d_green < d_paper


def comb_phase(strength, period):
    """Phase of the block boundaries along one axis (max edge response)."""
    best = (-1.0, 0.0)
    n = len(strength)
    for ph in np.arange(0, period, 0.01):
        k = np.arange(0, int(n / period) + 1)
        idx = np.round(ph + k * period).astype(int)
        idx = idx[(idx >= 0) & (idx < n)]
        s = float(strength[idx].sum())
        if s > best[0]:
            best = (s, float(ph))
    return best[1]


def estimate(rgb):
    g = greenness(rgb)
    period = rgb.shape[1] / GRID
    dx = (g[:, 1:] != g[:, :-1]).sum(axis=0).astype(float)
    dy = (g[1:, :] != g[:-1, :]).sum(axis=1).astype(float)
    return period, comb_phase(dx, period), comb_phase(dy, period)


def resample(rgb, period, pc, pr):
    h, w, _ = rgb.shape
    mask = np.zeros((GRID, GRID), dtype=bool)
    inset = period * 0.30
    for j in range(GRID):
        y0 = pr + j * period + inset
        y1 = min(h, pr + (j + 1) * period - inset)
        ys = slice(int(round(y0)), int(round(y1)))
        for i in range(GRID):
            x0 = pc + i * period + inset
            x1 = min(w, pc + (i + 1) * period - inset)
            xs = slice(int(round(x0)), int(round(x1)))
            cell = rgb[ys, xs]
            if cell.size < 3:
                continue
            mean = cell.reshape(-1, 3).mean(axis=0)
            mask[j, i] = ((mean - GREEN) ** 2).sum() < ((mean - PAPER) ** 2).sum()
    return mask


def render(mask, size, paper=PAPER, green=GREEN):
    """Nearest-neighbour upscale of the mask, paper behind."""
    out = np.empty((size, size, 3), dtype=np.uint8)
    ny, nx = mask.shape
    ys = (np.arange(size) * ny // size).clip(0, ny - 1)
    xs = (np.arange(size) * nx // size).clip(0, nx - 1)
    out[:] = paper.astype(np.uint8)
    out[mask[ys][:, xs]] = green.astype(np.uint8)
    return Image.fromarray(out)


def main():
    rgb = load()
    period, pc, pr = estimate(rgb)
    print(f"period {period:.4f}  phase ({pc:.2f}, {pr:.2f})  grid {GRID}")
    mask = resample(rgb, period, pc, pr)
    ys, xs = np.where(mask)
    print("bbox", xs.min(), ys.min(), xs.max(), ys.max(),
          "green fraction", round(float(mask.mean()), 3))

    np.save(os.path.join(WORK, "mark-mask.npy"), mask)
    render(mask, 1024).save(os.path.join(WORK, "mark-restored.png"))
    with open(os.path.join(WORK, "mark-meta.json"), "w") as f:
        json.dump({"period": period, "phase_c": pc, "phase_r": pr, "grid": GRID}, f, indent=2)
    print("wrote mark-mask.npy + mark-restored.png")


if __name__ == "__main__":
    main()
