# Intro plate

`connla-well.png` and `connla-well-small.png` are a dithered print of a
public-domain illustration: *The Salmon of Knowledge*, 1904, from the
Wikimedia Commons file `Salmon-of-Knoweldge-1904.jpg`.

Printed with unwalled-garden's plate tool:

```
node tools/plate/cli.mjs <source> --ink bone --screen stipple --cell 2 \
  --grain 0.60 --gain 0.9 --bias 0.03 --shape full --edge 1150 \
  -o public/intro/connla-well.png
```

The small copy is the same command at `--edge 640`. The app icon
(`build/icon.icns`) is a square crop of the large plate.
