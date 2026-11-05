import { fetchLinkPreview } from "@/src/server";

export const runtime = "nodejs";

/** GET /api/link-preview?url=… — a small metadata card for an external link. */
export async function GET(request: Request) {
	const raw = new URL(request.url).searchParams.get("url");
	if (!raw || raw.length > 2_048) {
		return Response.json({ error: "A valid url is required." }, { status: 400 });
	}
	const preview = await fetchLinkPreview(raw);
	if (!preview) {
		return Response.json({ error: "No preview is available for this link." }, { status: 404 });
	}
	return Response.json(preview, { headers: { "Cache-Control": "private, max-age=300" } });
}
