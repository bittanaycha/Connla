import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Feature, FeatureCollection, Geometry } from "geojson";

export type MapFeature = Feature<Geometry, Record<string, unknown> | null>;
export type MapCollection = FeatureCollection<Geometry, Record<string, unknown> | null>;

export interface MapData {
	land: MapCollection;
	countries: MapCollection;
	rivers: MapCollection;
	lakes: MapCollection;
	/** True when the 50m land file was used. */
	fine: boolean;
}

const cache = new Map<string, MapCollection>();

/**
 * Natural Earth ships as public-domain GeoJSON under public/geo. The
 * standalone build copies public/, so process.cwd()/public/geo resolves in
 * both `next dev` and the packaged server.
 */
async function readCollection(name: string): Promise<MapCollection> {
	const cached = cache.get(name);
	if (cached) return cached;
	const file = path.join(process.cwd(), "public", "geo", name);
	const text = await readFile(file, "utf8");
	const parsed = JSON.parse(text) as MapCollection;
	if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
		throw new Error(`${name} is not a GeoJSON FeatureCollection`);
	}
	cache.set(name, parsed);
	return parsed;
}

export async function loadMapData(fine: boolean): Promise<MapData> {
	let land: MapCollection;
	let usedFine = fine;
	if (fine) {
		try {
			land = await readCollection("ne_50m_land.geojson");
		} catch {
			land = await readCollection("ne_110m_land.geojson");
			usedFine = false;
		}
	} else {
		land = await readCollection("ne_110m_land.geojson");
	}
	const [countries, rivers, lakes] = await Promise.all([
		readCollection("ne_110m_admin_0_countries.geojson"),
		readCollection("ne_110m_rivers_lake_centerlines.geojson"),
		readCollection("ne_110m_lakes.geojson"),
	]);
	return { land, countries, rivers, lakes, fine: usedFine };
}
