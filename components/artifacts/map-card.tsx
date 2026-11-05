"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, FileCode2Icon, ImageDownIcon, MaximizeIcon } from "lucide-react";
import { useSessionMermaid } from "@/components/session-overlay";
import { downloadFile, slugFilename } from "./download";
import { SvgImage, svgImageSource } from "./svg-image";
import type { ArtifactPartProps, MapDetails } from "@/src/core";

/**
 * Map artifact card: the synchronous `map` tool's details payload, drawn as
 * an inline image. The SVG never joins the app DOM. PNG export runs in the
 * renderer so the card can also copy a shareable image; the SVG is the
 * lossless download.
 */
export function MapCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	const details = part.output as Partial<MapDetails> | undefined;
	if (
		!details ||
		typeof details.svg !== "string" ||
		!details.svg.includes("<svg") ||
		typeof details.width !== "number" ||
		typeof details.height !== "number" ||
		details.width <= 0 ||
		details.height <= 0
	) {
		return (
			<div className="my-4 rounded-xl border bg-card p-4 text-sm text-muted-foreground" data-testid="map-card-failed">
				Map completed, but the drawing could not be displayed.
			</div>
		);
	}
	return <MapFigure details={details as MapDetails} />;
}

function MapFigure({ details }: { details: MapDetails }) {
	const overlay = useSessionMermaid();
	const [busy, setBusy] = useState<"png" | "copy" | null>(null);
	const [copied, setCopied] = useState(false);
	const title = details.title || "Map";
	const stem = slugFilename(title);

	const exportPng = async (): Promise<Blob> => {
		const image = new Image();
		image.decoding = "async";
		const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgImageSource(details.svg))}`;
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("The map could not be rasterized."));
			image.src = source;
		});
		const scale = 2;
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(details.width * scale);
		canvas.height = Math.round(details.height * scale);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas is unavailable.");
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		if (!blob) throw new Error("PNG export failed.");
		return blob;
	};

	const downloadPng = async () => {
		if (busy) return;
		setBusy("png");
		try {
			const blob = await exportPng();
			downloadFile(`${stem}.png`, new Uint8Array(await blob.arrayBuffer()), "image/png");
		} catch {
			// The SVG download remains available if rasterizing fails.
		} finally {
			setBusy(null);
		}
	};

	const copyPng = async () => {
		if (busy) return;
		setBusy("copy");
		try {
			const blob = await exportPng();
			if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("Clipboard images are unavailable.");
			await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1800);
		} catch {
			setCopied(false);
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="my-4 w-full" data-testid="map-card">
			<div className="w-full overflow-hidden rounded-lg bg-[#f4ecd9]" data-testid="map-svg">
				<SvgImage svg={details.svg} className="block h-auto w-full" width={details.width} alt={title} />
			</div>
			<div className="mt-2 flex items-center justify-between gap-2">
				<div className="text-xs font-medium font-ui uppercase tracking-wide text-muted-foreground">Map</div>
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						aria-label="Download map as PNG"
						title={busy === "png" ? "Rendering PNG…" : "Download as PNG"}
						onClick={() => void downloadPng()}
						disabled={busy !== null}
						data-testid="map-download-png"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
					>
						<ImageDownIcon className="size-3.5" />
					</button>
					<button
						type="button"
						aria-label="Copy map as image"
						title={copied ? "Copied" : "Copy image"}
						onClick={() => void copyPng()}
						disabled={busy !== null}
						data-testid="map-copy"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
					>
						{copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
					</button>
					<button
						type="button"
						aria-label="Download map as SVG"
						title="Download as SVG"
						onClick={() => downloadFile(`${stem}.svg`, details.svg, "image/svg+xml")}
						data-testid="map-download-svg"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<FileCode2Icon className="size-3.5" />
					</button>
					{overlay && (
						<button
							type="button"
							aria-label="Open map fullscreen"
							title="Open fullscreen"
							onClick={() => overlay.openFigure(details.svg, false)}
							data-testid="map-open"
							className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<MaximizeIcon className="size-3.5" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
