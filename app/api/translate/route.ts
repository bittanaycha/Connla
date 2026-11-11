import {
	cleanText,
	MAX_GLOSSARY_CONTEXT_CHARS,
	MAX_TRANSLATE_CHARS,
	normalizeLanguage,
} from "@/src/core";
import { generateTranslation, LibraryModelError } from "@/src/server";

/**
 * POST /api/translate — the selection popup's one-shot translation.
 *      {text, language?, target?, context?} → 200 {translation, note}
 *      400 invalid body, 422 over MAX_TRANSLATE_CHARS, 503 when no model
 *      slot is configured, 502 when the model's answer cannot be parsed.
 */
export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return Response.json({ error: "Invalid JSON.", code: "bad_request" }, { status: 400 });

	const rawText = typeof body.text === "string" ? body.text.trim() : "";
	if (!rawText) return Response.json({ error: "Missing text.", code: "bad_request" }, { status: 400 });
	if (rawText.length > MAX_TRANSLATE_CHARS) {
		return Response.json(
			{ error: `Select up to ${MAX_TRANSLATE_CHARS} characters to translate.`, code: "too_long" },
			{ status: 422 },
		);
	}

	const text = cleanText(rawText, MAX_TRANSLATE_CHARS);
	const language = normalizeLanguage(body.language);
	const target = normalizeLanguage(body.target);
	const context = cleanText(body.context, MAX_GLOSSARY_CONTEXT_CHARS);

	let generated;
	try {
		generated = await generateTranslation({
			text,
			context,
			language,
			target,
			abortSignal: request.signal,
		});
	} catch (error) {
		if (error instanceof LibraryModelError) {
			return Response.json(
				{ error: error.message, code: error.code },
				{ status: error.code === "models_not_configured" ? 503 : 502 },
			);
		}
		return Response.json(
			{ error: "The translation could not be generated.", code: "translation_failed" },
			{ status: 502 },
		);
	}

	return Response.json({ translation: generated.translation, note: generated.note });
}
