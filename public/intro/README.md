# Intro plate

`salmon-dither.png` is the splash art and the app icon: a green dither of a
public-domain illustration, *The Salmon of Knowledge*, 1904, from the Wikimedia
Commons file `Salmon-of-Knoweldge-1904.jpg`. `salmon-dither-small.png` is the
same picture at 760px for the empty graph state.

The splash does not show the file directly. It cuts the plate into a grid of
10px square pixels and switches them on in a raster sweep from the top row down,
so the picture loads rather than fades in. The mosaic then sharpens into the
full-resolution etching, and coarsens back into pixels before it clears. See
`components/intro-splash.tsx` for the timeline and the sweep's jitter.

The icon (`build/icon.icns`) is a square crop of the large plate.
