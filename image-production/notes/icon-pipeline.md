# Icon pipeline

The app icon is the pixel mark from `originals/fish-c-source.jpg` (a
1014x1014 JPEG: a green salmon curling into a C among wave flourishes, on
paper `#FAF6EA`).

The JPEG is a 128x128 pixel grid scaled by 1014/128 = 7.9219 px per block,
which JPEG ringing blurs. `working/restore_pixel.py` fits that period and
phase by comb filter, averages each block's interior, and classifies it
green (`#3DAA39`) vs paper — producing `working/mark-mask.npy`, a clean
two-tone mask.

`working/build_icons.py` traces the mask to rectilinear contours and writes:

- `build/icon-flat.svg` — paper squircle (the original Affinity path) plus
  the traced art; the Windows/Linux design source.
- `build/icon.icon/Assets/connla-layer.svg` + `icon.json` — the Icon
  Composer document macOS 26 compiles into `Assets.car`.

Rasters come from those, not from the JPEG:

```
node scripts/make-icons.mjs        # build/icon.ico, build/icon.png (resvg)
# build/icon.icns: render the SVG at 16..1024 into an .iconset, then iconutil
```

`exports/mark-1024.png` is the uncropped flat mark; `docs/assets/connla-icon.png`
is the squircle copy shown above the README banner.

Small sizes (16/32) render antialiased from the SVG: at those sizes a block is
sub-pixel, so crispEdges erodes the 1px hatching into scattered dots.
