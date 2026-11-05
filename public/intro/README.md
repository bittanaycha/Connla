# Intro plate

`salmon-dither.png` is the splash art and the app icon: a green dither of a
public-domain illustration, *The Salmon of Knowledge*, 1904, from the Wikimedia
Commons file `Salmon-of-Knoweldge-1904.jpg`. `salmon-dither-small.png` is the
same picture at 760px for the empty graph state.

The splash does not show the file directly. It samples it into marks — one every
9 CSS pixels, ink only, the print's paper stays still — assembles them on a
swirl, resolves to the full-resolution print, and releases them again on an
outward front. Sampling density and the single shared front are the two things
that keep it legible; see `components/intro-splash.tsx`.

The icon (`build/icon.icns`) is a square crop of the large plate.
