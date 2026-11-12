/**
 * Azure Speech — the official text-to-speech path (audio rethink, 2026-11-12).
 *
 * Edge Read Aloud is the consumer endpoint with a five-minute token window;
 * a deck-sized batch of clips can exhaust it. Azure Speech is the same neural
 * voice catalog behind an official key: `cy-GB-NiaNeural` for Welsh, no
 * client-token dance, and a free monthly character allowance. This module
 * speaks only the REST API; the provider chain in ./tts.ts decides when to
 * use it and when to fall back to Edge.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { TTS_CACHE_DIR } from "../../config.ts";
import { EDGE_VOICES, PRONOUNCE_BCP47, type PronounceLanguage } from "../core/pronounce.ts";
import { keyValue } from "./keys.ts";

const AZURE_ENDPOINT_SUFFIX = "tts.speech.microsoft.com/cognitiveservices/v1";
const CACHE_VERSION = "azure-v1-1";
const REGION_PATTERN = /^[a-z0-9-]{2,32}$/;
const REQUEST_TIMEOUT_MS = 30_000;

export type AzureSpeechErrorCode = "not_configured" | "unauthorized" | "rate_limited" | "no_voice" | "failed";

export class AzureSpeechError extends Error {
	constructor(
		message: string,
		readonly code: AzureSpeechErrorCode,
		readonly status?: number,
	) {
		super(message);
		this.name = "AzureSpeechError";
	}
}

function azureKey(): string | undefined {
	const value = keyValue("AZURE_SPEECH_KEY")?.trim();
	return value || undefined;
}

function azureRegion(): string | undefined {
	const value = keyValue("AZURE_SPEECH_REGION")?.trim().toLowerCase();
	return value && REGION_PATTERN.test(value) ? value : undefined;
}

/** Both halves are required; a key without a region is not a usable provider. */
export function hasAzureSpeech(): boolean {
	return Boolean(azureKey() && azureRegion());
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function ssml(text: string, language: PronounceLanguage, voice: string): string {
	const lang = PRONOUNCE_BCP47[language];
	return (
		`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
		`<voice name='${voice}'><prosody rate='+0%' pitch='+0Hz'>${escapeXml(text)}</prosody></voice></speak>`
	);
}

function cacheFile(language: PronounceLanguage, text: string, voice: string): string {
	const digest = createHash("sha256")
		.update(`${CACHE_VERSION}\0${voice}\0${text}`)
		.digest("hex");
	return path.join(TTS_CACHE_DIR, `azure-${language}`, `${digest}.mp3`);
}

function errorForStatus(status: number, body: string): AzureSpeechError {
	const detail = body.replace(/\s+/g, " ").trim().slice(0, 200);
	if (status === 401 || status === 403) {
		return new AzureSpeechError(
			`Azure Speech rejected the key${detail ? `: ${detail}` : "."}`,
			"unauthorized",
			status,
		);
	}
	if (status === 429) {
		return new AzureSpeechError("Azure Speech rate-limited the request.", "rate_limited", status);
	}
	return new AzureSpeechError(`Azure Speech failed (${status})${detail ? `: ${detail}` : "."}`, "failed", status);
}

/**
 * Synthesize one clip. The cache is per voice + text and lives beside the
 * Edge cache, so retries and repeat exports are free.
 */
export async function synthesizeAzure(
	text: string,
	language: PronounceLanguage,
	signal?: AbortSignal,
): Promise<{ audio: Buffer; voice: string }> {
	const voice = EDGE_VOICES[language];
	if (!voice) throw new AzureSpeechError(`Azure Speech has no voice mapped for ${language}.`, "no_voice");
	const key = azureKey();
	const region = azureRegion();
	if (!key || !region) {
		throw new AzureSpeechError("Azure Speech is not configured (key and region are both required).", "not_configured");
	}

	const file = cacheFile(language, text, voice);
	try {
		const cached = fs.readFileSync(/* turbopackIgnore: true */ file);
		if (cached.length) return { audio: cached, voice };
	} catch {
		// cache miss
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const response = await fetch(`https://${region}.${AZURE_ENDPOINT_SUFFIX}`, {
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": key,
				"Content-Type": "application/ssml+xml",
				"X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
				"User-Agent": "Connla/1.0",
			},
			body: ssml(text, language, voice),
			signal: controller.signal,
		});
		if (!response.ok) {
			throw errorForStatus(response.status, await response.text().catch(() => ""));
		}
		const audio = Buffer.from(await response.arrayBuffer());
		if (!audio.length) throw new AzureSpeechError("Azure Speech returned no audio.", "failed");
		try {
			fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
			const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
			fs.writeFileSync(/* turbopackIgnore: true */ tmp, audio);
			fs.renameSync(/* turbopackIgnore: true */ tmp, file);
		} catch {
			// A cache write failure must not fail the clip.
		}
		return { audio, voice };
	} catch (error) {
		if (controller.signal.aborted && !signal?.aborted) {
			throw new AzureSpeechError("Azure Speech timed out.", "failed");
		}
		throw error;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}
