import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	ANKI_MAX_CARDS,
	ANKI_MAX_MEDIA,
	ANKI_MAX_MEDIA_BYTES,
	ankiDeckProblems,
	normalizeAnkiDeck,
	sanitizeAnkiMediaName,
	type AnkiDeck,
	type AnkiAudioSynthesizer,
	type AnkiExportDetails,
	type AnkiExportWriter,
	type AnkiMediaFile,
} from "../../core/anki.ts";
import { hasEdgeVoice, isPronounceLanguage, PRONOUNCE_LANGUAGES, type PronounceLanguage } from "../../core/pronounce.ts";
import { serverExecute } from "../tool-execute.ts";
import { resolveSourcePath } from "./fs-shared.ts";

/**
 * export_anki (Anki wave): the teacher authors one standalone deck during
 * a lesson and the app writes a self-contained .apkg. The lesson owns the
 * card design — fields, templates, CSS, cloze, and media — so the deck is
 * not a fixed front/back dump. One call, one deck, one download.
 */

const templateInput = Type.Object({
	name: Type.String({ minLength: 1, description: "Template name shown in Anki, e.g. “Card 1” or “Recognition”" }),
	front: Type.String({ minLength: 1, description: "Anki front template; use {{Field}} placeholders" }),
	back: Type.String({ minLength: 1, description: "Anki back template; {{FrontSide}} repeats the front" }),
});

const mediaInput = Type.Union(
	[
		Type.Object({
			path: Type.String({ minLength: 1, description: "Local path to an image or audio file the learner provided" }),
			name: Type.Optional(Type.String({ description: "Optional file name used inside the deck" })),
		}),
		Type.Object({
			text: Type.String({
				minLength: 1,
				maxLength: 1200,
				description: "Text to speak with Edge TTS; synthesized to mp3 and bundled",
			}),
			language: Type.String({
				minLength: 2,
				description: "Edge TTS language code, e.g. cy, en, fr, de, es",
			}),
			name: Type.Optional(Type.String({ description: "Optional mp3 file name used inside the deck" })),
		}),
	],
	{
		description:
			"Bundle media. Use {path} for an existing learner file, or {text, language} to synthesize speech with Edge TTS.",
	},
);

const exportAnkiInput = Type.Object({
	deckName: Type.String({ minLength: 1, description: "Deck name, e.g. “Welsh — Mutations”" }),
	noteType: Type.Object({
		name: Type.String({ minLength: 1, description: "Note type name, e.g. “Welsh Mutation Card”" }),
		kind: Type.Optional(
			Type.Union([Type.Literal("basic"), Type.Literal("cloze")], {
				description: "basic (default) or cloze; cloze templates use {{cloze:Field}}",
			}),
		),
		fields: Type.Array(Type.String({ minLength: 1 }), {
			minItems: 1,
			maxItems: 12,
			description: "Field names in display order",
		}),
		templates: Type.Array(templateInput, { minItems: 1, maxItems: 8 }),
		css: Type.Optional(Type.String({ description: "Optional card CSS shared by every template" })),
	}),
	cards: Type.Array(
		Type.Object({
			fields: Type.Record(Type.String(), Type.String(), {
				description: "One value per field name; HTML is allowed",
			}),
			tags: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
			guid: Type.Optional(
				Type.String({
					description: "Stable identity for re-exports of the same note (e.g. the node id); omit for one-off decks",
				}),
			),
		}),
		{ minItems: 1, maxItems: ANKI_MAX_CARDS },
	),
	media: Type.Optional(
		Type.Array(mediaInput, {
			maxItems: ANKI_MAX_MEDIA,
			description:
				"Images or audio files to bundle. Reference them in fields as <img src=\"name\"> or [sound:name].",
		}),
	),
});

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

