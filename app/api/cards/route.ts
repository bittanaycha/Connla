import { isPronounceLanguage, type NewFlashcard } from "@/src/core";
import { createQuickCard, stores } from "@/src/server";

/**
 * GET  /api/cards — the quick-card queue, oldest first.
 * POST /api/cards — save one popup card (source audio is generated server-side).
 *      {kind, front, back, note?, language, target?, source} → 201 {card, warning}
 *      duplicate content → 200 {card, duplicate: true}
 */
export async function GET() {
	return Response.json({ cards: stores.cardStore.listCards() });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return Response.json({ error: "Invalid JSON.", code: "bad_request" }, { status: 400 });

	const language =
		typeof body.language === "string" && isPronounceLanguage(body.language) ? body.language : "en";
	const target =
		typeof body.target === "string" && isPronounceLanguage(body.target) ? body.target : null;
	const input: Omit<NewFlashcard, "audio"> = {
		kind: body.kind === "explanation" ? "explanation" : "translation",
		front: typeof body.front === "string" ? body.front : "",
		back: typeof body.back === "string" ? body.back : "",
		note: typeof body.note === "string" ? body.note : "",
		language,
		target,
		source: body.source as NewFlashcard["source"],
	};

	try {
		const result = await createQuickCard(input);
		return Response.json(result, { status: result.duplicate ? 200 : 201 });
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "The card could not be saved.", code: "invalid_card" },
			{ status: 422 },
		);
	}
}
