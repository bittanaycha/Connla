import {
	cleanMultiline,
	cleanText,
	isWebUrl,
	MAX_READING_AUTHOR_CHARS,
	MAX_READING_NOTE_CHARS,
	MAX_READING_TITLE_CHARS,
	MAX_READING_URL_CHARS,
	readingKey,
	sanitizeSource,
} from "@/src/core";
import { stores } from "@/src/server";

/**
 * GET  /api/reading — the reading list, file order.
 * POST /api/reading — add an item by hand or through the teacher's
 *      add_reading tool. {title, author?, url?, note?, source?} → 201
 *      The same title (or URL) returns the existing row (200 duplicate).
 */
export async function GET() {
	return Response.json({ entries: stores.libraryStore.listReading() });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return Response.json({ error: "Invalid JSON.", code: "bad_request" }, { status: 400 });

	const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
	if (!rawTitle) return Response.json({ error: "Missing title.", code: "bad_request" }, { status: 400 });
	if (rawTitle.length > MAX_READING_TITLE_CHARS) {
		return Response.json({ error: "Title is too long.", code: "too_long" }, { status: 422 });
	}

	const title = cleanText(rawTitle, MAX_READING_TITLE_CHARS);
	const author = cleanText(body.author, MAX_READING_AUTHOR_CHARS);
	const url = cleanText(body.url, MAX_READING_URL_CHARS);
	if (url && !isWebUrl(url)) {
		return Response.json({ error: "The link needs to be an http(s) URL.", code: "bad_url" }, { status: 422 });
	}
	const note = cleanMultiline(body.note, MAX_READING_NOTE_CHARS);
	const source = sanitizeSource(body.source);

	const key = readingKey(title, url);
	const duplicate = stores.libraryStore
		.listReading()
		.find((entry) => readingKey(entry.title, entry.url) === key);
	if (duplicate) return Response.json({ entry: duplicate, duplicate: true }, { status: 200 });

	const entry = stores.libraryStore.addReading({ title, author, url, note, source });
	return Response.json({ entry }, { status: 201 });
}
