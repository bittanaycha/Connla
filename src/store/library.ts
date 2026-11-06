/**
 * LibraryStore — the fs adapter for the three library record lists
 * (library wave): glossary, saved highlights, reading list.
 *
 * Each file is JSONL of one list, READ-MODIFY-WRITE (not a ledger): an edit
 * replaces a line, a delete drops it. Writes go through the same atomic
 * helper as the chat files, so a crash leaves the previous list intact.
 * Absent file = empty list; a corrupt line is skipped (the next write
 * drops it), never thrown at a caller.
 *
 * The adapter owns normalization and id minting; the routes own dedupe
 * policy (they answer 200 with the existing record instead of a second).
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
	GLOSSARY_FILE,
	HIGHLIGHTS_FILE,
	READING_LIST_FILE,
} from "../../config.ts";
import type { LibraryStore } from "../core/ports.ts";
import {
	MAX_DEFINITION_CHARS,
	MAX_HIGHLIGHT_CHARS,
	MAX_PART_OF_SPEECH_CHARS,
	MAX_READING_AUTHOR_CHARS,
	MAX_READING_NOTE_CHARS,
	MAX_READING_TITLE_CHARS,
	MAX_READING_URL_CHARS,
	MAX_TERM_CHARS,
	cleanMultiline,
	cleanText,
	glossaryKey,
	normalizeLanguage,
	sanitizeSource,
	type GlossaryEntry,
	type GlossaryPatch,
	type HighlightEntry,
	type NewGlossaryEntry,
	type NewHighlightEntry,
	type NewReadingEntry,
	type ReadingItem,
	type ReadingPatch,
} from "../core/library.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

function readList<T>(file: string): T[] {
	let text: string;
	try {
		text = fs.readFileSync(file, "utf-8");
	} catch {
		return [];
	}
	const rows: T[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			rows.push(JSON.parse(trimmed) as T);
		} catch {
			// A malformed line must not take the whole list down.
		}
	}
	return rows;
}

function writeList<T>(file: string, rows: T[]): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const text = rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
	writeFileAtomicSync(file, text);
}

function newId(prefix: string): string {
	return `${prefix}_${randomBytes(8).toString("hex")}`;
}

const now = (): string => new Date().toISOString();

export function createLibraryStore(): LibraryStore {
	return {
		listGlossary: () => readList<GlossaryEntry>(GLOSSARY_FILE),

		findGlossary(term, language) {
			const key = glossaryKey(term, normalizeLanguage(language));
			return (
				readList<GlossaryEntry>(GLOSSARY_FILE).find(
					(entry) => glossaryKey(entry.term, entry.language) === key,
				) ?? null
			);
		},

		addGlossary(input: NewGlossaryEntry): GlossaryEntry {
			const term = cleanText(input.term, MAX_TERM_CHARS);
			const stamp = now();
			const entry: GlossaryEntry = {
				id: newId("gla"),
				term,
				form: cleanText(input.form, MAX_TERM_CHARS) || term,
				language: normalizeLanguage(input.language),
				partOfSpeech: cleanText(input.partOfSpeech, MAX_PART_OF_SPEECH_CHARS),
				definition: cleanText(input.definition, MAX_DEFINITION_CHARS),
				source: sanitizeSource(input.source),
				createdAt: stamp,
				updatedAt: stamp,
			};
			const rows = readList<GlossaryEntry>(GLOSSARY_FILE);
			rows.push(entry);
			writeList(GLOSSARY_FILE, rows);
			return entry;
		},

		updateGlossary(id: string, patch: GlossaryPatch): GlossaryEntry | null {
			const rows = readList<GlossaryEntry>(GLOSSARY_FILE);
			const index = rows.findIndex((entry) => entry.id === id);
			if (index === -1) return null;
			const current = rows[index]!;
			const next: GlossaryEntry = {
				...current,
				term: patch.term !== undefined ? cleanText(patch.term, MAX_TERM_CHARS) : current.term,
				partOfSpeech:
					patch.partOfSpeech !== undefined
						? cleanText(patch.partOfSpeech, MAX_PART_OF_SPEECH_CHARS)
						: current.partOfSpeech,
				definition:
					patch.definition !== undefined
						? cleanText(patch.definition, MAX_DEFINITION_CHARS)
						: current.definition,
				updatedAt: now(),
			};
			rows[index] = next;
			writeList(GLOSSARY_FILE, rows);
			return next;
		},

		deleteGlossary(id: string): boolean {
			const rows = readList<GlossaryEntry>(GLOSSARY_FILE);
			const kept = rows.filter((entry) => entry.id !== id);
			if (kept.length === rows.length) return false;
			writeList(GLOSSARY_FILE, kept);
			return true;
		},

		listHighlights: () => readList<HighlightEntry>(HIGHLIGHTS_FILE),

		addHighlight(input: NewHighlightEntry): HighlightEntry {
			const entry: HighlightEntry = {
				id: newId("hl"),
				text: cleanMultiline(input.text, MAX_HIGHLIGHT_CHARS),
				language: normalizeLanguage(input.language),
				source: sanitizeSource(input.source),
				createdAt: now(),
			};
			const rows = readList<HighlightEntry>(HIGHLIGHTS_FILE);
			rows.push(entry);
			writeList(HIGHLIGHTS_FILE, rows);
			return entry;
		},

		deleteHighlight(id: string): boolean {
			const rows = readList<HighlightEntry>(HIGHLIGHTS_FILE);
			const kept = rows.filter((entry) => entry.id !== id);
			if (kept.length === rows.length) return false;
			writeList(HIGHLIGHTS_FILE, kept);
			return true;
		},

		listReading: () => readList<ReadingItem>(READING_LIST_FILE),

		addReading(input: NewReadingEntry): ReadingItem {
			const stamp = now();
			const entry: ReadingItem = {
				id: newId("rd"),
				title: cleanText(input.title, MAX_READING_TITLE_CHARS),
				author: cleanText(input.author, MAX_READING_AUTHOR_CHARS),
				url: cleanText(input.url, MAX_READING_URL_CHARS),
				note: cleanMultiline(input.note, MAX_READING_NOTE_CHARS),
				source: sanitizeSource(input.source),
				createdAt: stamp,
				updatedAt: stamp,
			};
			const rows = readList<ReadingItem>(READING_LIST_FILE);
			rows.push(entry);
			writeList(READING_LIST_FILE, rows);
			return entry;
		},

		updateReading(id: string, patch: ReadingPatch): ReadingItem | null {
			const rows = readList<ReadingItem>(READING_LIST_FILE);
			const index = rows.findIndex((entry) => entry.id === id);
			if (index === -1) return null;
			const current = rows[index]!;
			const next: ReadingItem = {
				...current,
				title:
					patch.title !== undefined
						? cleanText(patch.title, MAX_READING_TITLE_CHARS)
						: current.title,
				author:
					patch.author !== undefined
						? cleanText(patch.author, MAX_READING_AUTHOR_CHARS)
						: current.author,
				url: patch.url !== undefined ? cleanText(patch.url, MAX_READING_URL_CHARS) : current.url,
				note:
					patch.note !== undefined
						? cleanMultiline(patch.note, MAX_READING_NOTE_CHARS)
						: current.note,
				updatedAt: now(),
			};
			rows[index] = next;
			writeList(READING_LIST_FILE, rows);
			return next;
		},

		deleteReading(id: string): boolean {
			const rows = readList<ReadingItem>(READING_LIST_FILE);
			const kept = rows.filter((entry) => entry.id !== id);
			if (kept.length === rows.length) return false;
			writeList(READING_LIST_FILE, kept);
			return true;
		},
	};
}
