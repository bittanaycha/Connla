import { Type, type Static } from "typebox";

/** One [longitude, latitude] pair in degrees.
 *
 * The wire shape is a normal array (`items` is ONE schema), not a TypeBox
 * tuple: OpenAI-compatible endpoints reject the draft-07 tuple form where
 * `items` is an array. The TypeScript tuple type is preserved for callers. */
const lonLat = Type.Unsafe<[number, number]>({
	type: "array",
	items: Type.Number({ minimum: -360, maximum: 360 }),
	minItems: 2,
	maxItems: 2,
	description: "[longitude, latitude] in degrees",
});

/** Pixel offset pair; same wire-shape rule as lonLat. */
const offset2d = (description: string) =>
	Type.Unsafe<[number, number]>({
		type: "array",
		items: Type.Number({ minimum: -260, maximum: 260 }),
		minItems: 2,
		maxItems: 2,
		description,
	});

const hexColor = Type.String({
	minLength: 4,
	maxLength: 20,
	description: "Optional colour, preferably #rrggbb. Unreadable values fall back to the map palette.",
});

const area = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 80, description: "Area name, used for its map label and legend." }),
	points: Type.Optional(
		Type.Array(lonLat, {
			minItems: 3,
			maxItems: 300,
			description:
				"Custom outline as [lon, lat] points, clockwise or counter-clockwise. Use for historical or physical regions where modern borders are wrong. The ring is closed automatically.",
		}),
	),
	countries: Type.Optional(
		Type.Array(Type.String({ minLength: 2, maxLength: 80 }), {
			minItems: 1,
			maxItems: 40,
			description:
				"Modern countries to shade as one group, by ISO alpha-3 code (FRA, GBR, USA). Prefer codes; names also work. For historical borders, draw points instead.",
		}),
	),
	color: Type.Optional(hexColor),
	opacity: Type.Optional(Type.Number({ minimum: 0.05, maximum: 0.8 })),
	label: Type.Optional(Type.Boolean({ description: "Draw the area name on the map. Defaults to true." })),
});

const marker = Type.Object({
	at: lonLat,
	label: Type.Optional(Type.String({ maxLength: 80 })),
	offset: Type.Optional(offset2d("Label offset in pixels from the dot. Default [9, -9].")),
	size: Type.Optional(Type.Number({ minimum: 2, maximum: 12 })),
	color: Type.Optional(hexColor),
});

const route = Type.Object({
	points: Type.Array(lonLat, {
		minItems: 2,
		maxItems: 60,
		description: "Waypoints in travel order. The line follows great-circle arcs between them.",
	}),
	label: Type.Optional(Type.String({ maxLength: 80 })),
	color: Type.Optional(hexColor),
	arrow: Type.Optional(Type.Boolean({ description: "Arrowhead at the last waypoint. Defaults to true." })),
	dashed: Type.Optional(Type.Boolean({ description: "Dash the line. Defaults to false." })),
});

const label = Type.Object({
	text: Type.String({ minLength: 1, maxLength: 90 }),
	at: lonLat,
	offset: Type.Optional(offset2d("Label offset in pixels from the point. Default [8, -8].")),
	leader: Type.Optional(Type.Boolean({ description: "Draw a thin line from the point to the label. Defaults to false." })),
	align: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("middle"), Type.Literal("end")])),
	size: Type.Optional(Type.Number({ minimum: 9, maximum: 22 })),
	color: Type.Optional(hexColor),
});

const legendEntry = Type.Object({
	label: Type.String({ minLength: 1, maxLength: 60 }),
	color: Type.Optional(hexColor),
	kind: Type.Optional(Type.Union([Type.Literal("swatch"), Type.Literal("line"), Type.Literal("dot")])),
});

/** The `map` tool input. The renderer is deterministic; this is the whole drawing. */
export const mapInputSchema = Type.Object({
	title: Type.String({ minLength: 1, maxLength: 90, description: "Map title, drawn at the top." }),
	subtitle: Type.Optional(Type.String({ maxLength: 130 })),
	caption: Type.Optional(
		Type.String({
			maxLength: 200,
			description: "Small note under the map. Include 'approximate' when boundaries are uncertain.",
		}),
	),
	view: Type.Object({
		bbox: Type.Unsafe<[number, number, number, number]>({
			type: "array",
			items: Type.Number({ minimum: -360, maximum: 360 }),
			minItems: 4,
			maxItems: 4,
			description: "[west, south, east, north] in degrees. Example Europe: [-15, 34, 42, 71].",
		}),
		projection: Type.Optional(
			Type.Union([Type.Literal("equal-earth"), Type.Literal("natural-earth"), Type.Literal("mercator")], {
				description: "Defaults to equal-earth. Use mercator only for small regional views.",
			}),
		),
	}),
	areas: Type.Optional(Type.Array(area, { maxItems: 12 })),
	markers: Type.Optional(Type.Array(marker, { maxItems: 40 })),
	routes: Type.Optional(Type.Array(route, { maxItems: 12 })),
	labels: Type.Optional(Type.Array(label, { maxItems: 40 })),
	legend: Type.Optional(Type.Array(legendEntry, { maxItems: 8 })),
	showBorders: Type.Optional(Type.Boolean({ description: "Modern country borders. Off by default." })),
	showRivers: Type.Optional(Type.Boolean({ description: "Major rivers. Off by default." })),
	showLakes: Type.Optional(Type.Boolean({ description: "Major lakes. Off by default." })),
	showGraticule: Type.Optional(Type.Boolean({ description: "Latitude/longitude grid. Off by default." })),
});

export type MapInput = Static<typeof mapInputSchema>;
