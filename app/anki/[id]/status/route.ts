import { readAnkiJobStatus } from "@/src/server";

/** Same-origin status surface for the deck card; outside /api so the
 *  desktop guard does not require a capability header on iframe/poll GETs. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	const status = readAnkiJobStatus(id);
	if (!status) return new Response("Not found", { status: 404 });
	return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
