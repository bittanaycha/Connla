import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	ANKI_MAX_CARDS,
	ANKI_MAX_MEDIA,
	ankiDeckProblems,
	normalizeAnkiDeck,
	type AnkiDeck,
	type AnkiExportDetails,
	type AnkiExportStarter,
	type AnkiMediaRequest,
} from "../../core/anki.ts";
import { isPronounceLanguage, PRONOUNCE_LANGUAGES, type PronounceLanguage } from "../../core/pronounce.ts";
import { serverExecute } from "../tool-execute.ts";

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
				description: "Text to speak; synthesized to mp3 in the background and bundled",
			}),
			language: Type.String({
				minLength: 2,
				description: "Speech language code, e.g. cy, en, fr, de, es",
			}),
			name: Type.Optional(Type.String({ description: "Optional mp3 file name used inside the deck" })),
		}),
	],
	{
		description:
			"Bundle media. Use {path} for an existing learner file, or {text, language} to synthesize speech.",
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

function toMediaRequest(item: { path: string; name?: string } | { text: string; language: string; name?: string }): AnkiMediaRequest {
	if ("path" in item) return { kind: "file", path: item.path, name: item.name };
	const language = item.language.trim().toLowerCase();
	if (!isPronounceLanguage(language)) {
		throw new Error(`Unknown speech language “${item.language}”. Supported: ${PRONOUNCE_LANGUAGES.join(", ")}.`);
	}
	return { kind: "speech", text: item.text, language: language as PronounceLanguage, name: item.name };
}

export function createAnkiTool(ctx: { startAnkiExport?: AnkiExportStarter }): AgentTool<typeof exportAnkiInput> {
	return {
		name: "export_anki",
		label: "export_anki",
		description:
			"Author one Anki deck for the learner and deliver a self-contained .apkg download. " +
			"The deck is yours: name the note type, define its fields and front/back templates, add CSS, use cloze deletions, and bundle images or audio. " +
			"Audio can come from a local file path or from speech text; speech uses Azure when configured, with Edge as fallback. Audio generation runs in the background, so the deck card updates when the package is ready. " +
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
			if (!ctx.startAnkiExport) throw new Error("Anki export is not available in this session.");
			const details = ctx.startAnkiExport(normalizeAnkiDeck(deck), (input.media ?? []).map(toMediaRequest));
			return {
				text: `Started building “${details.deckName}” with ${details.noteCount} note${details.noteCount === 1 ? "" : "s"} and ${details.cardCount} card${details.cardCount === 1 ? "" : "s"}. Audio is generated in the background; the deck card shows progress and the download appears when the package is ready.`,
				details,
			};
		}),
	};
}
