import {
	geoArea,
	geoEqualEarth,
	geoGraticule10,
	geoMercator,
	geoNaturalEarth1,
	geoPath,
	type GeoProjection,
} from "d3-geo";
import type { Feature, LineString, Polygon, Position } from "geojson";
import type { MapInput } from "./schema.ts";
import { loadMapData, type MapCollection, type MapFeature } from "./data.ts";

const WIDTH = 1000;
const PAD = 28;
const MIN_HEIGHT = 460;
const MAX_HEIGHT = 920;
const FOOTER = 42;

const PAPER = "#f4ecd9";
const INK = "#2f2a22";
const LAND = "#e9dfc7";
const LAND_STROKE = "#4a4033";
const MUTED = "#6d6252";
const WATER = "#cfdde2";
const WATER_STROKE = "#7b95a3";
const RULE = "#2f2a22";

const FONT_SERIF = "Palatino, 'Palatino Linotype', 'Iowan Old Style', Georgia, serif";
const FONT_SANS = "'Avenir Next', 'Helvetica Neue', Arial, sans-serif";

const PALETTE = ["#8c3b2e", "#3f5d6b", "#6b7a4a", "#b08a3e", "#6d4c7d", "#2f5d5a", "#a0522d", "#4a5d7a"];

type Bbox = [number, number, number, number];
type Point = [number, number];
type RingPoint = [number, number];

interface Rect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

interface LabelCandidate {
	text: string;
	x: number;
	y: number;
	size: number;
	align: "start" | "middle" | "end";
	color: string;
	weight: number;
	letterSpacing: number;
	priority: number;
	/** Original projected point when the label should carry a leader line. */
	leader?: Point;
}

export interface MapRenderResult {
	svg: string;
	width: number;
	height: number;
	notes: string[];
}

