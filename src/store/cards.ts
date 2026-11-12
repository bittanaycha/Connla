/**
 * CardStore — fs adapter for the quick-card queue (Anki wave).
 *
 * One JSONL list (config.CARDS_FILE) plus source-language audio under
 * config.CARDS_MEDIA_DIR. Read-modify-write like the library records: a
 * send/delete removes the row and its clip, never a ledger append.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { CARDS_FILE, CARDS_MEDIA_DIR } from "../../config.ts";
import {
	MAX_CARD_AUDIO_BYTES,
	normalizeNewFlashcard,
	type CardStore,
	type FlashcardRecord,
	type NewFlashcard,
} from "../core/cards.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

function readList(): FlashcardRecord[] {
	let text: string;
	try {
		text = fs.readFileSync(CARDS_FILE, "utf-8");
	} catch {
		return [];
	}
	const rows: FlashcardRecord[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			rows.push(JSON.parse(trimmed) as FlashcardRecord);
		} catch {
			// A corrupt line is skipped; the next write drops it.
		}
	}
	return rows;
}

function writeList(rows: FlashcardRecord[]): void {
	fs.mkdirSync(path.dirname(CARDS_FILE), { recursive: true });
	const text = rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
	writeFileAtomicSync(CARDS_FILE, text);
}

function newId(): string {
	return `fc_${randomBytes(8).toString("hex")}`;
}

function mediaPath(file: string): string {
	return path.join(CARDS_MEDIA_DIR, path.basename(file));
}

export function createCardStore(): CardStore {
	return {
		listCards: () => readList(),

		getCard(id) {
			return readList().find((card) => card.id === id) ?? null;
		},

		addCard(input: NewFlashcard): FlashcardRecord {
			const clean = normalizeNewFlashcard(input);
			const id = newId();
			const createdAt = new Date().toISOString();
			let audio: FlashcardRecord["audio"] = null;
			if (clean.audio && clean.audio.data.length > 0) {
				if (clean.audio.data.length > MAX_CARD_AUDIO_BYTES) throw new Error("The card audio is too large.");
				const file = `${id}.mp3`;
				fs.mkdirSync(CARDS_MEDIA_DIR, { recursive: true });
				fs.writeFileSync(mediaPath(file), clean.audio.data);
				audio = { text: clean.audio.text, language: clean.audio.language, file };
			}
			const record: FlashcardRecord = {
				id,
				kind: clean.kind,
				front: clean.front,
				back: clean.back,
				note: clean.note ?? "",
				language: clean.language,
				target: clean.target ?? null,
				audio,
				source: clean.source,
				createdAt,
			};
			const rows = readList();
			rows.push(record);
			try {
				writeList(rows);
			} catch (error) {
				if (audio) fs.rmSync(mediaPath(audio.file), { force: true });
				throw error;
			}
			return record;
		},

		deleteCard(id: string): boolean {
			const rows = readList();
			const found = rows.find((card) => card.id === id);
			if (!found) return false;
			const kept = rows.filter((card) => card.id !== id);
			writeList(kept);
			if (found.audio) fs.rmSync(mediaPath(found.audio.file), { force: true });
			return true;
		},

		readCardMedia(id: string) {
			const card = readList().find((row) => row.id === id);
			if (!card?.audio) return null;
			try {
				const data = fs.readFileSync(mediaPath(card.audio.file));
				return { filename: card.audio.file, mime: "audio/mpeg" as const, data };
			} catch {
				return null;
			}
		},
	};
}
