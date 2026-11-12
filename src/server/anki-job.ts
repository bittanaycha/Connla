/**
 * Background Anki export (audio rethink, 2026-11-12).
 *
 * A deck can carry dozens of synthesized clips; doing that inside the
 * `export_anki` tool call made one slow or rate-limited clip fail the whole
 * lesson turn. The tool now starts this job and returns immediately. The job
 * walks the media requests, caches each clip, records progress in
 * `data/anki/<id>/job.json`, and finishes the .apkg even when a clip cannot
 * be produced.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
	ankiCardCount,
	ankiDeckProblems,
	normalizeAnkiDeck,
	renderAnkiPreviewHtml,
	sanitizeAnkiMediaName,
	type AnkiDeck,
	type AnkiExportDetails,
	type AnkiJobStatus,
	type AnkiMediaFile,
	type AnkiMediaRequest,
} from "../core/anki.ts";
import { PATHS } from "../../config.ts";
import { buildAnkiPackage, ankiExportDir } from "./anki.ts";
import { synthesizeSpeech } from "./tts.ts";
import { hasAzureSpeech } from "./azure-tts.ts";
import { resolveSourcePath } from "../agent/tools/fs-shared.ts";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const STALE_JOB_MS = 120_000;
const MEDIA_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".oga": "audio/ogg",
	".wav": "audio/wav",
	".m4a": "audio/mp4",
};

const activeJobs = new Set<string>();

function statusUrls(id: string) {
	return {
		statusUrl: `/anki/${id}/status`,
		downloadUrl: `/anki/${id}/download`,
		previewUrl: `/anki/${id}/preview`,
	};
}

function atomicJson(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
	fs.renameSync(tmp, file);
}

function writeStatus(dir: string, status: AnkiJobStatus): void {
	atomicJson(path.join(dir, "job.json"), status);
}

function initialStatus(id: string, deck: AnkiDeck, mediaTotal: number): AnkiJobStatus {
	return {
		state: "running",
		deckName: deck.name,
		noteCount: deck.cards.length,
		cardCount: ankiCardCount(deck),
		mediaTotal,
		mediaCompleted: 0,
		mediaCount: 0,
		warnings: [],
		updatedAt: Date.now(),
		...statusUrls(id),
	};
}

function mediaMime(name: string): string {
	return MEDIA_MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

function speechName(request: Extract<AnkiMediaRequest, { kind: "speech" }>, index: number): string {
	const raw = request.name?.trim() || `tts-${index + 1}.mp3`;
	const stem = raw.replace(/\.[^./\\]+$/, "");
	return sanitizeAnkiMediaName(`${stem || "tts"}.mp3`);
}

function readFileMedia(request: Extract<AnkiMediaRequest, { kind: "file" }>): AnkiMediaFile {
	const absolute = resolveSourcePath(request.path);
	const stat = fs.statSync(/* turbopackIgnore: true */ absolute, { throwIfNoEntry: false });
	if (!stat?.isFile()) throw new Error(`Media file not found: ${request.path}`);
	if (stat.size > MAX_MEDIA_BYTES) {
		throw new Error(`Media file is larger than ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)} MB: ${request.path}`);
	}
	const ext = path.extname(absolute).toLowerCase();
	if (!MEDIA_MIME[ext]) {
		throw new Error(`Unsupported media type “${ext}”. Use png, jpg, gif, webp, svg, mp3, ogg, wav, or m4a.`);
	}
	const rawName = request.name?.trim() || path.basename(absolute);
	const stem = rawName.replace(/\.[^./\\]+$/, "");
	const filename = sanitizeAnkiMediaName(`${stem || "media"}${ext}`);
	return {
		filename,
		data: fs.readFileSync(/* turbopackIgnore: true */ absolute),
		mime: MEDIA_MIME[ext]!,
	};
}

function fileNameFor(request: Extract<AnkiMediaRequest, { kind: "file" }>): string {
	const ext = path.extname(request.path).toLowerCase();
	const raw = request.name?.trim() || path.basename(request.path);
	const stem = raw.replace(/\.[^./\\]+$/, "");
	return sanitizeAnkiMediaName(`${stem || "media"}${ext}`);
}

function stripMissingReferences(deck: AnkiDeck, names: Set<string>): AnkiDeck {
	if (!names.size) return deck;
	const escaped = [...names].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const sound = new RegExp(`\\[sound:(?:${escaped.join("|")})\\]`, "gi");
	const image = new RegExp(`<img\\b[^>]*\\bsrc=["'](?:${escaped.join("|")})["'][^>]*>`, "gi");
	return {
		...deck,
		cards: deck.cards.map((card) => ({
			...card,
			fields: Object.fromEntries(
				Object.entries(card.fields).map(([field, value]) => [field, value.replace(sound, "").replace(image, "")]),
			),
		})),
	};
}

