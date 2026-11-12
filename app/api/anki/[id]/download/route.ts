import fs from "node:fs";
import path from "node:path";
import { ankiExportDir } from "@/src/server";

function fileName(deckName: string): string {
	const base = deckName
		.normalize("NFKD")
		.replace(/[^\w.\- ]+/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.slice(0, 80);
	return `${base || "connla-deck"}.apkg`;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	const dir = ankiExportDir(id);
	if (!dir) return new Response("Not found", { status: 404 });
	let data: Buffer;
	try {
		data = fs.readFileSync(path.join(dir, "deck.apkg"));
	} catch {
		return new Response("Not found", { status: 404 });
	}
	let deckName = "connla-deck";
	try {
		const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf-8")) as { deckName?: unknown };
		if (typeof meta.deckName === "string") deckName = meta.deckName;
	} catch {
		// Keep the generic name.
	}
	return new Response(new Uint8Array(data), {
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Disposition": `attachment; filename="${fileName(deckName)}"`,
			"Cache-Control": "no-store",
		},
	});
}