async function readMedia(
	items: ({ path: string; name?: string } | { text: string; language: string; name?: string })[] | undefined,
	synthesize: AnkiAudioSynthesizer | undefined,
): Promise<AnkiMediaFile[]> {
	if (!items?.length) return [];
	const out: AnkiMediaFile[] = [];
	const used = new Set<string>();
	const add = (filename: string, data: Uint8Array, mime: string) => {
		if (used.has(filename)) throw new Error(`Two media files would use the same name: ${filename}`);
		used.add(filename);
		out.push({ filename, data, mime });
	};
	for (const item of items) {
		if ("path" in item) {
			const absolute = resolveSourcePath(item.path);
			const stat = fs.statSync(/* turbopackIgnore: true */ absolute, { throwIfNoEntry: false });
			if (!stat?.isFile()) throw new Error(`Media file not found: ${item.path}`);
			if (stat.size > ANKI_MAX_MEDIA_BYTES) {
				throw new Error(`Media file is larger than ${Math.round(ANKI_MAX_MEDIA_BYTES / 1024 / 1024)} MB: ${item.path}`);
			}
			const ext = path.extname(absolute).toLowerCase();
			const mime = MEDIA_MIME[ext];
			if (!mime) {
				throw new Error(`Unsupported media type “${ext}”. Use png, jpg, gif, webp, svg, mp3, ogg, wav, or m4a.`);
			}
			// The source extension is authoritative: Anki's media server uses it
			// to choose a Content-Type, so a bare `name` must still become
			// `name.png` rather than an extensionless file.
			const rawName = item.name?.trim() || path.basename(absolute);
			const stem = rawName.replace(/\.[^./\\]+$/, "");
			add(sanitizeAnkiMediaName(`${stem || "media"}${ext}`), fs.readFileSync(/* turbopackIgnore: true */ absolute), mime);
			continue;
		}
		const rawLanguage = item.language.trim().toLowerCase();
		if (!isPronounceLanguage(rawLanguage) || !hasEdgeVoice(rawLanguage)) {
			const supported = PRONOUNCE_LANGUAGES.filter((code) => hasEdgeVoice(code)).join(", ");
			throw new Error(`Edge TTS has no voice for “${item.language}”. Supported: ${supported}.`);
		}
		const language: PronounceLanguage = rawLanguage;
		if (!synthesize) throw new Error("Edge TTS is not available in this session.");
		const speech = await synthesize(item.text, language);
		const rawName = item.name?.trim() || `tts-${out.length + 1}.mp3`;
		const stem = rawName.replace(/\.[^./\\]+$/, "");
		add(sanitizeAnkiMediaName(`${stem || "tts"}.mp3`), speech.data, speech.mime);
	}
	return out;
}

export function createAnkiTool(ctx: {
	writeAnkiExport?: AnkiExportWriter;
	synthesizeAnkiAudio?: AnkiAudioSynthesizer;
}): AgentTool<typeof exportAnkiInput> {
	return {
		name: "export_anki",
		label: "export_anki",
		description:
			"Author one Anki deck for the learner and deliver a self-contained .apkg download. " +
			"The deck is yours: name the note type, define its fields and front/back templates, add CSS, use cloze deletions, and bundle images or audio. " +
			"Audio can come from a local file path or from Edge TTS text; use Edge TTS for pronunciation. " +
			"Use it when the learner asks for flashcards or an Anki deck; one call builds one standalone deck. " +
			"Keep each note atomic (one fact, one production), write in the learner's language, and do not use scripts or remote URLs in cards.",
		parameters: exportAnkiInput,
		execute: serverExecute("export_anki", exportAnkiInput, async (input): Promise<{ text: string; details: AnkiExportDetails }> => {
			const deck: AnkiDeck = {
				name: input.deckName,
				noteType: {
					name: input.noteType.name,
					kind: input.noteType.kind,
					fields: input.noteType.fields,
					templates: input.noteType.templates,
					css: input.noteType.css,
				},
				cards: input.cards,
			};
			const problems = ankiDeckProblems(deck);
			if (problems.length) {
				throw new Error(`The deck input is invalid. Fix these and retry:\n${problems.map((p) => `- ${p}`).join("\n")}`);
			}
			const media = await readMedia(input.media, ctx.synthesizeAnkiAudio);
			if (!ctx.writeAnkiExport) throw new Error("Anki export is not available in this session.");
			const details = ctx.writeAnkiExport(normalizeAnkiDeck(deck), media);
			return {
				text: `Built “${details.deckName}” — ${details.noteCount} note${details.noteCount === 1 ? "" : "s"}, ${details.cardCount} card${details.cardCount === 1 ? "" : "s"}${details.mediaCount ? `, ${details.mediaCount} media file${details.mediaCount === 1 ? "" : "s"}` : ""}. The learner can download the .apkg from the deck card.`,
				details,
			};
		}),
	};
}
