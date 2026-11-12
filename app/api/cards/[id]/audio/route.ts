import { stores } from "@/src/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	const clip = stores.cardStore.readCardMedia(id);
	if (!clip) return new Response("Not found", { status: 404 });
	return new Response(new Uint8Array(clip.data), {
		headers: {
			"Content-Type": clip.mime,
			"Content-Length": String(clip.data.length),
			"Cache-Control": "private, max-age=3600",
		},
	});
}
