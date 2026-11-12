/**
 * Anki decks — the pure half of the flashcard export (Anki wave).
 *
 * A deck is authored in the lesson: the teacher names it, chooses the note
 * type (fields, templates, CSS), and fills one note per card. This module
 * validates that authored object and renders a browser-safe preview; the
 * .apkg writer lives in src/server/anki.ts because it needs node:sqlite.
 *
 * Supported template subset (deliberately smaller than Anki's): `{{Field}}`,
 * `{{text:Field}}`, `{{cloze:Field}}`, `{{FrontSide}}`, `{{Tags}}`,
 * `{{Deck}}`, `{{Subdeck}}`, `{{Card}}`, `{{Type}}`, and the section forms
 * `{{#Field}}…{{/Field}}` / `{{^Field}}…{{/Field}}`. Anything else is a
 * validation error, so the teacher gets a concrete problem to fix instead
 * of a deck that renders blank in Anki.
 */

import type { PronounceLanguage } from "./pronounce.ts";

/** A deck is a focused study object, not a whole curriculum. */
export const ANKI_MAX_CARDS = 500;
export const ANKI_MAX_DECK_CHARS = 80;
export const ANKI_MAX_NOTE_TYPE_CHARS = 60;
export const ANKI_MAX_FIELD_NAME_CHARS = 40;
export const ANKI_MAX_FIELDS = 12;
export const ANKI_MAX_TEMPLATES = 8;
export const ANKI_MAX_FIELD_CHARS = 20_000;
export const ANKI_MAX_CSS_CHARS = 20_000;
export const ANKI_MAX_TEMPLATE_CHARS = 10_000;
export const ANKI_MAX_TAGS = 20;
export const ANKI_MAX_TAG_CHARS = 40;
export const ANKI_MAX_MEDIA = 40;
export const ANKI_MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export type AnkiNoteTypeKind = "basic" | "cloze";

export interface AnkiCardTemplate {
	name: string;
	/** Anki's "Front" template. */
	front: string;
	/** Anki's "Back" template. */
	back: string;
}

export interface AnkiNoteType {
	name: string;
	/** Inferred from the templates when omitted. */
	kind?: AnkiNoteTypeKind;
	fields: string[];
	templates: AnkiCardTemplate[];
	css?: string;
}

export interface AnkiCard {
	fields: Record<string, string>;
	tags?: string[];
	/** Optional stable identity for re-exports; hashed into the note GUID. */
	guid?: string;
}

export interface AnkiDeck {
	name: string;
	noteType: AnkiNoteType;
	cards: AnkiCard[];
}

export type AnkiExportState = "running" | "done" | "error";

/** What the export tool writes into the session record (and the artifact card renders). */
export interface AnkiExportDetails {
	deckName: string;
	noteType: string;
	noteCount: number;
	cardCount: number;
	mediaCount: number;
	downloadUrl: string;
	previewUrl: string;
	/** Background export: "running" until the audio job finishes. */
	state: AnkiExportState;
	jobId: string;
	statusUrl: string;
	/** Clips that could not be synthesized; the cards still export silently. */
	warnings: string[];
	error?: string;
}

/** Progress written by the background export job and read by the deck card. */
export interface AnkiJobStatus {
	state: AnkiExportState;
	deckName: string;
	noteCount: number;
	cardCount: number;
	mediaTotal: number;
	mediaCompleted: number;
	mediaCount: number;
	current?: string;
	warnings: string[];
	error?: string;
	updatedAt: number;
	downloadUrl: string;
	previewUrl: string;
	statusUrl: string;
}

/** One requested media item; files are read server-side and speech is synthesized. */
export type AnkiMediaRequest =
	| { kind: "file"; path: string; name?: string }
	| { kind: "speech"; text: string; language: PronounceLanguage; name?: string };

/** The composition root injects the writer; the agent layer never imports the server. */
export type AnkiExportWriter = (deck: AnkiDeck, media: AnkiMediaFile[], options?: { id?: string; warnings?: string[] }) => AnkiExportDetails;

/** The composition root starts the background export; the agent only holds the callback. */
export type AnkiExportStarter = (deck: AnkiDeck, media: AnkiMediaRequest[]) => AnkiExportDetails;

