import { cleanMultiline, MAX_HIGHLIGHT_CHARS, normalizeLanguage, sanitizeSource } from "@/src/core";
import { stores } from "@/src/server";

/**
 * GET  /api/highlights — every saved passage.
 * POST /api/highlights — {text, language, source} → 201 {entry}
 *      The same passage from the same message returns the existing row
 *      (200 {entry, duplicate: true}) so repeated selections stay one row.
 */
export async function GET() {
	return Response.json({ entries: stores.libraryStore.listHighlights() });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return Response.json({ error: "Invalid JSON.", code: "bad_request" }, { status: 400 });

	const rawText = typeof body.text === "string" ? body.text.trim() : "";
	if (!rawText) return Response.json({ error: "Missing text.", code: "bad_request" }, { status: 400 });
	if (rawText.length > MAX_HIGHLIGHT_CHARS) {
		return Response.json(
			{ error: `Select up to ${MAX_HIGHLIGHT_CHARS} characters to save.`, code: "too_long" },
			{ status: 422 },
		);
	}

	const text = cleanMultiline(rawText, MAX_HIGHLIGHT_CHARS);
	const language = normalizeLanguage(body.language);
	const source = sanitizeSource(body.source);

	const duplicate = stores.libraryStore
		.listHighlights()
		.find(
			(entry) =>
				entry.text === text &&
				entry.source.chatId === source.chatId &&
				entry.source.messageId === source.messageId,
		);
	if (duplicate) return Response.json({ entry: duplicate, duplicate: true }, { status: 200 });

	const entry = stores.libraryStore.addHighlight({ text, language, source });
	return Response.json({ entry }, { status: 201 });
}
