import { stores } from "@/src/server";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	const deleted = stores.cardStore.deleteCard(id);
	if (!deleted) return Response.json({ error: "Card not found." }, { status: 404 });
	return Response.json({ ok: true });
}