function labelFor(request: AnkiMediaRequest): string {
	if (request.kind === "file") return path.basename(request.path);
	return request.text.length > 40 ? `${request.text.slice(0, 40)}…` : request.text;
}

async function runJob(id: string, deck: AnkiDeck, requests: AnkiMediaRequest[]): Promise<void> {
	const dir = ankiExportDir(id);
	if (!dir) return;
	const status = initialStatus(id, deck, requests.length);
	writeStatus(dir, status);
	const warnings: string[] = status.warnings;
	if (requests.some((request) => request.kind === "speech") && !hasAzureSpeech()) {
		warnings.push("Azure Speech is not configured; audio uses Edge and may hit its rate limit.");
	}
	const missing = new Set<string>();
	const media: AnkiMediaFile[] = [];
	try {
		for (const [index, request] of requests.entries()) {
			status.current = labelFor(request);
			writeStatus(dir, status);
			try {
				if (request.kind === "file") {
					const name = fileNameFor(request);
					try {
						media.push(readFileMedia(request));
					} catch (error) {
						missing.add(name);
						throw error;
					}
				} else {
					const name = speechName(request, index);
					try {
						const speech = await synthesizeSpeech(request.text, request.language);
						media.push({ filename: name, data: speech.audio, mime: speech.mime });
						if (speech.fallbackReason && !warnings.some((warning) => warning.startsWith("Azure Speech was unavailable"))) {
							warnings.push(`Azure Speech was unavailable; “${labelFor(request)}” used Edge instead.`);
						}
					} catch (error) {
						missing.add(name);
						throw error;
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				warnings.push(`Could not generate “${labelFor(request)}”: ${message}`);
			}
			status.mediaCompleted = index + 1;
			status.warnings = [...warnings];
			writeStatus(dir, status);
		}

		const output = stripMissingReferences(deck, missing);
		const built = buildAnkiPackage(output, media);
		fs.writeFileSync(path.join(dir, "deck.apkg"), built.data);
		const mediaMap = new Map<string, { mime: string; data: Uint8Array }>();
		for (const item of media) mediaMap.set(item.filename, { mime: item.mime ?? mediaMime(item.filename), data: item.data });
		fs.writeFileSync(path.join(dir, "preview.html"), renderAnkiPreviewHtml(output, mediaMap), "utf-8");
		fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ deckName: deck.name }), "utf-8");
		writeStatus(dir, {
			...status,
			state: "done",
			current: undefined,
			mediaCompleted: requests.length,
			mediaCount: built.mediaNames.length,
			noteCount: built.noteCount,
			cardCount: built.cardCount,
			warnings: [...warnings],
			updatedAt: Date.now(),
		});
	} catch (error) {
		writeStatus(dir, {
			...status,
			state: "error",
			error: error instanceof Error ? error.message : String(error),
			warnings: [...warnings],
			updatedAt: Date.now(),
		});
	} finally {
		activeJobs.delete(id);
	}
}

/** Start one deck build; returns before any audio work happens. */
export function startAnkiExport(deck: AnkiDeck, requests: AnkiMediaRequest[]): AnkiExportDetails {
	const normalized = normalizeAnkiDeck(deck);
	const problems = ankiDeckProblems(normalized);
	if (problems.length) throw new Error(`The deck input is invalid:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
	const id = crypto.randomBytes(8).toString("hex");
	const dir = ankiExportDir(id);
	if (!dir) throw new Error("Could not allocate an export id.");
	fs.mkdirSync(dir, { recursive: true });
	activeJobs.add(id);
	void runJob(id, normalized, requests).catch((error) => {
		try {
			writeStatus(dir, {
				...initialStatus(id, normalized, requests.length),
				state: "error",
				error: error instanceof Error ? error.message : String(error),
				updatedAt: Date.now(),
			});
		} catch {
			// The job directory is gone; nothing left to report to.
		}
		activeJobs.delete(id);
	});
	const urls = statusUrls(id);
	return {
		deckName: normalized.name,
		noteType: normalized.noteType.name,
		noteCount: normalized.cards.length,
		cardCount: ankiCardCount(normalized),
		mediaCount: 0,
		state: "running",
		jobId: id,
		warnings: [],
		...urls,
	};
}

/** Read the persisted job state; a job that died with the server becomes an error. */
export function readAnkiJobStatus(id: string): AnkiJobStatus | null {
	const dir = ankiExportDir(id);
	if (!dir) return null;
	let status: AnkiJobStatus;
	try {
		status = JSON.parse(fs.readFileSync(path.join(dir, "job.json"), "utf-8")) as AnkiJobStatus;
	} catch {
		return null;
	}
	if (status.state === "running" && !activeJobs.has(id) && Date.now() - status.updatedAt > STALE_JOB_MS) {
		return { ...status, state: "error", error: "The export was interrupted before it finished. Run export_anki again." };
	}
	return status;
}
