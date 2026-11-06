import { stores } from "@/src/server";

/** DELETE /api/highlights/[id] — remove the saved passage. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const deleted = stores.libraryStore.deleteHighlight(id);
	if (!deleted) return Response.json({ error: "Highlight not found.", code: "not_found" }, { status: 404 });
	return Response.json({ ok: true });
}
