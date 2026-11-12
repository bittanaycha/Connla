"use client";

import { DownloadIcon, ExternalLinkIcon, LayersIcon } from "lucide-react";
import type { AnkiExportDetails, ArtifactPartProps } from "@/src/core";

/**
 * Anki deck artifact: the `export_anki` tool's details, rendered as a
 * download card plus the sandboxed preview of every card. The preview is a
 * separate same-origin document, so the deck CSS cannot leak into the app.
 */
export function AnkiCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	const details = part.output as Partial<AnkiExportDetails> | undefined;
	if (
		!details ||
		typeof details.deckName !== "string" ||
		typeof details.downloadUrl !== "string" ||
		typeof details.previewUrl !== "string"
	) {
		return (
			<div className="my-4 rounded-xl border bg-card p-4 text-sm text-muted-foreground" data-testid="anki-card-failed">
				The deck was built, but its download could not be displayed.
			</div>
		);
	}
	const noteCount = typeof details.noteCount === "number" ? details.noteCount : 0;
	const cardCount = typeof details.cardCount === "number" ? details.cardCount : 0;
	const mediaCount = typeof details.mediaCount === "number" ? details.mediaCount : 0;

	return (
		<div className="my-4 overflow-hidden rounded-xl border bg-card" data-testid="anki-card">
			<div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
					<LayersIcon className="size-4 text-muted-foreground" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium">{details.deckName}</div>
					<div className="text-xs text-muted-foreground">
						{noteCount} note{noteCount === 1 ? "" : "s"} · {cardCount} card{cardCount === 1 ? "" : "s"}
						{mediaCount ? ` · ${mediaCount} media file${mediaCount === 1 ? "" : "s"}` : ""}
					</div>
				</div>
				<a
					href={details.downloadUrl}
					className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
					data-testid="anki-download"
				>
					<DownloadIcon className="size-3.5" />
					Download .apkg
				</a>
				<a
					href={details.previewUrl}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
				>
					<ExternalLinkIcon className="size-3.5" />
					Open preview
				</a>
			</div>
			<iframe
				src={details.previewUrl}
				title={`${details.deckName} preview`}
				sandbox=""
				className="h-[420px] w-full bg-white"
				data-testid="anki-preview"
			/>
			<div className="border-t px-4 py-2 text-xs text-muted-foreground">
				Import the .apkg into Anki. The note type and CSS travel with the deck.
			</div>
		</div>
	);
}
