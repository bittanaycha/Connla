import type { AgentTool } from "@earendil-works/pi-agent-core";
import { mapInputSchema } from "../maps/schema.ts";
import { renderMap } from "../maps/render.ts";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import type { MapDetails } from "../../core/contracts.ts";

/**
 * map (2026-11): the deterministic map maker. The teacher supplies a
 * structured view + annotations; d3-geo draws Natural Earth coastlines on
 * warm paper. Synchronous, unlike visual: there is no authoring loop, so
 * the map lands in the same turn. The SVG rides in `details` only — the
 * model gets one text line, never the drawing.
 */
export function createMapTool(): AgentTool<typeof mapInputSchema> {
	return {
		name: "map",
		label: "map",
		description:
			"Draw a simplified map and show it immediately. Use it when location, territory, routes, or spatial relationships carry the point: historical borders, campaigns, migration, trade, physical geography. " +
			"You choose the view and the annotations; the app draws coastlines and land from Natural Earth. No OpenStreetMap. " +
			"view.bbox is [west, south, east, north] in degrees. Shade regions with areas — countries by ISO alpha-3 code (FRA, DEU, RUS) for modern territory, or points (a lon/lat ring) for historical or physical boundaries. " +
			"Mark places with markers, movement with routes (arrows by default), and annotate with labels and a legend. Keep custom outlines rough, about 6–20 points: this is a teaching diagram, not a survey. Put 'approximate' in the caption when boundaries are uncertain. " +
			"One map per point. The map is already displayed; do not repeat its labels in prose.",
		parameters: mapInputSchema,
		execute: serverExecute("map", mapInputSchema, async (input, { signal }): Promise<ImageFileResult> => {
			signal?.throwIfAborted();
			const rendered = await renderMap(input);
			signal?.throwIfAborted();
			const caption = input.caption?.trim();
			const details: MapDetails = {
				title: input.title.trim(),
				...(caption ? { caption } : {}),
				svg: rendered.svg,
				width: rendered.width,
				height: rendered.height,
			};
			const notes = rendered.notes.length > 0 ? ` ${rendered.notes.join(" ")}` : "";
			return {
				text: `Map shown to the learner: "${details.title}" (${rendered.width}×${rendered.height}).${notes} It is already displayed.`,
				details,
			};
		}),
	};
}
