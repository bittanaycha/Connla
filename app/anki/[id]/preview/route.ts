import fs from "node:fs";
import path from "node:path";
import { ankiExportDir } from "@/src/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	const dir = ankiExportDir(id);
	if (!dir) return new Response("Not found", { status: 404 });
	let html: string;
	try {
		html = fs.readFileSync(path.join(dir, "preview.html"), "utf-8");
	} catch {
		return new Response("Not found", { status: 404 });
	}
	return new Response(html, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Security-Policy": "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
