import { MAX_GLOSSARY_CONTEXT_CHARS, MAX_TRANSLATE_CHARS, cleanText } from "@/src/core";
import { generateExplanation, LibraryModelError } from "@/src/server";

/** POST /api/explain — one-shot explanation for an explanation card. */
export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return Response.json({ error: "Invalid JSON.", code: "bad_request" }, { status: 400 });
	const text = cleanText(body.text, MAX_TRANSLATE_CHARS);
	if (!text) return Response.json({ error: "Missing text.", code: "bad_request" }, { status: 400 });
	const context = cleanText(body.context, MAX_GLOSSARY_CONTEXT_CHARS);
	const language = typeof body.language === "string" ? body.language : undefined;
	try {
		const explanation = await generateExplanation({ text, context, language, abortSignal: request.signal });
		return Response.json({ explanation });
	} catch (error) {
		if (error instanceof LibraryModelError) {
			return Response.json(
				{ error: error.message, code: error.code },
				{ status: error.code === "models_not_configured" ? 503 : 502 },
			);
		}
		return Response.json(
			{ error: "The explanation could not be generated.", code: "explanation_failed" },
			{ status: 502 },
		);
	}
}
