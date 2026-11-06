import { cleanText, MAX_DEFINITION_CHARS, MAX_GLOSSARY_CHARS, MAX_PART_OF_SPEECH_CHARS } from "@/src/core";
import { stores } from "@/src/server";

/**
 * PATCH  /api/glossary/[id] — edit the term, part of speech, or definition.
 * DELETE /api/glossary/[id] — remove the entry.
 *
 * A rename that would collide with another entry in the same language is
 * refused with 409 so the list never holds two rows for one lemma.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const existing = stores.libraryStore.listGlossary().find((entry) => entry.id === id) ?? null;
	if (!existing) return Response.json({ error: "Glossary entry not found.", code: "not_found" }, { status: 404 });

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return Response.json({ error: "Invalid JSON.", code: "bad_request" }, { status: 400 });

	const patch: { term?: string; partOfSpeech?: string; definition?: string } = {};

	if (typeof body.term === "string") {
		const term = cleanText(body.term, MAX_GLOSSARY_CHARS);
		if (!term) return Response.json({ error: "Missing term.", code: "bad_request" }, { status: 400 });
		if (term.length > MAX_GLOSSARY_CHARS) {
			return Response.json({ error: "Term is too long.", code: "too_long" }, { status: 422 });
		}
		const clash = stores.libraryStore.findGlossary(term, existing.language);
		if (clash && clash.id !== existing.id) {
			return Response.json(
				{ error: `"${clash.term}" is already in the glossary.`, code: "duplicate", entry: clash },
				{ status: 409 },
			);
		}
		patch.term = term;
	}

	if (typeof body.partOfSpeech === "string") {
		patch.partOfSpeech = cleanText(body.partOfSpeech, MAX_PART_OF_SPEECH_CHARS);
	}

	if (typeof body.definition === "string") {
		const definition = cleanText(body.definition, MAX_DEFINITION_CHARS);
		if (!definition) return Response.json({ error: "Missing definition.", code: "bad_request" }, { status: 400 });
		patch.definition = definition;
	}

	if (Object.keys(patch).length === 0) {
		return Response.json({ error: "Nothing to update.", code: "bad_request" }, { status: 400 });
	}

	const entry = stores.libraryStore.updateGlossary(id, patch);
	if (!entry) return Response.json({ error: "Glossary entry not found.", code: "not_found" }, { status: 404 });
	return Response.json({ entry });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const deleted = stores.libraryStore.deleteGlossary(id);
	if (!deleted) return Response.json({ error: "Glossary entry not found.", code: "not_found" }, { status: 404 });
	return Response.json({ ok: true });
}
