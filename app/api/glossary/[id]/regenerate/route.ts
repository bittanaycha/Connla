import { generateGlossaryDefinition, LibraryModelError, stores } from "@/src/server";

/**
 * POST /api/glossary/[id]/regenerate — ask the cheap model for a fresh
 * definition of the saved term. The row keeps its term, form, language, and
 * source; only the part of speech and definition are replaced.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const entry = stores.libraryStore.listGlossary().find((entry) => entry.id === id) ?? null;
	if (!entry) return Response.json({ error: "Glossary entry not found.", code: "not_found" }, { status: 404 });

	try {
		const generated = await generateGlossaryDefinition({
			term: entry.term,
			form: entry.form || entry.term,
			context: "",
			language: entry.language,
			abortSignal: request.signal,
		});
		const updated = stores.libraryStore.updateGlossary(id, {
			partOfSpeech: generated.partOfSpeech,
			definition: generated.definition,
		});
		if (!updated) return Response.json({ error: "Glossary entry not found.", code: "not_found" }, { status: 404 });
		return Response.json({ entry: updated });
	} catch (error) {
		if (error instanceof LibraryModelError) {
			return Response.json(
				{ error: error.message, code: error.code },
				{ status: error.code === "models_not_configured" ? 503 : 502 },
			);
		}
		return Response.json(
			{ error: "The definition could not be regenerated.", code: "definition_failed" },
			{ status: 502 },
		);
	}
}