/** Media is read server-side from the learner's file paths. */
export interface AnkiMediaFile {
	filename: string;
	data: Uint8Array;
	/** Used only by the preview iframe; the package stores the bytes. */
	mime?: string;
}

/** A safe flat media filename: no directories, no control/path characters. */
export function sanitizeAnkiMediaName(name: string): string {
	const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim();
	const cleaned = base.replace(/^\.+/, "").slice(0, 120);
	return cleaned || "media";
}

const TEMPLATE_BUILTINS = new Set(["FrontSide", "Tags", "Deck", "Subdeck", "Card", "Type", "CardFlag"]);
const TEMPLATE_FILTERS = new Set(["text", "cloze"]);

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function clampText(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value;
}

/** Tag text for Anki: no whitespace (Anki treats it as a tag separator). */
export function normalizeAnkiTag(tag: string): string {
	return tag.trim().replace(/\s+/g, "_").replace(/^#+/, "").slice(0, ANKI_MAX_TAG_CHARS);
}

function templateTokens(template: string): { raw: string; body: string }[] {
	const tokens: { raw: string; body: string }[] = [];
	const re = /\{\{([^{}]*)\}\}/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(template)) !== null) tokens.push({ raw: match[0], body: match[1]!.trim() });
	return tokens;
}

function templateField(body: string): string | null {
	if (body.startsWith("#") || body.startsWith("^") || body.startsWith("/")) {
		const name = body.slice(1).trim();
		return name || null;
	}
	const pipe = body.indexOf("|");
	const filtered = (pipe === -1 ? body : body.slice(0, pipe)).trim();
	const colon = filtered.lastIndexOf(":");
	const name = (colon === -1 ? filtered : filtered.slice(colon + 1)).trim();
	return name || null;
}

/** Every field name a template reads, in first-seen order (sections included). */
export function ankiTemplateFields(template: string): string[] {
	const seen = new Set<string>();
	for (const token of templateTokens(template)) {
		const name = templateField(token.body);
		if (!name || TEMPLATE_BUILTINS.has(name)) continue;
		seen.add(name);
	}
	return [...seen];
}

function sectionProblem(template: string, label: string): string | null {
	const stack: string[] = [];
	for (const token of templateTokens(template)) {
		const body = token.body;
		if (body.startsWith("#") || body.startsWith("^")) {
			const name = body.slice(1).trim();
			if (!name) return `${label} has an empty section tag.`;
			stack.push(name);
			continue;
		}
		if (body.startsWith("/")) {
			const name = body.slice(1).trim();
			const open = stack.pop();
			if (open !== name) return `${label} closes {{/${name}}} without a matching {{#${name}}} or {{^${name}}}.`;
		}
	}
	return stack.length ? `${label} leaves {{#${stack[stack.length - 1]}}} unclosed.` : null;
}

function templateProblem(template: string, label: string, fields: ReadonlySet<string>): string | null {
	const section = sectionProblem(template, label);
	if (section) return section;
	for (const token of templateTokens(template)) {
		const body = token.body;
		if (!body || body.startsWith("/") || body.startsWith("#") || body.startsWith("^")) {
			if (body.startsWith("#") || body.startsWith("^")) {
				const name = body.slice(1).trim();
				if (!TEMPLATE_BUILTINS.has(name) && !fields.has(name)) {
					return `${label} refers to the section “${name}”, which is not one of the note type's fields.`;
				}
			}
			continue;
		}
		const pipe = body.indexOf("|");
		const head = (pipe === -1 ? body : body.slice(0, pipe)).trim();
		const colon = head.lastIndexOf(":");
		const filter = colon === -1 ? "" : head.slice(0, colon).trim();
		const name = (colon === -1 ? head : head.slice(colon + 1)).trim();
		if (!name) return `${label} has an empty template tag.`;
		if (filter && !TEMPLATE_FILTERS.has(filter)) {
			return `${label} uses the unsupported filter “${filter}”. Use {{Field}}, {{text:Field}}, or {{cloze:Field}}.`;
		}
		if (!TEMPLATE_BUILTINS.has(name) && !fields.has(name)) {
			return `${label} refers to “${name}”, which is not one of the note type's fields.`;
		}
	}
	return null;
}

