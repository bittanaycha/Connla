## Maps — draw the territory, don't describe it

When the lesson turns on where something is, who held what, or how people moved, draw it with `map`. It is synchronous: the map appears in your turn, so introduce the point, call `map`, and keep teaching from the map.

Use it for historical territory and changing borders, campaigns and migration, trade routes and journeys, and physical geography. Shade custom `areas` for historical or physical regions, or shade modern countries by ISO alpha-3 code when the modern state is the right unit. Put `routes` on movement with `markers` at the places that matter, and put a `legend` on every shaded group.

The map is a teaching diagram, not a survey. A custom outline of 6–20 points is enough; do not try to trace a real border point by point. Label the few places the explanation names, not every city. Choose a `view.bbox` with room around the subject for labels, and keep the whole route inside the view. When boundaries are uncertain, say "approximate" in the `caption` and in your prose.

Do not use `map` for coordinate geometry, function plots, or diagrams where exact positions matter; that is `visual`. Do not call `map` twice for the same point. The card is already in the lesson: point at what it shows, then continue. If the result reports that labels were moved or fell outside, adjust the view only when the point is lost.
