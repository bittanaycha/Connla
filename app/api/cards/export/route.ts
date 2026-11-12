import { exportQuickCards } from "@/src/server";

/** POST /api/cards/export — build one standalone .apkg from the queue. */
export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as { deckName?: unknown } | null;
	const deckName = typeof body?.deckName === "string" ? body.deckName : undefined;
	try {
		const details = exportQuickCards(deckName);
		return Response.json(details);
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "The deck could not be built.", code: "export_failed" },
			{ status: 422 },
		);
	}
}