/** The concrete problems with an authored deck, empty when it can be built. */
export function ankiDeckProblems(deck: AnkiDeck): string[] {
	const problems: string[] = [];
	const name = asString(deck.name).trim();
	if (!name) problems.push("The deck needs a name.");
	else if (name.length > ANKI_MAX_DECK_CHARS) problems.push(`The deck name is longer than ${ANKI_MAX_DECK_CHARS} characters.`);

	const noteType = deck.noteType;
	if (!noteType || typeof noteType !== "object") return [...problems, "The deck needs a note type."];
	const noteTypeName = asString(noteType.name).trim();
	if (!noteTypeName) problems.push("The note type needs a name.");
	else if (noteTypeName.length > ANKI_MAX_NOTE_TYPE_CHARS) {
		problems.push(`The note type name is longer than ${ANKI_MAX_NOTE_TYPE_CHARS} characters.`);
	}

	const fields = (Array.isArray(noteType.fields) ? noteType.fields : []).map((field) => asString(field).trim());
	if (!fields.length) problems.push("The note type needs at least one field.");
	if (fields.length > ANKI_MAX_FIELDS) problems.push(`A note type can have at most ${ANKI_MAX_FIELDS} fields.`);
	const fieldSet = new Set<string>();
	for (const field of fields) {
		if (!field) {
			problems.push("Field names cannot be empty.");
			continue;
		}
		if (field.length > ANKI_MAX_FIELD_NAME_CHARS) {
			problems.push(`The field name “${field}” is longer than ${ANKI_MAX_FIELD_NAME_CHARS} characters.`);
		}
		if (/[{}\r\n\t:|]/.test(field)) {
			problems.push(`The field name “${field}” contains a reserved character. Use letters, numbers, spaces, dashes, or underscores.`);
		}
		if (TEMPLATE_BUILTINS.has(field)) {
			problems.push(`The field name “${field}” is reserved by Anki's template tags; choose another name.`);
		}
		if (fieldSet.has(field)) problems.push(`The field “${field}” is listed twice.`);
		fieldSet.add(field);
	}

	const templates = Array.isArray(noteType.templates) ? noteType.templates : [];
	if (!templates.length) problems.push("The note type needs at least one card template.");
	if (templates.length > ANKI_MAX_TEMPLATES) problems.push(`A note type can have at most ${ANKI_MAX_TEMPLATES} templates.`);
	const usesCloze = templates.some((template) => /\{\{cloze:/i.test(asString(template?.front) + asString(template?.back)));
	const kind: AnkiNoteTypeKind = noteType.kind === "cloze" || (!noteType.kind && usesCloze) ? "cloze" : "basic";
	if (kind === "cloze" && !usesCloze) problems.push("A cloze note type needs at least one {{cloze:Field}} template tag.");
	if (kind === "cloze" && templates.length !== 1) problems.push("A cloze note type has exactly one card template.");
	if (kind === "basic" && usesCloze) {
		problems.push("This template uses {{cloze:…}}; set noteType.kind to \"cloze\" (or remove the cloze filter).");
	}

	templates.forEach((template, index) => {
		const label = `Template ${index + 1}`;
		const front = asString(template?.front);
		const back = asString(template?.back);
		if (!asString(template?.name).trim()) problems.push(`${label} needs a name.`);
		if (!front.trim()) problems.push(`${label} needs front HTML.`);
		if (!back.trim()) problems.push(`${label} needs back HTML.`);
		if (front.length > ANKI_MAX_TEMPLATE_CHARS || back.length > ANKI_MAX_TEMPLATE_CHARS) {
			problems.push(`${label} is longer than ${ANKI_MAX_TEMPLATE_CHARS} characters.`);
		}
		const frontProblem = templateProblem(front, `${label} front`, fieldSet);
		if (frontProblem) problems.push(frontProblem);
		const backProblem = templateProblem(back, `${label} back`, fieldSet);
		if (backProblem) problems.push(backProblem);
	});

	const css = asString(noteType.css);
	if (css.length > ANKI_MAX_CSS_CHARS) problems.push(`The deck CSS is longer than ${ANKI_MAX_CSS_CHARS} characters.`);

	const cards = Array.isArray(deck.cards) ? deck.cards : [];
	if (!cards.length) problems.push("The deck needs at least one card.");
	if (cards.length > ANKI_MAX_CARDS) problems.push(`A deck can have at most ${ANKI_MAX_CARDS} cards.`);
	cards.forEach((card, index) => {
		const label = `Card ${index + 1}`;
		if (!card || typeof card !== "object" || !card.fields || typeof card.fields !== "object") {
			problems.push(`${label} needs a fields object.`);
			return;
		}
		for (const field of fields) {
			const value = card.fields[field];
			if (typeof value !== "string") {
				problems.push(`${label} is missing the field “${field}”.`);
				continue;
			}
			if (value.length > ANKI_MAX_FIELD_CHARS) {
				problems.push(`${label}'s field “${field}” is longer than ${ANKI_MAX_FIELD_CHARS} characters.`);
			}
		}
		const tags = Array.isArray(card.tags) ? card.tags : [];
		if (tags.length > ANKI_MAX_TAGS) problems.push(`${label} has more than ${ANKI_MAX_TAGS} tags.`);
		for (const tag of tags) {
			const clean = normalizeAnkiTag(asString(tag));
			if (!clean) problems.push(`${label} has an empty tag.`);
			if (asString(tag).trim().length > ANKI_MAX_TAG_CHARS) {
				problems.push(`${label} has a tag longer than ${ANKI_MAX_TAG_CHARS} characters.`);
			}
		}
		if (kind === "cloze" && !parseAnkiClozeOrds(card).length) {
			problems.push(`${label} has no {{c1::…}} cloze deletion.`);
		}
	});

	return problems;
}

/** Trim/normalize an authored deck. Call ankiDeckProblems first. */
export function normalizeAnkiDeck(deck: AnkiDeck): AnkiDeck {
	const noteType = deck.noteType;
	const templates = noteType.templates ?? [];
	const usesCloze = templates.some((template) => /\{\{cloze:/i.test(template.front + template.back));
	const kind: AnkiNoteTypeKind = noteType.kind === "cloze" || (!noteType.kind && usesCloze) ? "cloze" : "basic";
	const fields = noteType.fields.map((field) => field.trim());
	return {
		name: deck.name.trim(),
		noteType: {
			name: noteType.name.trim(),
			kind,
			fields,
			templates: templates.map((template, index) => ({
				name: template.name.trim() || `Card ${index + 1}`,
				front: template.front.trim(),
				back: template.back.trim(),
			})),
			...(noteType.css?.trim() ? { css: noteType.css.trim() } : {}),
		},
		cards: deck.cards.map((card) => {
			const values: Record<string, string> = {};
			for (const field of fields) values[field] = card.fields[field] ?? "";
			const tags = [...new Set((card.tags ?? []).map((tag) => normalizeAnkiTag(tag)).filter(Boolean))];
			return {
				fields: values,
				...(tags.length ? { tags } : {}),
				...(card.guid?.trim() ? { guid: card.guid.trim() } : {}),
			};
		}),
	};
}

/** How many Anki cards the deck generates (basic: notes × templates; cloze: one per cloze number). */
export function ankiCardCount(deck: AnkiDeck): number {
	if (deck.noteType.kind === "cloze") {
		return deck.cards.reduce((sum, card) => sum + parseAnkiClozeOrds(card).length, 0);
	}
	return deck.cards.length * deck.noteType.templates.length;
}

/** The card ordinals a cloze note generates: {{c1::…}} → 0, {{c2::…}} → 1. */
export function parseAnkiClozeOrds(card: AnkiCard): number[] {
	const ords = new Set<number>();
	for (const value of Object.values(card.fields)) {
		const re = /\{\{c(\d+)::/g;
		let match: RegExpExecArray | null;
		while ((match = re.exec(value)) !== null) {
			const number = Number(match[1]);
			if (Number.isInteger(number) && number > 0) ords.add(number - 1);
		}
	}
	return [...ords].filter((ord) => Number.isInteger(ord) && ord >= 0).sort((a, b) => a - b);
}

export function stripAnkiHtml(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
}

/** Render the active cloze deletion(s) hiding or revealing by card ordinal. */
export function renderAnkiCloze(value: string, reveal: boolean, ord?: number): string {
	return value.replace(/\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/g, (_match, number: string, text: string, hint?: string) => {
		const thisOrd = Number(number) - 1;
		const active = ord === undefined || thisOrd === ord;
		if (!active || reveal) return text;
		return hint ? `[${hint}]` : "[…]";
	});
}

export interface AnkiRenderContext {
	deckName: string;
	tags: string[];
	cardName: string;
	frontSide?: string;
	revealCloze?: boolean;
	clozeOrd?: number;
}

function sectionValue(name: string, fields: Record<string, string>, ctx: AnkiRenderContext): string {
	if (name === "FrontSide") return ctx.frontSide ?? "";
	if (name === "Tags") return ctx.tags.join(" ");
	if (name === "Deck") return ctx.deckName;
	if (name === "Subdeck") return ctx.deckName.split("::").pop() ?? ctx.deckName;
	if (name === "Card") return ctx.cardName;
	if (name === "Type") return ctx.revealCloze ? "Back" : "Front";
	if (name === "CardFlag") return "";
	return fields[name] ?? "";
}

/** Render one side of an Anki card template. Unknown tags render empty. */
export function renderAnkiTemplate(template: string, fields: Record<string, string>, ctx: AnkiRenderContext): string {
	const render = (text: string): string => {
		let out = "";
		let cursor = 0;
		while (cursor < text.length) {
			const open = text.indexOf("{{", cursor);
			if (open === -1) {
				out += text.slice(cursor);
				break;
			}
			out += text.slice(cursor, open);
			const close = text.indexOf("}}", open + 2);
			if (close === -1) {
				out += text.slice(open);
				break;
			}
			const body = text.slice(open + 2, close).trim();
			if (body.startsWith("#") || body.startsWith("^")) {
				const name = body.slice(1).trim();
				const inverted = body.startsWith("^");
				if (!TEMPLATE_BUILTINS.has(name) && !(name in fields)) {
					cursor = close + 2;
					continue;
				}
				let depth = 1;
				let scan = close + 2;
				let end = -1;
				while (scan < text.length) {
					const nextOpen = text.indexOf("{{", scan);
					if (nextOpen === -1) break;
					const nextClose = text.indexOf("}}", nextOpen + 2);
					if (nextClose === -1) break;
					const nextBody = text.slice(nextOpen + 2, nextClose).trim();
					if (nextBody === `#${name}` || nextBody === `^${name}`) depth += 1;
					if (nextBody === `/${name}`) {
						depth -= 1;
						if (depth === 0) {
							end = nextOpen;
							break;
						}
					}
					scan = nextClose + 2;
				}
				if (end === -1) {
					cursor = close + 2;
					continue;
				}
				const inner = render(text.slice(close + 2, end));
				const truthy = stripAnkiHtml(sectionValue(name, fields, ctx)).length > 0;
				if (inverted ? !truthy : truthy) out += inner;
				const closing = text.indexOf("}}", end + 2);
				cursor = closing === -1 ? text.length : closing + 2;
				continue;
			}
			if (body.startsWith("/")) {
				cursor = close + 2;
				continue;
			}
			const pipe = body.indexOf("|");
			const head = (pipe === -1 ? body : body.slice(0, pipe)).trim();
			const colon = head.lastIndexOf(":");
			const filter = colon === -1 ? "" : head.slice(0, colon).trim();
			const name = (colon === -1 ? head : head.slice(colon + 1)).trim();
			const value = sectionValue(name, fields, ctx);
			if (filter === "text") out += stripAnkiHtml(value);
			else if (filter === "cloze") out += renderAnkiCloze(value, ctx.revealCloze === true, ctx.clozeOrd);
			else out += value;
			cursor = close + 2;
		}
		return out;
	};
	return render(template);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function base64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/** Turn a media filename reference into an inline data URL for the preview. */
function inlineAnkiMedia(html: string, media: ReadonlyMap<string, { mime: string; data: Uint8Array }>): string {
	let out = html.replace(/\[sound:([^\]]+)\]/g, (match, filename: string) => {
		const item = media.get(filename);
		if (!item) return match;
		return `<audio controls src="data:${item.mime};base64,${base64(item.data)}"></audio>`;
	});
	for (const [filename, item] of media) {
		const url = `data:${item.mime};base64,${base64(item.data)}`;
		const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp(`src=(["'])${escaped}\\1`, "g"), `src="${url}"`);
	}
	return out;
}

/**
 * A self-contained preview document: deck CSS plus every card's front and
 * back. Media (images/audio) is inlined as data URLs, so the page works
 * from an iframe with scripts disabled.
 */
export function renderAnkiPreviewHtml(
	deck: AnkiDeck,
	media: ReadonlyMap<string, { mime: string; data: Uint8Array }> = new Map(),
): string {
	const noteType = deck.noteType;
	const kind = noteType.kind ?? (noteType.templates.some((t) => /\{\{cloze:/i.test(t.front + t.back)) ? "cloze" : "basic");
	const cards: { label: string; front: string; back: string }[] = [];
	deck.cards.forEach((card, cardIndex) => {
		const tags = card.tags ?? [];
		if (kind === "cloze") {
			const ords = parseAnkiClozeOrds(card);
			for (const ord of ords) {
				const template = noteType.templates[0]!;
				const front = renderAnkiTemplate(template.front, card.fields, {
					deckName: deck.name,
					tags,
					cardName: template.name,
					revealCloze: false,
					clozeOrd: ord,
				});
				const back = renderAnkiTemplate(template.back, card.fields, {
					deckName: deck.name,
					tags,
					cardName: template.name,
					frontSide: front,
					revealCloze: true,
					clozeOrd: ord,
				});
				cards.push({ label: `Card ${cardIndex + 1} · cloze ${ord + 1}`, front, back });
			}
			return;
		}
		for (const template of noteType.templates) {
			const front = renderAnkiTemplate(template.front, card.fields, {
				deckName: deck.name,
				tags,
				cardName: template.name,
				revealCloze: false,
			});
			const back = renderAnkiTemplate(template.back, card.fields, {
				deckName: deck.name,
				tags,
				cardName: template.name,
				frontSide: front,
				revealCloze: true,
			});
			cards.push({ label: `Card ${cardIndex + 1} · ${template.name}`, front, back });
		}
	});

	const chunks = cards
		.map(
			(card) => `<section class="anki-card">
<div class="anki-label">${escapeHtml(card.label)} · front</div>
<div class="anki-face">${inlineAnkiMedia(card.front, media)}</div>
<div class="anki-label">back</div>
<div class="anki-face">${inlineAnkiMedia(card.back, media)}</div>
</section>`,
		)
		.join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deck.name)} · Anki preview</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 16px; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f5; color: #1a1a19; }
.anki-header { max-width: 760px; margin: 0 auto 14px; }
.anki-header h1 { margin: 0; font-size: 17px; line-height: 1.3; }
.anki-header p { margin: 2px 0 0; font-size: 12px; opacity: .65; }
.anki-card { max-width: 760px; margin: 0 auto 14px; border: 1px solid rgba(0,0,0,.12); border-radius: 10px; background: #fff; padding: 14px 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
.anki-label { margin: 0 0 4px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; opacity: .45; }
.anki-face { margin: 0 0 12px; overflow-wrap: anywhere; }
.anki-face:last-child { margin-bottom: 0; }
.anki-face hr { border: 0; border-top: 1px solid rgba(0,0,0,.12); margin: 10px 0; }
.anki-face img { max-width: 100%; height: auto; }
.anki-face audio { max-width: 100%; }
.anki-face .cloze { font-weight: 600; text-decoration: underline; }
${(noteType.css ?? "").replace(/<\/style/gi, "<\\/style")}
@media (prefers-color-scheme: dark) {
  body { background: #171716; color: #ecece9; }
  .anki-card { background: #20201f; border-color: rgba(255,255,255,.14); }
  .anki-face hr { border-top-color: rgba(255,255,255,.14); }
}
</style>
</head>
<body>
<header class="anki-header">
<h1>${escapeHtml(deck.name)}</h1>
<p>${escapeHtml(deck.noteType.name)} · ${deck.cards.length} note${deck.cards.length === 1 ? "" : "s"} · ${cards.length} card${cards.length === 1 ? "" : "s"}${media.size ? ` · ${media.size} media` : ""}</p>
</header>
${chunks}
</body>
</html>`;
}

/** Clamp a field value for storage in the deck record. */
export function clampAnkiField(value: string): string {
	return clampText(value, ANKI_MAX_FIELD_CHARS);
}
