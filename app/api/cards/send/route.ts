import { sendQueuedCards } from "@/src/server";

/** POST /api/cards/send — send the queue (or selected ids) into running Anki. */
export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as
		| { deckName?: unknown; ids?: unknown }
		| null;
	const deckName = typeof body?.deckName === "string" ? body.deckName : undefined;
	const ids = Array.isArray(body?.ids)
		? body.ids.filter((id): id is string => typeof id === "string")
		: undefined;
	try {
		const result = await sendQueuedCards(deckName, ids);
		return Response.json(result, { status: result.unavailable && result.sent === 0 ? 503 : 200 });
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "The cards could not be sent.", code: "send_failed" },
			{ status: 422 },
		);
	}
}
