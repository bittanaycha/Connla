/**
 * Forvo lookup for the pronunciation buttons.
 *
 * The key is optional. Without it the client falls back to the OS voice and
 * the free Forvo search link; with it the client gets a human recording.
 * Server-side so the key never reaches the renderer and the audio bytes are
 * fetched once by the app, not by every client.
 */

import {
	forvoApiLanguage,
	forvoSearchUrl,
	type PronounceLanguage,
} from "../core/pronounce.ts";

export interface ForvoPronunciation {
	/** Base64 audio. */
	audio: string;
	mimeType: string;
	speaker?: string;
	/** Free Forvo page for this word, used as attribution. */
	forvoUrl: string;
}

interface ForvoItem {
	pathmp3?: string;
	pathogg?: string;
	username?: string;
	rate?: number;
}

const API_BASE = "https://apifree.forvo.com";
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;

function itemAudioUrl(item: ForvoItem): string | null {
	const raw = item.pathmp3 ?? item.pathogg;
	if (!raw) return null;
	try {
		const url = new URL(raw, "https://forvo.com");
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
	} catch {
		return null;
	}
}

function audioMimeType(contentType: string | null, url: string): string {
	const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
	if (type.startsWith("audio/")) return type;
	if (url.toLowerCase().endsWith(".ogg")) return "audio/ogg";
	return "audio/mpeg";
}

async function fetchAudio(url: string): Promise<{ audio: string; mimeType: string } | null> {
	const response = await fetch(url, {
		headers: {
			"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Connla/1.0",
			Accept: "audio/*,*/*;q=0.8",
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) return null;
	const length = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(length) && length > MAX_AUDIO_BYTES) return null;
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) return null;
	return {
		audio: bytes.toString("base64"),
		mimeType: audioMimeType(response.headers.get("content-type"), url),
	};
}

/**
 * Ask Forvo for the highest-rated recordings and return the first playable
 * one. Returns null when Forvo has no usable item; throws only for a failed
 * API request (the route treats both as "fall back to TTS", but a thrown
 * error is the upstream-failure case).
 */
export async function fetchForvoPronunciation(
	word: string,
	language: PronounceLanguage,
	key: string,
): Promise<ForvoPronunciation | null> {
	const params = [
		`key/${encodeURIComponent(key)}`,
		"format/json",
		"action/word-pronunciations",
		`word/${encodeURIComponent(word)}`,
		`language/${forvoApiLanguage(language)}`,
		"order/rate-desc",
		"limit/3",
	].join("/");
	const response = await fetch(`${API_BASE}/${params}`, {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`Forvo returned ${response.status}`);

	const payload = (await response.json()) as { items?: ForvoItem[] } | ForvoItem[];
	const items = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
	for (const item of items.slice(0, 3)) {
		const url = itemAudioUrl(item);
		if (!url) continue;
		const audio = await fetchAudio(url).catch(() => null);
		if (!audio) continue;
		return {
			...audio,
			...(typeof item.username === "string" && item.username.trim()
				? { speaker: item.username.trim() }
				: {}),
			forvoUrl: forvoSearchUrl(word, language),
		};
	}
	return null;
}
