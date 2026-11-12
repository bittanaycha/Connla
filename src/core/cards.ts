/**
 * Quick cards — the selection-popup captures that wait for Anki (Anki wave).
 *
 * A saved card is deliberately small: front, back, an optional one-line
 * note, provenance, and optional source-language audio. Translation cards
 * play the source side; explanation cards are text only. These records live
 * in the learner's card queue until AnkiConnect sends them, or until they
 * are exported as a standalone .apkg.
 */

import { isPronounceLanguage, type PronounceLanguage } from "./pronounce.ts";
import {
	MAX_TRANSLATE_CHARS,
	MAX_TRANSLATION_NOTE_CHARS,
	cleanMultiline,
	cleanText,
	normalizeLanguage,
	sanitizeSource,
	type LibrarySource,
} from "./library.ts";

export const MAX_CARD_FRONT_CHARS = MAX_TRANSLATE_CHARS;
export const MAX_CARD_BACK_CHARS = 4000;
export const MAX_CARD_NOTE_CHARS = MAX_TRANSLATION_NOTE_CHARS;
export const MAX_EXPLANATION_CHARS = 4000;
export const MAX_CARD_AUDIO_BYTES = 5 * 1024 * 1024;

export type FlashcardKind = "translation" | "explanation";

export interface FlashcardAudio {
	/** The text the clip speaks (the source side for a translation card). */
	text: string;
	language: PronounceLanguage;
	/** File name under config.CARDS_MEDIA_DIR, e.g. "fc_…​.mp3". */
	file: string;
}

export interface FlashcardRecord {
	id: string;
	kind: FlashcardKind;
	front: string;
	back: string;
	/** Optional one-line grammar/idiom note from the generator. */
	note: string;
	language: PronounceLanguage;
	/** Target language for a translation card; null on an explanation card. */
	target: PronounceLanguage | null;
	audio: FlashcardAudio | null;
	source: LibrarySource;
	createdAt: string;
}

export interface NewFlashcard {
	kind: FlashcardKind;
	front: string;
	back: string;
	note?: string;
	language: PronounceLanguage;
	target?: PronounceLanguage | null;
	source: LibrarySource;
	/** Optional source-language audio bytes; the adapter stores the file. */
	audio?: { text: string; language: PronounceLanguage; data: Uint8Array };
}

export interface CardStore {
	listCards(): FlashcardRecord[];
	getCard(id: string): FlashcardRecord | null;
	addCard(input: NewFlashcard): FlashcardRecord;
	deleteCard(id: string): boolean;
	/** The stored audio file, or null when the card has no clip. */
	readCardMedia(id: string): { filename: string; mime: "audio/mpeg"; data: Uint8Array } | null;
}

/** The dedupe identity for a popup capture: same content, same queue row. */
export function flashcardKey(kind: FlashcardKind, front: string, back: string): string {
	return `${kind}\u001f${front.trim()}\u001f${back.trim()}`;
}

/** Validate/fill a quick-card request. Throws with a model-readable problem. */
export function normalizeNewFlashcard(input: NewFlashcard): NewFlashcard {
	const front = cleanMultiline(input.front, MAX_CARD_FRONT_CHARS);
	const back = cleanMultiline(input.back, MAX_CARD_BACK_CHARS);
	if (!front) throw new Error("The card front is empty.");
	if (!back) throw new Error("The card back is empty.");
	if (input.kind !== "translation" && input.kind !== "explanation") {
		throw new Error("The card kind must be translation or explanation.");
	}
	if (input.audio && input.audio.data.length > MAX_CARD_AUDIO_BYTES) {
		throw new Error("The card audio is too large.");
	}
	return {
		kind: input.kind,
		front,
		back,
		note: cleanText(input.note ?? "", MAX_CARD_NOTE_CHARS),
		language: normalizeLanguage(input.language),
		target: input.kind === "translation" ? normalizeLanguage(input.target ?? "en") : null,
		source: sanitizeSource(input.source),
		...(input.audio
			? {
					audio: {
						text: cleanText(input.audio.text, MAX_CARD_FRONT_CHARS),
						language: isPronounceLanguage(input.audio.language)
							? input.audio.language
							: normalizeLanguage(input.language),
						data: input.audio.data,
					},
				}
			: {}),
	};
}

/** A short status line for the card row and the popup toast. */
export function flashcardKindLabel(kind: FlashcardKind): string {
	return kind === "translation" ? "Translation" : "Explanation";
}

/** Parse the strict-JSON explanation answer; null when it is not usable. */
export function parseGeneratedExplanation(raw: string): string | null {
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.slice(start, end + 1));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const explanation = cleanMultiline((parsed as Record<string, unknown>).explanation, MAX_EXPLANATION_CHARS);
	return explanation || null;
}
