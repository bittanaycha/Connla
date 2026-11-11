/**
 * Library records — the glossary, saved highlights, and the reading list
 * (library wave). Browser-safe: shapes, limits, normalization, and the
 * strict-JSON definition parser only. The fs adapter lives in
 * src/store/library.ts and the one-shot definition call in
 * src/server/library.ts.
 *
 * One source citation shape for all three: the chat and message a record
 * came from, captured at creation time. A deleted chat leaves the ids in
 * place (they simply stop resolving) rather than rewriting the record.
 */

import { isPronounceLanguage, type PronounceLanguage } from "./pronounce.ts";

/** A selected-passage glossary term is short; 160 covers multi-word chunks. */
export const MAX_GLOSSARY_CHARS = 160;
export const MAX_TERM_CHARS = 120;
export const MAX_PART_OF_SPEECH_CHARS = 40;
export const MAX_DEFINITION_CHARS = 600;
export const MAX_GLOSSARY_CONTEXT_CHARS = 800;

/** Highlights keep a quote, not a chapter. */
export const MAX_HIGHLIGHT_CHARS = 4000;

/** A translation request is a passage, not a chapter. */
export const MAX_TRANSLATE_CHARS = 2000;
export const MAX_TRANSLATION_CHARS = 2000;
export const MAX_TRANSLATION_NOTE_CHARS = 240;

export const MAX_READING_TITLE_CHARS = 200;
export const MAX_READING_AUTHOR_CHARS = 120;
export const MAX_READING_URL_CHARS = 2000;
export const MAX_READING_NOTE_CHARS = 1000;

export interface LibrarySource {
	chatId: string | null;
	messageId: string | null;
}

export interface GlossaryEntry {
	id: string;
	term: string;
	/** The word as it appeared in the text when it differs from `term` ("mangeais" for "manger"). */
	form: string;
	language: PronounceLanguage;
	partOfSpeech: string;
	definition: string;
	source: LibrarySource;
	createdAt: string;
	updatedAt: string;
}

export interface HighlightEntry {
	id: string;
	text: string;
	language: PronounceLanguage;
	source: LibrarySource;
	createdAt: string;
}

export interface ReadingItem {
	id: string;
	title: string;
	/** Author, publication, site, or any free-text source note. */
	author: string;
	url: string;
	note: string;
	source: LibrarySource;
	createdAt: string;
	updatedAt: string;
}

export interface NewGlossaryEntry {
	term: string;
	form: string;
	language: PronounceLanguage;
	partOfSpeech: string;
	definition: string;
	source: LibrarySource;
}

export interface GlossaryPatch {
	term?: string;
	partOfSpeech?: string;
	definition?: string;
}

export interface NewHighlightEntry {
	text: string;
	language: PronounceLanguage;
	source: LibrarySource;
}

export interface NewReadingEntry {
	title: string;
	author: string;
	url: string;
	note: string;
	source: LibrarySource;
}

export interface ReadingPatch {
	title?: string;
	author?: string;
	url?: string;
	note?: string;
}

/** The model's strict-JSON answer, already clamped. */
export interface GeneratedDefinition {
	term: string;
	language: PronounceLanguage;
	partOfSpeech: string;
	definition: string;
}

/** The model's strict-JSON translation answer, already clamped. */
export interface GeneratedTranslation {
	translation: string;
	/** One optional sentence about a grammar point, idiom, or false friend. */
	note: string;
}

const LANGUAGE_CODE = /^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/i;

/** Trim + collapse whitespace; null/undefined/non-strings become "". */
export function cleanText(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	const text = value.replace(/\s+/g, " ").trim();
	return text.length > max ? text.slice(0, max).trim() : text;
}

/** Like cleanText but keeps paragraph breaks (at most one blank line). */
export function cleanMultiline(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	const text = value
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text.length > max ? text.slice(0, max).trim() : text;
}

/** First two letters, lowercased — the pronunciation key ("pt-BR" → "pt"). */
export function normalizeLanguage(value: unknown, fallback: PronounceLanguage = "en"): PronounceLanguage {
	if (typeof value === "string") {
		const code = value.trim().toLowerCase();
		if (LANGUAGE_CODE.test(code)) {
			const base = code.split(/[-_]/)[0]!;
			if (isPronounceLanguage(base)) return base;
		}
	}
	return fallback;
}

/** The dedupe key: case, surrounding punctuation, and spacing do not create a second card. */
export function normalizeTerm(term: string): string {
	return term
		.replace(/^[\s"'“”‘’«»()[\]{}]+/u, "")
		.replace(/[\s"'“”‘’«»()[\]{}.,;:!?…]+$/u, "")
		.replace(/\s+/g, " ")
		.toLowerCase();
}

export function glossaryKey(term: string, language: PronounceLanguage): string {
	return `${language}:${normalizeTerm(term)}`;
}

export function isWebUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}

/** Reading-list dedupe: the same article without scheme/trailing slash, else the same title. */
export function readingKey(title: string, url: string): string {
	const cleanUrl = url
		.trim()
		.replace(/^https?:\/\//i, "")
		.replace(/^www\./i, "")
		.replace(/[?#].*$/, "")
		.replace(/\/+$/, "")
		.toLowerCase();
	if (cleanUrl) return `url:${cleanUrl}`;
	return `title:${cleanText(title, MAX_READING_TITLE_CHARS).toLowerCase()}`;
}

export function emptySource(): LibrarySource {
	return { chatId: null, messageId: null };
}

export function sanitizeSource(value: unknown): LibrarySource {
	const source = (value ?? {}) as Record<string, unknown>;
	const id = (key: string): string | null => {
		const text = source[key];
		return typeof text === "string" && text.trim() ? text.trim().slice(0, 120) : null;
	};
	return { chatId: id("chatId"), messageId: id("messageId") };
}

/**
 * Pull the JSON object out of a model answer. The prompts ask for strict
 * JSON; fences and a sentence around the object are tolerated because they
 * are free to strip and a retry costs more than a brace search.
 */
function sliceJsonObject(raw: string): string | null {
	if (typeof raw !== "string") return null;
	let text = raw.trim();
	if (text.startsWith("```")) {
		text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
	}
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	return text.slice(start, end + 1);
}

/**
 * Parse the model's definition answer.
 */
export function parseGeneratedDefinition(
	raw: string,
	fallbackLanguage: PronounceLanguage = "en",
): GeneratedDefinition | null {
	const json = sliceJsonObject(raw);
	if (!json) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const record = parsed as Record<string, unknown>;
	const term = cleanText(record.term, MAX_TERM_CHARS);
	const definition = cleanText(record.definition, MAX_DEFINITION_CHARS);
	if (!term || !definition) return null;
	return {
		term,
		language: normalizeLanguage(record.language, fallbackLanguage),
		partOfSpeech: cleanText(record.partOfSpeech, MAX_PART_OF_SPEECH_CHARS),
		definition,
	};
}

/** Parse the model's translation answer. `note` is optional. */
export function parseTranslation(raw: string): GeneratedTranslation | null {
	const json = sliceJsonObject(raw);
	if (!json) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const record = parsed as Record<string, unknown>;
	const translation = cleanMultiline(record.translation, MAX_TRANSLATION_CHARS);
	if (!translation) return null;
	return {
		translation,
		note: cleanText(record.note, MAX_TRANSLATION_NOTE_CHARS),
	};
}