export async function renderMap(input: MapInput): Promise<MapRenderResult> {
	const projectionKind = input.view.projection ?? "equal-earth";
	const bbox = validBbox(input.view.bbox, projectionKind);
	const spanLon = bbox[2] - bbox[0];
	const spanLat = bbox[3] - bbox[1];
	const fine = spanLon <= 120 && spanLat <= 70;
	const data = await loadMapData(fine);
	const notes: string[] = [];
	if (fine && !data.fine) notes.push("The detailed 50m land file was unavailable; the 110m outline was used.");

	const top = input.subtitle ? 82 : 66;
	const height = mapHeight(bbox, projectionKind, top);
	const projection = makeProjection(projectionKind);
	projection.fitExtent(
		[
			[PAD, top],
			[WIDTH - PAD, height - FOOTER],
		],
		bboxFeature(bbox),
	);
	const path = geoPath(projection);

	const parts: string[] = [];
	parts.push(`<rect width="${WIDTH}" height="${height}" fill="${PAPER}"/>`);
	parts.push(
		`<defs><clipPath id="map-clip"><rect x="${PAD}" y="${top}" width="${WIDTH - PAD * 2}" height="${height - top - FOOTER}"/></clipPath></defs>`,
	);
	parts.push(`<g clip-path="url(#map-clip)">`);

	if (input.showGraticule) {
		const graticule = path(geoGraticule10());
		if (graticule && !graticule.includes("NaN")) {
			parts.push(
				`<path d="${graticule}" fill="none" stroke="${LAND_STROKE}" stroke-opacity="0.16" stroke-width="0.6" stroke-dasharray="2 4"/>`,
			);
		}
	}

	const land = path(data.land);
	if (land && !land.includes("NaN")) {
		parts.push(`<path d="${land}" fill="${LAND}" stroke="${LAND_STROKE}" stroke-width="0.9" stroke-linejoin="round"/>`);
	}

	if (input.showLakes) {
		const lakes = path(data.lakes);
		if (lakes && !lakes.includes("NaN")) {
			parts.push(`<path d="${lakes}" fill="${WATER}" stroke="${WATER_STROKE}" stroke-width="0.5" stroke-linejoin="round"/>`);
		}
	}
	if (input.showRivers) {
		const rivers = path(data.rivers);
		if (rivers && !rivers.includes("NaN")) {
			parts.push(`<path d="${rivers}" fill="none" stroke="${WATER_STROKE}" stroke-width="0.7" stroke-linecap="round"/>`);
		}
	}
	if (input.showBorders) {
		const borders = path(data.countries);
		if (borders && !borders.includes("NaN")) {
			parts.push(`<path d="${borders}" fill="none" stroke="${LAND_STROKE}" stroke-opacity="0.5" stroke-width="0.45"/>`);
		}
	}

	const lookup = buildCountryLookup(data.countries);
	const areaResult = renderAreas(input, path, lookup, notes);
	parts.push(areaResult.svg);

	const routeResult = renderRoutes(input, path, projection, notes);
	parts.push(routeResult.defs);
	parts.push(routeResult.svg);

	const markerResult = renderMarkers(input, projection);
	parts.push(markerResult.svg);

	const explicit = explicitLabels(input, projection);
	const labels = placeLabels(
		[...areaResult.labels, ...routeResult.labels, ...markerResult.labels, ...explicit],
		WIDTH,
		height,
		top,
	);
	parts.push(labels.svg);
	parts.push(`</g>`);

	const usesCustomAreas = (input.areas ?? []).some((area) => (area.points?.length ?? 0) >= 3);
	const rawCaption = clean(input.caption ?? "");
	const caption = [rawCaption, usesCustomAreas && !/approximat/i.test(rawCaption) ? "Boundaries approximate." : ""]
		.filter(Boolean)
		.join(" ");

	parts.push(renderHeader(input, top));
	parts.push(renderLegend(input, height, top));
	parts.push(renderFooter(caption, height));
	parts.push(`<rect x="10" y="10" width="${WIDTH - 20}" height="${height - 20}" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="1"/>`);

	if (labels.overlaps > 0) notes.push(`${labels.overlaps} label${labels.overlaps === 1 ? "" : "s"} could not be moved clear of another label.`);
	if (labels.skipped > 0) notes.push(`${labels.skipped} label${labels.skipped === 1 ? "" : "s"} fell outside the view.`);

	const title = clean(input.title);
	const subtitle = clean(input.subtitle ?? "");
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${esc(title)}">` +
		`<title>${esc(title)}</title>` +
		`<desc>${esc([title, subtitle, caption].filter(Boolean).join(". "))}</desc>` +
		parts.join("") +
		`</svg>`;

	return { svg, width: WIDTH, height, notes };
}

function mapHeight(bbox: Bbox, kind: NonNullable<MapInput["view"]["projection"]>, top: number): number {
	const p = makeProjection(kind).scale(1).translate([0, 0]);
	const bounds = geoPath(p).bounds(bboxFeature(bbox));
	const w = bounds[1][0] - bounds[0][0];
	const h = bounds[1][1] - bounds[0][1];
	const aspect = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : 1.7;
	const content = (WIDTH - PAD * 2) / aspect;
	return Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, content + top + FOOTER)));
}

function makeProjection(kind: NonNullable<MapInput["view"]["projection"]>): GeoProjection {
	if (kind === "mercator") return geoMercator();
	if (kind === "natural-earth") return geoNaturalEarth1();
	return geoEqualEarth();
}

function validBbox(raw: readonly [number, number, number, number], kind: NonNullable<MapInput["view"]["projection"]>): Bbox {
	let [west, south, east, north] = raw;
	if (![west, south, east, north].every(Number.isFinite)) throw new Error("view.bbox must be four finite numbers.");
	if (west < -180 || east > 180 || south < -90 || north > 90) throw new Error("view.bbox is outside the world.");
	if (west >= east) throw new Error("view.bbox west must be less than east; antimeridian-crossing views are not supported.");
	if (south >= north) throw new Error("view.bbox south must be less than north.");
	if (kind === "mercator") {
		south = Math.max(south, -85);
		north = Math.min(north, 85);
		if (south >= north) throw new Error("Mercator views must stay between 85°S and 85°N.");
	}
	if (east - west < 0.2 || north - south < 0.2) throw new Error("view.bbox is too small to draw.");
	return [west, south, east, north];
}

