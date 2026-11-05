import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { mapInputSchema, type MapInput } from "../src/agent/maps/schema.ts";
import { renderMap } from "../src/agent/maps/render.ts";

const sample: MapInput = {
	title: "Test & map",
	subtitle: "A small region",
	caption: "Boundaries are approximate.",
	view: { bbox: [-6, 42, 12, 52] },
	areas: [{ name: "France", countries: ["FRA"], color: "#3f5d6b" }],
	markers: [{ at: [2.35, 48.86], label: "Paris" }],
	routes: [
		{
			points: [
				[2.35, 48.86],
				[4.9, 52.37],
			],
			label: "Route",
			arrow: true,
		},
	],
	legend: [{ label: "France", color: "#3f5d6b" }],
};

test("map schema stays provider-compatible: no tuple `items` arrays", () => {
	// OpenAI-compatible endpoints reject draft-07 tuples (`items: [ ... ]`)
	// with "is not of types boolean, object". Coordinates are normal arrays
	// with one numeric `items` schema, and the tuple TYPE stays in TS.
	const wire = JSON.stringify(mapInputSchema);
	assert.ok(!/"items":\s*\[/.test(wire), "tuple items arrays must never reach the provider");
});

test("map schema accepts a country group and renders an SVG", async () => {
	assert.equal(Value.Check(mapInputSchema, sample), true);
	const result = await renderMap(sample);
	assert.match(result.svg, /^<svg\b/);
	assert.ok(result.width > 0 && result.height > 0);
	assert.ok(result.svg.includes("Test &amp; map"));
	assert.ok(result.svg.includes("Paris"));
	assert.ok(result.svg.includes("France"));
	assert.ok(!result.svg.includes("NaN"));
	assert.match(result.svg, /<g clip-path="url\(#map-clip\)"/);
});

test("map renderer rejects an inverted bbox", async () => {
	await assert.rejects(
		renderMap({ title: "Broken", view: { bbox: [10, 40, -10, 50] } }),
		/bbox|west|east/i,
	);
});
