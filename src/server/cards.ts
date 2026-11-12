/**
 * Quick-card services (Anki wave): the queue operations behind the popup
 * and the Library → Cards tab. The popup creates a card (with source-side
 * audio when that language has an Edge voice), then either sends it to a
 * running Anki through AnkiConnect or leaves it queued.
 */

import {
	ANKI_MAX_DECK_CHARS,
	type AnkiExportDetails,
	type AnkiMediaFile,
} from "../core/anki.ts";
import {
	flashcardKey,
	normalizeNewFlashcard,
	type FlashcardRecord,
	type NewFlashcard,
} from "../core/cards.ts";
import { hasEdgeVoice } from "../core/pronounce.ts";
import { synthesizeEdge } from "./edge-tts.ts";
import { sendQuickCard, AnkiConnectError, quickCardNoteType } from "./anki-connect.ts";
import { writeAnkiExport } from "./anki.ts";
import { stores } from "./stores.ts";

const MAX_SPOKEN_FRONT_CHARS = 1200;

function cleanDeckName(name: string | undefined): string {
	return (name ?? "").trim().slice(0, ANKI_MAX_DECK_CHARS) || "Connla Cards";
}

export interface CreatedQuickCard {
	card: FlashcardRecord;
	duplicate: boolean;
	warning: string | null;
}

/** Save one popup card; translation cards also get a clip of the source side. */
export async function createQuickCard(input: Omit<NewFlashcard, "audio">): Promise<CreatedQuickCard> {
	const clean = normalizeNewFlashcard({ ...input, audio: undefined });
	const existingKey = flashcardKey(clean.kind, clean.front, clean.back);
	const existing = stores.cardStore.listCards().find(
		(card) => flashcardKey(card.kind, card.front, card.back) === existingKey,
	);
	if (existing) return { card: existing, duplicate: true, warning: null };

	let warning: string | null = null;
	let audio: NewFlashcard["audio"];
	if (clean.kind === "translation") {
		if (!hasEdgeVoice(clean.language)) {
			warning = "No audio voice is available for this language; the card was saved without a clip.";
		} else if (clean.front.length > MAX_SPOKEN_FRONT_CHARS) {
			warning = "The selected text is too long for audio; the card was saved without a clip.";
		} else {
			try {
				const synthesized = await synthesizeEdge(clean.front, clean.language);
				audio = { text: clean.front, language: clean.language, data: synthesized.audio };
			} catch {
				warning = "The audio could not be generated; the card was saved without a clip.";
			}
		}
	}
	const card = stores.cardStore.addCard({ ...clean, audio });
	return { card, duplicate: false, warning };
}

/** Build and store a standalone .apkg from the queue. */
export function exportQuickCards(deckName?: string): AnkiExportDetails {
	const cards = stores.cardStore.listCards();
	if (!cards.length) throw new Error("There are no cards to export.");
	const noteType = quickCardNoteType();
	const media: AnkiMediaFile[] = [];
	const notes = cards.map((card) => {
		let audioField = "";
		const clip = stores.cardStore.readCardMedia(card.id);
		if (clip) {
			media.push({ filename: clip.filename, data: clip.data, mime: "audio/mpeg" });
			audioField = `[sound:${clip.filename}]`;
		}
		return {
			fields: { Front: card.front, Back: card.back, Note: card.note, Audio: audioField },
			tags: ["connla", card.kind],
			guid: card.id,
		};
	});
	return writeAnkiExport({ name: cleanDeckName(deckName), noteType, cards: notes }, media);
}

export interface CardSendFailure {
	id: string;
	front: string;
	error: string;
}

export interface CardSendResult {
	sent: number;
	failed: CardSendFailure[];
	unavailable: boolean;
}

/** Send queued cards to Anki; successful rows leave the queue. */
export async function sendQueuedCards(deckName: string | undefined, ids?: string[]): Promise<CardSendResult> {
	const all = stores.cardStore.listCards();
	const wanted = ids?.length ? new Set(ids) : null;
	const cards = wanted ? all.filter((card) => wanted.has(card.id)) : all;
	if (!cards.length) throw new Error("There are no cards to send.");
	const deck = cleanDeckName(deckName);
	const failed: CardSendFailure[] = [];
	let sent = 0;
	let unavailable = false;
	for (const card of cards) {
		if (unavailable) {
			failed.push({ id: card.id, front: card.front, error: "AnkiConnect is not reachable." });
			continue;
		}
		const clip = stores.cardStore.readCardMedia(card.id);
		try {
			await sendQuickCard(card, deck, clip);
			stores.cardStore.deleteCard(card.id);
			sent += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : "The card could not be sent.";
			failed.push({ id: card.id, front: card.front, error: message });
			if (error instanceof AnkiConnectError && error.code === "unavailable") unavailable = true;
		}
	}
	return { sent, failed, unavailable };
}
