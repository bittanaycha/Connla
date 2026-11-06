import {
	cleanMultiline,
	cleanText,
	isWebUrl,
	MAX_READING_AUTHOR_CHARS,
	MAX_READING_NOTE_CHARS,
	MAX_READING_TITLE_CHARS,
	MAX_READING_URL_CHARS,
} from "@/src/core";
import { stores } from "@/src/server";

/** PATCH /api/reading/[id] — edit title, author, link, or note. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return Response.json({ error: "Invalid JSON.", code: "bad_request" }, { status: 400 });

	const patch: { title?: string; author?: string; url?: string; note?: string } = {};

	if (typeof body.title === "string") {
		const raw = body.title.trim();
		if (!raw) return Response.json({ error: "Missing title.", code: "bad_request" }, { status: 400 });
		if (raw.length > MAX_READING_TITLE_CHARS) {
			return Response.json({ error: "Title is too long.", code: "too_long" }, { status: 422 });
		}
		patch.title = cleanText(raw, MAX_READING_TITLE_CHARS);
	}
	if (typeof body.author === "string") patch.author = cleanText(body.author, MAX_READING_AUTHOR_CHARS);
	if (typeof body.note === "string") patch.note = cleanMultiline(body.note, MAX_READING_NOTE_CHARS);
	if (typeof body.url === "string") {
		const url = cleanText(body.url, MAX_READING_URL_CHARS);
		if (url && !isWebUrl(url)) {
			return Response.json({ error: "The link needs to be an http(s) URL.", code: "bad_url" }, { status: 422 });
		}
		patch.url = url;
	}

	if (Object.keys(patch).length === 0) {
		return Response.json({ error: "Nothing to update.", code: "bad_request" }, { status: 400 });
	}

	const entry = stores.libraryStore.updateReading(id, patch);
	if (!entry) return Response.json({ error: "Reading item not found.", code: "not_found" }, { status: 404 });
	return Response.json({ entry });
}

/** DELETE /api/reading/[id] — remove the item. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const deleted = stores.libraryStore.deleteReading(id);
	if (!deleted) return Response.json({ error: "Reading item not found.", code: "not_found" }, { status: 404 });
	return Response.json({ ok: true });
}