function bboxFeature(bbox: Bbox): Feature<Polygon> {
	const [west, south, east, north] = bbox;
	return {
		type: "Feature",
		properties: {},
		geometry: {
			type: "Polygon",
			coordinates: [
				normalizeRing([
					[west, south],
					[west, north],
					[east, north],
					[east, south],
					[west, south],
				]),
			],
		},
	};
}

function buildCountryLookup(countries: MapCollection): Map<string, MapFeature> {
	const lookup = new Map<string, MapFeature>();
	for (const feature of countries.features) {
		const props = feature.properties ?? {};
		for (const key of ["ISO_A3", "ADM0_A3", "SOV_A3", "NAME", "NAME_LONG", "ADMIN"]) {
			const value = props[key];
			if (typeof value !== "string") continue;
			const normalized = value.trim().toUpperCase();
			if (normalized.length < 2 || normalized === "-99") continue;
			if (!lookup.has(normalized)) lookup.set(normalized, feature);
		}
	}
	return lookup;
}

function renderAreas(
	input: MapInput,
	path: ReturnType<typeof geoPath>,
	lookup: Map<string, MapFeature>,
	notes: string[],
): { svg: string; labels: LabelCandidate[] } {
	const out: string[] = [];
	const labels: LabelCandidate[] = [];
	(input.areas ?? []).forEach((area, index) => {
		const color = safeColor(area.color, PALETTE[index % PALETTE.length] ?? "#8c3b2e");
		const opacity = area.opacity ?? 0.32;
		const selected: MapFeature[] = [];
		const seen = new Set<MapFeature>();
		for (const name of area.countries ?? []) {
			const feature = lookup.get(name.trim().toUpperCase());
			if (!feature) {
				notes.push(`Unknown country "${name}" in area "${area.name}".`);
				continue;
			}
			if (seen.has(feature)) continue;
			seen.add(feature);
			selected.push(feature);
		}

		let labelPoint: Point | null = null;
		if (selected.length > 0) {
			const collection: MapCollection = { type: "FeatureCollection", features: selected };
			const d = path(collection);
			if (d && !d.includes("NaN")) {
				out.push(`<path d="${d}" fill="${color}" fill-opacity="${opacity}" stroke="none"/>`);
				const centroid = path.centroid(collection);
				if (Number.isFinite(centroid[0]) && Number.isFinite(centroid[1])) labelPoint = [centroid[0], centroid[1]];
			}
		}

		if (area.points && area.points.length >= 3) {
			const ring = normalizeRing(closeRing(area.points));
			const polygon: Feature<Polygon> = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
			const d = path(polygon);
			if (d && !d.includes("NaN")) {
				out.push(
					`<path d="${d}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-opacity="0.85" stroke-width="1.2" stroke-linejoin="round"/>`,
				);
				const centroid = path.centroid(polygon);
				if (Number.isFinite(centroid[0]) && Number.isFinite(centroid[1])) labelPoint = [centroid[0], centroid[1]];
			} else {
				notes.push(`Area "${area.name}" could not be projected.`);
			}
		}

		if (area.label !== false && labelPoint) {
			labels.push({
				text: clean(area.name).toUpperCase(),
				x: labelPoint[0],
				y: labelPoint[1],
				size: 12.5,
				align: "middle",
				color: INK,
				weight: 600,
				letterSpacing: 0.9,
				priority: 4,
			});
		}
	});
	return { svg: out.join(""), labels };
}

