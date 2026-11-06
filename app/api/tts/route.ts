import { isPronounceLanguage } from "@/src/core";
import { edgeVoiceFor, synthesizeEdge } from "@/src/server";

/** A spoken selection is a word or a sentence, not a chapter. */
const MAX_TTS_CHARS = 1200;

/**
 * GET /api/tts?lang=fr&text=bonjour
 *
 * The free default voice (Edge Read Aloud). 200 = audio/mpeg; 422 =
 * the language has no Edge voice (Scottish Gaelic today); 502 = Edge
 * refused or the network failed. The client falls back to the OS voice,
 * then to the Forvo window.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const language = (url.searchParams.get("lang") ?? "").trim().toLowerCase();
	const text = (url.searchParams.get("text") ?? "").replace(/\s+/g, " ").trim();

	if (!text) {
		return Response.json({ error: "Missing text.", code: "bad_request" }, { status: 400 });
	}
	if (text.length > MAX_TTS_CHARS) {
		return Response.json(
			{ error: `Text is longer than ${MAX_TTS_CHARS} characters.`, code: "too_long" },
			{ status: 400 },
		);
	}
	if (!isPronounceLanguage(language)) {
		return Response.json({ error: "Unknown language.", code: "bad_language" }, { status: 400 });
	}
	if (!edgeVoiceFor(language)) {
		return Response.json(
			{ error: "Edge has no voice for this language.", code: "no_voice" },
			{ status: 422 },
		);
	}

	try {
		const { audio } = await synthesizeEdge(text, language);
		return new Response(new Uint8Array(audio), {
			headers: {
				"Content-Type": "audio/mpeg",
				"Content-Length": String(audio.length),
				"Cache-Control": "private, max-age=604800",
			},
		});
	} catch (error) {
		console.error("[tts] edge synthesis failed:", error instanceof Error ? error.message : error);
		return Response.json({ error: "Speech is unavailable.", code: "tts_failed" }, { status: 502 });
	}
}
