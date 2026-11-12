/**
 * AnkiConnect client (Anki wave): the local HTTP bridge into a running Anki.
 *
 * It is optional by design. When it is absent the popup still saves cards
 * into the queue, and the queue exports a standalone .apkg. Direct send
 * only creates the quick-card model/deck and posts one note per card.
 */

import type { AnkiNoteType } from "../core/anki.ts";
import type { FlashcardRecord } from "../core/cards.ts";

const DEFAULT_URL = "http://127.0.0.1:8765";

export class AnkiConnectError extends Error {
	readonly code: "unavailable" | "api";
	constructor(code: "unavailable" | "api", message: string) {
		super(message);
		this.name = "AnkiConnectError";
		this.code = code;
	}
}

export const QUICK_CARD_MODEL = "Connla Quick Card";
export const QUICK_CARD_FIELDS = ["Front", "Back", "Note", "Audio"] as const;

const QUICK_CARD_CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 20px;
  line-height: 1.45;
  text-align: center;
  color: #1a1a19;
  background: #ffffff;
  padding: 16px;
}
hr#answer { border: 0; border-top: 1px solid #d4d4d4; margin: 14px 0; }
.note { font-size: 14px; color: #555; margin-top: 10px; }
.audio { margin-top: 10px; }`;

const QUICK_CARD_FRONT = '{{Front}}{{#Audio}}<div class="audio">{{Audio}}</div>{{/Audio}}';
const QUICK_CARD_BACK =
	'{{Front}}<hr id="answer">{{Back}}{{#Note}}<div class="note">{{Note}}</div>{{/Note}}';

/** The note type used by both the queue export and direct send. */
export function quickCardNoteType(): AnkiNoteType {
	return {
		name: QUICK_CARD_MODEL,
		kind: "basic",
		fields: [...QUICK_CARD_FIELDS],
		templates: [{ name: "Card 1", front: QUICK_CARD_FRONT, back: QUICK_CARD_BACK }],
		css: QUICK_CARD_CSS,
	};
}

function baseUrl(): string {
	return (process.env.LH_ANKI_CONNECT_URL || DEFAULT_URL).replace(/\/+$/, "");
}

async function call<T>(action: string, params: Record<string, unknown> = {}, timeoutMs = 3500): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let response: Response;
	try {
		response = await fetch(baseUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, version: 6, params }),
			signal: controller.signal,
		});
	} catch {
		throw new AnkiConnectError(
			"unavailable",
			"AnkiConnect is not reachable. Open Anki and install the AnkiConnect add-on (code 2055492159).",
		);
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok) {
		throw new AnkiConnectError("unavailable", `AnkiConnect answered HTTP ${response.status}.`);
	}
	const body = (await response.json().catch(() => null)) as { result?: T; error?: string | null } | null;
	if (!body) throw new AnkiConnectError("api", "AnkiConnect returned an unreadable response.");
	if (body.error) throw new AnkiConnectError("api", body.error);
	return body.result as T;
}

export async function ankiDeckNames(): Promise<string[]> {
	const result = await call<unknown>("deckNames");
	return Array.isArray(result) ? result.filter((name): name is string => typeof name === "string") : [];
}

async function ensureDeck(name: string): Promise<void> {
	const decks = await ankiDeckNames();
	if (!decks.includes(name)) await call("createDeck", { deck: name });
}

async function ensureQuickCardModel(): Promise<void> {
	const models = await call<unknown>("modelNames");
	const names = Array.isArray(models) ? models.filter((name): name is string => typeof name === "string") : [];
	if (names.includes(QUICK_CARD_MODEL)) {
		const fields = await call<unknown>("modelFieldNames", { modelName: QUICK_CARD_MODEL });
		const existing = Array.isArray(fields) ? fields : [];
		if (existing.join("\u001f") !== QUICK_CARD_FIELDS.join("\u001f")) {
			throw new AnkiConnectError(
				"api",
				`The existing “${QUICK_CARD_MODEL}” note type has different fields; rename or delete it in Anki, or export a deck instead.`,
			);
		}
		return;
	}
	try {
		await call("createModel", {
			modelName: QUICK_CARD_MODEL,
			inOrderFields: [...QUICK_CARD_FIELDS],
			css: QUICK_CARD_CSS,
			cardTemplates: [{ Name: "Card 1", Front: QUICK_CARD_FRONT, Back: QUICK_CARD_BACK }],
		});
	} catch (error) {
		// A concurrent create is not a failure if the model now exists.
		if (error instanceof AnkiConnectError && error.code === "api") {
			const after = await call<unknown>("modelNames").catch(() => []);
			if (Array.isArray(after) && after.includes(QUICK_CARD_MODEL)) return;
		}
		throw error;
	}
}

export interface QuickCardSendResult {
	noteId: number | null;
	duplicate: boolean;
}

/** Send one queued card into Anki, creating the quick-card model/deck first. */
export async function sendQuickCard(
	card: FlashcardRecord,
	deckName: string,
	audio?: { filename: string; data: Uint8Array } | null,
): Promise<QuickCardSendResult> {
	await ensureDeck(deckName);
	await ensureQuickCardModel();

	let audioField = "";
	if (audio && audio.data.length) {
		const stored = await call<string>("storeMediaFile", {
			filename: audio.filename,
			data: Buffer.from(audio.data).toString("base64"),
		});
		audioField = `[sound:${stored || audio.filename}]`;
	}

	const noteId = await call<number | null>("addNote", {
		note: {
			deckName,
			modelName: QUICK_CARD_MODEL,
			fields: {
				Front: card.front,
				Back: card.back,
				Note: card.note,
				Audio: audioField,
			},
			options: { allowDuplicate: false, duplicateScope: "deck" },
			tags: ["connla", card.kind],
		},
	});
	return { noteId: typeof noteId === "number" ? noteId : null, duplicate: noteId == null };
}

/** Whether AnkiConnect is reachable right now (used by the popup deck picker). */
export async function probeAnkiConnect(): Promise<boolean> {
	try {
		await call("version", {}, 1200);
		return true;
	} catch {
		return false;
	}
}