function renderRoutes(
	input: MapInput,
	path: ReturnType<typeof geoPath>,
	projection: GeoProjection,
	notes: string[],
): { svg: string; defs: string; labels: LabelCandidate[] } {
	const out: string[] = [];
	const defs: string[] = [];
	const labels: LabelCandidate[] = [];
	(input.routes ?? []).forEach((route, index) => {
		const line: Feature<LineString> = {
			type: "Feature",
			properties: {},
			geometry: { type: "LineString", coordinates: route.points.map((p) => [p[0], p[1]] as Position) },
		};
		const d = path(line);
		if (!d || d.includes("NaN")) {
			notes.push(`Route ${index + 1} could not be projected.`);
			return;
		}
		const color = safeColor(route.color, INK);
		const arrow = route.arrow !== false;
		const markerId = `map-arrow-${index}`;
		if (arrow) {
			defs.push(
				`<marker id="${markerId}" viewBox="0 0 10 8" refX="8.5" refY="4" markerWidth="9" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="${color}"/></marker>`,
			);
		}
		const dash = route.dashed ? ` stroke-dasharray="7 5"` : "";
		const end = arrow ? ` marker-end="url(#${markerId})"` : "";
		out.push(
			`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"${dash}${end}/>`,
		);

		if (route.label) {
			const mid = routeMidpoint(route.points);
			const p = project(projection, mid);
			if (p) {
				labels.push({
					text: clean(route.label),
					x: p[0],
					y: p[1] - 10,
					size: 12,
					align: "middle",
					color,
					weight: 600,
					letterSpacing: 0.2,
					priority: 3,
				});
			}
		}
	});
	return { svg: out.join(""), defs: defs.join(""), labels };
}

