import { keyValue } from "@/src/server";
import { isPronounceLanguage } from "@/src/core";
import { fetchForvoPronunciation } from "@/src/server";

export const runtime = "nodejs";

const MAX_WORD_LENGTH = 64;

function ttsFallback(message: string, status: number) {
	return Response.json(
		{ fallback: "tts", message },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const language = (url.searchParams.get("lang") ?? "").trim().toLowerCase();
	const word = (url.searchParams.get("word") ?? "").replace(/\s+/g, " ").trim();

	if (!isPronounceLanguage(language)) {
		return Response.json({ message: "Unsupported pronunciation language." }, { status: 400 });
	}
	if (!word || word.length > MAX_WORD_LENGTH || /[\u0000-\u001f\u007f]/.test(word)) {
		return Response.json({ message: "Invalid word." }, { status: 400 });
	}

	const key = keyValue("FORVO_API_KEY");
	if (!key) {
		return ttsFallback("No Forvo key — using the system voice.", 404);
	}

	try {
		const pronunciation = await fetchForvoPronunciation(word, language, key);
		if (!pronunciation) {
			return ttsFallback("No Forvo recording found — using the system voice.", 404);
		}
		return Response.json(pronunciation, {
			headers: {
				// The same word is clicked repeatedly in a lesson; keep the bytes
				// local without making Forvo's API the hot path.
				"Cache-Control": "private, max-age=1800",
			},
		});
	} catch {
		return ttsFallback("Forvo unreachable — using the system voice.", 502);
	}
}
