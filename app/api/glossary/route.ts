import {
	cleanText,
	MAX_GLOSSARY_CHARS,
	MAX_GLOSSARY_CONTEXT_CHARS,
	normalizeLanguage,
	sanitizeSource,
} from "@/src/core";
import { generateGlossaryDefinition, LibraryModelError, stores } from "@/src/server";

/**
 * GET  /api/glossary — every entry, newest-last file order.
 * POST /api/glossary — add the selection, generating its definition first.
 *      {term, form?, language, context?, source?} → 201 {entry}
 *      duplicate term+language → 200 {entry, duplicate: true}
 *      503 when no model slot is configured, 502 when the model's answer
 *      cannot be parsed, 422 when the selection is too long.
 */
export async function GET() {
	return Response.json({ entries: stores.libraryStore.listGlossary() });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return Response.json({ error: "Invalid JSON.", code: "bad_request" }, { status: 400 });

	const rawTerm = typeof body.term === "string" ? body.term.trim() : "";
	if (!rawTerm) return Response.json({ error: "Missing term.", code: "bad_request" }, { status: 400 });
	if (rawTerm.length > MAX_GLOSSARY_CHARS) {
		return Response.json(
			{ error: `Select up to ${MAX_GLOSSARY_CHARS} characters for a glossary term.`, code: "too_long" },
			{ status: 422 },
		);
	}

	const term = cleanText(rawTerm, MAX_GLOSSARY_CHARS);
	const form = cleanText(body.form ?? rawTerm, MAX_GLOSSARY_CHARS) || term;
	const language = normalizeLanguage(body.language);
	const context = cleanText(body.context, MAX_GLOSSARY_CONTEXT_CHARS);
	const source = sanitizeSource(body.source);

	const existing = stores.libraryStore.findGlossary(term, language);
	if (existing) return Response.json({ entry: existing, duplicate: true }, { status: 200 });

	let generated;
	try {
		generated = await generateGlossaryDefinition({
			term,
			form,
			context,
			language,
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
			{ error: "The definition could not be generated.", code: "definition_failed" },
			{ status: 502 },
		);
	}

	const duplicate = stores.libraryStore.findGlossary(generated.term, generated.language);
	if (duplicate) return Response.json({ entry: duplicate, duplicate: true }, { status: 200 });

	const entry = stores.libraryStore.addGlossary({
		term: generated.term || term,
		form,
		language: generated.language || language,
		partOfSpeech: generated.partOfSpeech,
		definition: generated.definition,
		source,
	});
	return Response.json({ entry }, { status: 201 });
}