function routeMidpoint(points: readonly (readonly [number, number])[]): Point {
	const middle = (points.length - 1) / 2;
	const a = points[Math.floor(middle)];
	const b = points[Math.ceil(middle)];
	if (!a) return [0, 0];
	if (!b) return [a[0], a[1]];
	return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function renderMarkers(input: MapInput, projection: GeoProjection): { svg: string; labels: LabelCandidate[] } {
	const out: string[] = [];
	const labels: LabelCandidate[] = [];
	for (const marker of input.markers ?? []) {
		const p = project(projection, marker.at);
		if (!p) continue;
		const size = marker.size ?? 4;
		const color = safeColor(marker.color, INK);
		out.push(`<circle cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="${size}" fill="${color}" stroke="${PAPER}" stroke-width="1.4"/>`);
		if (marker.label) {
			const offset = marker.offset ?? [9, -9];
			labels.push({
				text: clean(marker.label),
				x: p[0] + offset[0],
				y: p[1] + offset[1],
				size: 12,
				align: offset[0] >= 0 ? "start" : "end",
				color: INK,
				weight: 600,
				letterSpacing: 0.1,
				priority: 2,
			});
		}
	}
	return { svg: out.join(""), labels };
}

function explicitLabels(input: MapInput, projection: GeoProjection): LabelCandidate[] {
	const labels: LabelCandidate[] = [];
	for (const label of input.labels ?? []) {
		const p = project(projection, label.at);
		if (!p) continue;
		const text = clean(label.text);
		if (!text) continue;
		const offset = label.offset ?? [8, -8];
		const align = label.align ?? (offset[0] >= 0 ? "start" : "end");
		labels.push({
			text,
			x: p[0] + offset[0],
			y: p[1] + offset[1],
			size: label.size ?? 13,
			align,
			color: safeColor(label.color, INK),
			weight: 500,
			letterSpacing: 0.2,
			priority: 1,
			...(label.leader ? { leader: p } : {}),
		});
	}
	return labels;
}

function placeLabels(
	candidates: LabelCandidate[],
	width: number,
	height: number,
	top: number,
): { svg: string; overlaps: number; skipped: number } {
	const out: string[] = [];
	const boxes: Rect[] = [];
	let overlaps = 0;
	let skipped = 0;
	const sorted = [...candidates].sort((a, b) => a.priority - b.priority);
	for (const candidate of sorted) {
		if (!candidate.text) continue;
		const bounds = textBox(candidate, candidate.x, candidate.y);
		if (bounds.x0 < PAD - 4 || bounds.x1 > width - PAD + 4 || bounds.y0 < top - 4 || bounds.y1 > height - FOOTER + 4) {
			skipped += 1;
			continue;
		}
		let chosen: Point = [candidate.x, candidate.y];
		let box = bounds;
		let fits = !collides(box, boxes);
		if (!fits) {
			const offsets: Point[] = [
				[0, -15],
				[0, 15],
				[16, 0],
				[-16, 0],
				[0, -28],
				[0, 28],
				[24, -18],
				[-24, -18],
				[24, 18],
				[-24, 18],
			];
			for (const [dx, dy] of offsets) {
				const p: Point = [candidate.x + dx, candidate.y + dy];
				const b = textBox(candidate, p[0], p[1]);
				if (b.x0 < PAD - 4 || b.x1 > width - PAD + 4 || b.y0 < top - 4 || b.y1 > height - FOOTER + 4) continue;
				if (collides(b, boxes)) continue;
				chosen = p;
				box = b;
				fits = true;
				break;
			}
		}
		if (!fits) overlaps += 1;
		boxes.push(box);
		out.push(drawLabel(candidate, chosen));
	}
	return { svg: out.join(""), overlaps, skipped };
}

function drawLabel(candidate: LabelCandidate, point: Point): string {
	const leader =
		candidate.leader &&
		(Math.abs(point[0] - candidate.leader[0]) > 5 || Math.abs(point[1] - candidate.leader[1]) > 5)
			? `<line x1="${fmt(candidate.leader[0])}" y1="${fmt(candidate.leader[1])}" x2="${fmt(point[0])}" y2="${fmt(point[1] - candidate.size * 0.3)}" stroke="${INK}" stroke-opacity="0.45" stroke-width="0.8"/>`
			: "";
	const halo = Math.max(2.4, candidate.size * 0.22);
	return (
		leader +
		`<text x="${fmt(point[0])}" y="${fmt(point[1])}" font-family="${FONT_SERIF}" font-size="${candidate.size}" font-weight="${candidate.weight}" fill="${candidate.color}" text-anchor="${candidate.align}" letter-spacing="${candidate.letterSpacing}" paint-order="stroke" stroke="${PAPER}" stroke-width="${fmt(halo)}" stroke-linejoin="round">${esc(candidate.text)}</text>`
	);
}

function textBox(candidate: LabelCandidate, x: number, y: number): Rect {
	const w = textWidth(candidate.text, candidate.size, candidate.letterSpacing) + 8;
	const h = candidate.size * 1.3;
	const x0 = candidate.align === "middle" ? x - w / 2 : candidate.align === "end" ? x - w : x;
	return { x0: x0 - 2, y0: y - candidate.size * 1.05 - 2, x1: x0 + w + 2, y1: y + candidate.size * 0.3 + 2 };
}

function textWidth(text: string, size: number, letterSpacing: number): number {
	let width = 0;
	let count = 0;
	for (const ch of text) {
		if (/[\u3000-\u9fff\uac00-\ud7af]/.test(ch)) width += size;
		else if (/[A-Z]/.test(ch)) width += size * 0.62;
		else if (/[ilj.,'!|:;]/.test(ch)) width += size * 0.3;
		else if (ch === " ") width += size * 0.28;
		else width += size * 0.5;
		count += 1;
	}
	return width + Math.max(0, count - 1) * letterSpacing;
}

function collides(a: Rect, boxes: Rect[]): boolean {
	return boxes.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
}

function renderHeader(input: MapInput, top: number): string {
	const title = clip(clean(input.title), 90);
	const subtitle = input.subtitle ? clip(clean(input.subtitle), 130) : "";
	const ruleY = top - 10;
	return (
		`<text x="${PAD}" y="${subtitle ? 38 : 42}" font-family="${FONT_SERIF}" font-size="23" font-weight="600" fill="${INK}" letter-spacing="0.2">${esc(title)}</text>` +
		(subtitle
			? `<text x="${PAD}" y="59" font-family="${FONT_SANS}" font-size="12.5" fill="${MUTED}" letter-spacing="0.3">${esc(subtitle)}</text>`
			: "") +
		`<line x1="${PAD}" y1="${ruleY}" x2="${WIDTH - PAD}" y2="${ruleY}" stroke="${RULE}" stroke-opacity="0.16" stroke-width="1"/>`
	);
}

function renderFooter(caption: string, height: number): string {
	const text = clip(caption, 104);
	const y = height - 17;
	return (
		`<line x1="${PAD}" y1="${height - 31}" x2="${WIDTH - PAD}" y2="${height - 31}" stroke="${RULE}" stroke-opacity="0.12" stroke-width="1"/>` +
		(text
			? `<text x="${PAD}" y="${y}" font-family="${FONT_SANS}" font-size="10.5" fill="${MUTED}">${esc(text)}</text>`
			: "") +
		`<text x="${WIDTH - PAD}" y="${y}" text-anchor="end" font-family="${FONT_SANS}" font-size="10.5" fill="${MUTED}">Base map: Natural Earth · public domain</text>`
	);
}

function renderLegend(input: MapInput, height: number, top: number): string {
	const entries = input.legend ?? [];
	if (entries.length === 0) return "";
	const lineHeight = 18;
	const panelHeight = entries.length * lineHeight + 18;
	const panelWidth = 206;
	const x = PAD + 8;
	const y = height - FOOTER - panelHeight - 14;
	if (y < top + 8) return "";
	const rows: string[] = [];
	entries.forEach((entry, index) => {
		const color = safeColor(entry.color, PALETTE[index % PALETTE.length] ?? INK);
		const kind = entry.kind ?? "swatch";
		const ey = y + 20 + index * lineHeight;
		const symbol =
			kind === "line"
				? `<line x1="${x + 9}" y1="${ey - 3}" x2="${x + 25}" y2="${ey - 3}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`
				: kind === "dot"
					? `<circle cx="${x + 17}" cy="${ey - 4}" r="4" fill="${color}" stroke="${PAPER}" stroke-width="1"/>`
					: `<rect x="${x + 10}" y="${ey - 10}" width="13" height="13" rx="2" fill="${color}" fill-opacity="0.55" stroke="${color}" stroke-width="1"/>`;
		rows.push(
			`${symbol}<text x="${x + 32}" y="${ey}" font-family="${FONT_SANS}" font-size="11" fill="${INK}">${esc(clip(clean(entry.label), 28))}</text>`,
		);
	});
	return (
		`<g>` +
		`<rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" rx="5" fill="${PAPER}" fill-opacity="0.9" stroke="${INK}" stroke-opacity="0.16" stroke-width="1"/>` +
		rows.join("") +
		`</g>`
	);
}

function project(projection: GeoProjection, point: readonly [number, number]): Point | null {
	const p = projection([point[0], point[1]]);
	if (!p) return null;
	return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : null;
}

function closeRing(points: readonly (readonly [number, number])[]): RingPoint[] {
	const ring: RingPoint[] = points.map(([lon, lat]) => [lon, lat]);
	const first = ring[0];
	const last = ring[ring.length - 1];
	if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
	return ring;
}

/** GeoJSON winding is advisory; d3-geo treats a ring over a hemisphere as the
 *  complement. Reverse so every area fills the smaller side. */
function normalizeRing(ring: RingPoint[]): RingPoint[] {
	const polygon: Feature<Polygon> = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
	return geoArea(polygon) > 2 * Math.PI ? [...ring].reverse() : ring;
}

function safeColor(value: string | undefined, fallback: string): string {
	if (!value) return fallback;
	const v = value.trim();
	if (/^#[0-9a-f]{6}$/i.test(v)) return v;
	if (/^#[0-9a-f]{3}$/i.test(v)) {
		const [r, g, b] = v.slice(1).split("");
		if (r && g && b) return `#${r}${r}${g}${g}${b}${b}`;
	}
	return fallback;
}

function clean(value: string): string {
	return value
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function clip(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function esc(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function fmt(value: number): string {
	return (Math.round(value * 10) / 10).toString();
}
