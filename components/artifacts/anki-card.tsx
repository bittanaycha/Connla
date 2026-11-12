"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon, DownloadIcon, ExternalLinkIcon, LayersIcon, Loader2Icon } from "lucide-react";
import type { AnkiExportDetails, AnkiJobStatus, ArtifactPartProps } from "@/src/core";

/**
 * Anki deck artifact: the `export_anki` tool's details, rendered as a
 * download card plus the sandboxed preview of every card. The export is a
 * background job, so a running deck polls its same-origin status document
 * and swaps in the package when it is ready.
 */
function browserUrl(url: string): string {
	return url.startsWith("/api/anki/") ? url.replace(/^\/api\/anki\//, "/anki/") : url;
}

function isDone(state: string | undefined): boolean {
	return state !== "running" && state !== "error";
}

export function AnkiCard({ part }: ArtifactPartProps) {
	const details = part.state === "output-available" ? (part.output as Partial<AnkiExportDetails> | undefined) : undefined;
	const [polled, setPolled] = useState<AnkiJobStatus | null>(null);
	const statusUrl = typeof details?.statusUrl === "string"
		? browserUrl(details.statusUrl)
		: typeof details?.jobId === "string"
			? `/anki/${details.jobId}/status`
			: null;
	const baseState = details?.state ?? "done";

	useEffect(() => {
		if (!statusUrl || isDone(baseState)) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = async (): Promise<void> => {
			try {
				const response = await fetch(statusUrl, { cache: "no-store" });
				if (response.ok) {
					const next = (await response.json()) as AnkiJobStatus;
					if (cancelled) return;
					setPolled(next);
					if (next.state === "running") timer = setTimeout(() => void poll(), 1200);
					return;
				}
			} catch {
				// Keep waiting; a transient status read must not fail the card.
			}
			if (!cancelled) timer = setTimeout(() => void poll(), 2000);
		};
		void poll();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [statusUrl, baseState]);

	if (!details || typeof details.deckName !== "string" || typeof details.downloadUrl !== "string" || typeof details.previewUrl !== "string") {
		return (
			<div className="my-4 rounded-xl border bg-card p-4 text-sm text-muted-foreground" data-testid="anki-card-failed">
				The deck was built, but its download could not be displayed.
			</div>
		);
	}

	const job = polled;
	const state = job?.state ?? details.state ?? "done";
	const done = state === "done";
	const failed = state === "error";
	const noteCount = job?.noteCount ?? details.noteCount ?? 0;
	const cardCount = job?.cardCount ?? details.cardCount ?? 0;
	const mediaCount = job?.mediaCount ?? details.mediaCount ?? 0;
	const warnings = job?.warnings ?? details.warnings ?? [];
	const mediaTotal = job?.mediaTotal ?? 0;
	const mediaCompleted = job?.mediaCompleted ?? 0;
	const downloadUrl = browserUrl(job?.downloadUrl ?? details.downloadUrl);
	const previewUrl = browserUrl(job?.previewUrl ?? details.previewUrl);

	return (
		<div className="my-4 overflow-hidden rounded-xl border bg-card" data-testid="anki-card">
			<div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
					{state === "running" ? (
						<Loader2Icon className="size-4 animate-spin text-muted-foreground" />
					) : (
						<LayersIcon className="size-4 text-muted-foreground" />
					)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium">{details.deckName}</div>
					<div className="text-xs text-muted-foreground">
						{noteCount} note{noteCount === 1 ? "" : "s"} · {cardCount} card{cardCount === 1 ? "" : "s"}
						{mediaCount ? ` · ${mediaCount} media file${mediaCount === 1 ? "" : "s"}` : ""}
						{state === "running" ? " · building…" : ""}
					</div>
				</div>
				{done ? (
					<>
						<a
							href={downloadUrl}
							className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
							data-testid="anki-download"
						>
							<DownloadIcon className="size-3.5" />
							Download .apkg
						</a>
						<a
							href={previewUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
						>
							<ExternalLinkIcon className="size-3.5" />
							Open preview
						</a>
					</>
				) : (
					<span className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground" data-testid="anki-pending">
						{failed ? "Export failed" : "Generating audio…"}
					</span>
				)}
			</div>

			{state === "running" && (
				<div className="border-b px-4 py-3" data-testid="anki-progress">
					<div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
						<span className="truncate">
							{job?.current ? `“${job.current}”` : mediaTotal ? "Preparing media…" : "Building the package…"}
						</span>
						{mediaTotal > 0 && (
							<span className="shrink-0 tabular-nums">
								{mediaCompleted}/{mediaTotal}
							</span>
						)}
					</div>
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-foreground/40 transition-[width]"
							style={{ width: mediaTotal ? `${Math.round((mediaCompleted / mediaTotal) * 100)}%` : "15%" }}
						/>
					</div>
					<p className="mt-2 text-[11px] text-muted-foreground">
						Audio is cached, so a retry is cheap. The deck downloads when every clip has been attempted.
					</p>
				</div>
			)}

			{failed && (
				<div className="border-b px-4 py-3 text-xs text-destructive" data-testid="anki-error">
					{job?.error ?? details.error ?? "The export was interrupted."}
				</div>
			)}

			{warnings.length > 0 && (
				<div className="border-b px-4 py-3" data-testid="anki-warnings">
					<div className="flex items-start gap-2 text-xs text-muted-foreground">
						<AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
						<div className="space-y-1">
							{warnings.map((warning, index) => (
								<p key={index}>{warning}</p>
							))}
						</div>
					</div>
				</div>
			)}

			{done && (
				<>
					<iframe
						src={previewUrl}
						title={`${details.deckName} preview`}
						sandbox=""
						className="h-[420px] w-full bg-white"
						data-testid="anki-preview"
					/>
					<div className="border-t px-4 py-2 text-xs text-muted-foreground">
						Import the .apkg into Anki. The note type and CSS travel with the deck.
					</div>
				</>
			)}
		</div>
	);
}
