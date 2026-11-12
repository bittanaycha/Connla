/**
 * One speech entry point (audio rethink, 2026-11-12).
 *
 * Azure Speech is the reliable path when its key and region are configured;
 * Edge Read Aloud stays as the no-key fallback. The live Listen button and
 * the Anki audio job both come through here so a provider change applies to
 * both. The caller gets the bytes plus which provider actually spoke.
 */

import type { PronounceLanguage } from "../core/pronounce.ts";
import { synthesizeAzure, hasAzureSpeech, AzureSpeechError } from "./azure-tts.ts";
import { synthesizeEdge } from "./edge-tts.ts";

export type SpeechProvider = "azure" | "edge";

export interface SpeechResult {
	audio: Buffer;
	mime: "audio/mpeg";
	provider: SpeechProvider;
	/** Set when Azure was configured but the clip came from Edge. */
	fallbackReason?: string;
}

export class SpeechError extends Error {
	constructor(
		message: string,
		readonly code: "no_voice" | "failed",
	) {
		super(message);
		this.name = "SpeechError";
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * A rejected Azure key should not cost every later clip a failed round trip.
 * A 401/403 is treated as a provider outage for ten minutes; a 429 is left
 * alone because it may recover immediately.
 */
let azureCooldownUntil = 0;

function azurePaused(): boolean {
	return Date.now() < azureCooldownUntil;
}

export async function synthesizeSpeech(
	text: string,
	language: PronounceLanguage,
	signal?: AbortSignal,
): Promise<SpeechResult> {
	let azureFailure: unknown;
	if (hasAzureSpeech() && !azurePaused()) {
		try {
			const { audio } = await synthesizeAzure(text, language, signal);
			return { audio, mime: "audio/mpeg", provider: "azure" };
		} catch (error) {
			azureFailure = error;
			if (error instanceof AzureSpeechError && error.code === "unauthorized") {
				azureCooldownUntil = Date.now() + 10 * 60_000;
			}
		}
	}
	try {
		const { audio } = await synthesizeEdge(text, language);
		return {
			audio,
			mime: "audio/mpeg",
			provider: "edge",
			...(azureFailure ? { fallbackReason: messageOf(azureFailure) } : {}),
		};
	} catch (error) {
		const edgeMessage = messageOf(error);
		if (edgeMessage.startsWith("no_voice:")) {
			throw new SpeechError(`No speech voice is available for ${language}.`, "no_voice");
		}
		const azureMessage = azureFailure ? `Azure: ${messageOf(azureFailure)}. ` : "";
		throw new SpeechError(`${azureMessage}Edge: ${edgeMessage}`, "failed");
	}
}
