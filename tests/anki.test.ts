import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import type { AnkiDeck } from "../src/core/anki.ts";
import type { FlashcardRecord } from "../src/core/cards.ts";

// Isolate the composition root before importing anything that reads config.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-anki-"));
const previousDataDir = process.env.LH_DATA_DIR;
process.env.LH_DATA_DIR = path.join(directory, "data");

const {
	ankiDeckProblems,
	normalizeAnkiDeck,
	parseAnkiClozeOrds,
	renderAnkiCloze,
	renderAnkiPreviewHtml,
	renderAnkiTemplate,
	stripAnkiHtml,
} = await import("../src/core/anki.ts");
const { buildAnkiCollection, buildAnkiPackage } = await import("../src/server/anki.ts");
const { createCardStore } = await import("../src/store/cards.ts");

after(() => {
	fs.rmSync(directory, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.LH_DATA_DIR;
	else process.env.LH_DATA_DIR = previousDataDir;
});

const basicDeck: AnkiDeck = {
	name: "Spanish verbs",
	noteType: {
		name: "Connla Spanish verb",
		kind: "basic",
		fields: ["Front", "Back"],
		templates: [{ name: "Card 1", front: "{{Front}}", back: "{{FrontSide}}<hr id=\"answer\">{{Back}}" }],
		css: ".card { font-family: sans-serif; }",
	},
	cards: [{ fields: { Front: "<b>hablar</b>", Back: "to speak" }, tags: ["spanish", "verb"] }],
};

const clozeDeck: AnkiDeck = {
	name: "Cloze test",
	noteType: {
		name: "Connla cloze",
		kind: "cloze",
		fields: ["Text", "Extra"],
		templates: [{ name: "Cloze", front: "{{cloze:Text}}", back: "{{cloze:Text}}<br>{{Extra}}" }],
	},
	cards: [{ fields: { Text: "{{c1::uno}} and {{c2::dos}}", Extra: "numbers" } }],
};

function zipEntries(data: Buffer): Map<string, Buffer> {
	const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	assert.notEqual(eocd, -1, "zip has an end-of-central-directory record");
	const count = data.readUInt16LE(eocd + 10);
	let offset = data.readUInt32LE(eocd + 16);
	const out = new Map<string, Buffer>();
	for (let index = 0; index < count; index += 1) {
		assert.equal(data.readUInt32LE(offset), 0x02014b50);
		const nameLength = data.readUInt16LE(offset + 28);
		const extraLength = data.readUInt16LE(offset + 30);
		const commentLength = data.readUInt16LE(offset + 32);
		const localOffset = data.readUInt32LE(offset + 42);
		const name = data.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
		assert.equal(data.readUInt32LE(localOffset), 0x04034b50);
		const localName = data.readUInt16LE(localOffset + 26);
		const localExtra = data.readUInt16LE(localOffset + 28);
		const size = data.readUInt32LE(localOffset + 18);
		const start = localOffset + 30 + localName + localExtra;
		out.set(name, data.subarray(start, start + size));
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return out;
}

function readCollection(deck: AnkiDeck) {
	const built = buildAnkiCollection(deck);
	const file = path.join(directory, `collection-${Date.now()}-${Math.random()}.anki2`);
	fs.writeFileSync(file, built.data);
	const db = new DatabaseSync(file);
	try {
		return { built, db };
	} catch (error) {
		db.close();
		throw error;
	}
}

test("validates an authored deck and normalizes tags", () => {
	assert.deepEqual(ankiDeckProblems(basicDeck), []);
	const clean = normalizeAnkiDeck({
		...basicDeck,
		name: "  Spanish verbs  ",
		cards: [{ fields: { Front: " hablar ", Back: " to speak " }, tags: [" spanish ", "#verb", "two words"] }],
	});
	assert.equal(clean.name, "Spanish verbs");
	assert.equal(clean.noteType.kind, "basic");
	assert.deepEqual(clean.cards[0]!.tags, ["spanish", "verb", "two_words"]);
	assert.equal(clean.cards[0]!.fields.Front, " hablar ");
});

test("rejects unknown fields, unsupported filters, and cloze/basic mismatch", () => {
	const unknown = ankiDeckProblems({
		...basicDeck,
		noteType: {
			...basicDeck.noteType,
			templates: [{ name: "Card 1", front: "{{Missing}}", back: "{{Back}}" }],
		},
	});
	assert(unknown.some((problem) => problem.includes("Missing")));

	const filter = ankiDeckProblems({
		...basicDeck,
		noteType: {
			...basicDeck.noteType,
			templates: [{ name: "Card 1", front: "{{tts:Front}}", back: "{{Back}}" }],
		},
	});
	assert(filter.some((problem) => problem.includes("tts")));

	const mismatch = ankiDeckProblems({
		...basicDeck,
		noteType: {
			...basicDeck.noteType,
			templates: [{ name: "Card 1", front: "{{cloze:Front}}", back: "{{Back}}" }],
		},
	});
	assert(mismatch.some((problem) => problem.includes("cloze")));

	const clozeWithoutDeletion = ankiDeckProblems({
		...clozeDeck,
		cards: [{ fields: { Text: "no deletion", Extra: "" } }],
	});
	assert(clozeWithoutDeletion.some((problem) => problem.includes("cloze deletion")));
});

test("renders templates, sections, filters, and cloze", () => {
	const fields = { Front: "<b>hola</b>", Back: "", Text: "{{c1::uno}} and {{c2::dos}}" };
	assert.equal(renderAnkiTemplate("{{Front}}", fields, { deckName: "D", tags: [], cardName: "C" }), "<b>hola</b>");
	assert.equal(renderAnkiTemplate("{{text:Front}}", fields, { deckName: "D", tags: [], cardName: "C" }), "hola");
	assert.equal(renderAnkiTemplate("{{#Back}}yes{{/Back}}{{^Back}}no{{/Back}}", fields, { deckName: "D", tags: [], cardName: "C" }), "no");
	assert.equal(renderAnkiTemplate("{{FrontSide}}", fields, { deckName: "D", tags: [], cardName: "C", frontSide: "FRONT" }), "FRONT");
	assert.equal(renderAnkiTemplate("{{Deck}} / {{Card}} / {{Tags}}", fields, { deckName: "D::Sub", tags: ["a", "b"], cardName: "C" }), "D::Sub / C / a b");
	assert.equal(renderAnkiCloze("{{c1::uno}} and {{c2::dos}}", false, 0), "[…] and dos");
	assert.equal(renderAnkiCloze("{{c1::uno}} and {{c2::dos}}", true, 0), "uno and dos");
	assert.equal(stripAnkiHtml("<b>hola</b>&nbsp;mundo"), "hola mundo");
});

test("builds a schema-11 basic collection with one note and card", () => {
	const { built, db } = readCollection(basicDeck);
	try {
		const col = db.prepare("SELECT ver, crt, mod, scm, conf, models, decks FROM col").get() as Record<string, unknown>;
		assert.equal(col.ver, 11);
		assert.equal(typeof col.crt, "number");
		assert.equal(typeof col.mod, "number");
		const models = JSON.parse(String(col.models)) as Record<string, { type: number; fields?: unknown; flds: unknown[]; tmpls: unknown[]; req: unknown }>;
		const model = Object.values(models)[0]!;
		assert.equal(model.type, 0);
		assert.equal(model.flds.length, 2);
		assert.equal(model.tmpls.length, 1);
		assert.deepEqual(model.req, [[0, "all", [0, 1]]]);
		const notes = db.prepare("SELECT guid, flds, sfld, csum, tags FROM notes").all() as Record<string, unknown>[];
		assert.equal(notes.length, 1);
		assert.equal(notes[0]!.flds, "<b>hablar</b>\u001fto speak");
		assert.equal(notes[0]!.sfld, "hablar");
		assert.equal(notes[0]!.tags, " spanish verb ");
		assert.match(String(notes[0]!.guid), /^[0-9a-f]{10}$/);
		assert(Number(notes[0]!.csum) > 0);
		const cards = db.prepare("SELECT nid, did, ord, due, type, queue FROM cards").all() as Record<string, unknown>[];
		assert.equal(cards.length, 1);
		assert.equal(cards[0]!.ord, 0);
		assert.equal(cards[0]!.due, 1);
		assert.equal(cards[0]!.type, 0);
		assert.equal(cards[0]!.queue, 0);
		assert.equal(built.noteCount, 1);
		assert.equal(built.cardCount, 1);
		const conf = JSON.parse(String(col.conf)) as { nextPos: number };
		assert.equal(conf.nextPos, 2);
	} finally {
		db.close();
	}
});

test("builds one card per cloze ordinal and a cloze model", () => {
	assert.deepEqual(parseAnkiClozeOrds(clozeDeck.cards[0]!), [0, 1]);
	const { built, db } = readCollection(clozeDeck);
	try {
		const col = db.prepare("SELECT models FROM col").get() as { models: string };
		const model = Object.values(JSON.parse(col.models) as Record<string, { type: number; req: unknown }>)[0]!;
		assert.equal(model.type, 1);
		assert.deepEqual(model.req, []);
		const cards = db.prepare("SELECT ord FROM cards ORDER BY ord").all() as { ord: number }[];
		assert.deepEqual(cards.map((card) => card.ord), [0, 1]);
		assert.equal(built.noteCount, 1);
		assert.equal(built.cardCount, 2);
	} finally {
		db.close();
	}
});

test("packages media in the apkg zip and inlines it in the preview", () => {
	const deck: AnkiDeck = {
		...basicDeck,
		noteType: {
			...basicDeck.noteType,
			fields: ["Front", "Back", "Image"],
			templates: [{ name: "Card 1", front: "{{Front}}<img src=\"diagram.png\">", back: "{{Back}}" }],
			css: ".card { color: red; }",
		},
		cards: [{ fields: { Front: "hola", Back: "hello", Image: "" } }],
	};
	const media = [{ filename: "diagram.png", data: new Uint8Array([1, 2, 3]), mime: "image/png" }];
	const built = buildAnkiPackage(deck, media);
	const entries = zipEntries(built.data);
	assert(entries.has("collection.anki2"));
	assert.deepEqual(JSON.parse(entries.get("media")!.toString()), { "0": "diagram.png" });
	assert.deepEqual([...entries.get("0")!], [1, 2, 3]);
	assert.equal(built.mediaNames[0], "diagram.png");

	const preview = renderAnkiPreviewHtml(deck, new Map([["diagram.png", { mime: "image/png", data: new Uint8Array([1, 2, 3]) }]]));
	assert.match(preview, /data:image\/png;base64,AQID/);
	assert.match(preview, /\.card \{ color: red; \}/);
	assert.match(preview, /hola/);
});

test("stores queued cards with source audio and deletes both row and clip", () => {
	const store = createCardStore();
	const card = store.addCard({
		kind: "translation",
		front: "hablar",
		back: "to speak",
		note: "regular -ar verb",
		language: "es",
		target: "en",
		source: { chatId: "chat-1", messageId: "m-1" },
		audio: { text: "hablar", language: "es", data: new Uint8Array([9, 8, 7]) },
	});
	assert.equal(store.listCards().length, 1);
	assert.equal(card.audio?.file, `${card.id}.mp3`);
	assert.deepEqual([...store.readCardMedia(card.id)!.data], [9, 8, 7]);
	assert.equal(store.deleteCard(card.id), true);
	assert.equal(store.listCards().length, 0);
	assert.equal(store.readCardMedia(card.id), null);
});

test("sendQuickCard creates the deck/model, stores audio, and posts one note", async () => {
	const actions: string[] = [];
	let addNote: Record<string, unknown> | null = null;
	const server = createServer((request, response) => {
		let raw = "";
		request.setEncoding("utf8");
		request.on("data", (chunk) => (raw += chunk));
		request.on("end", () => {
			const body = JSON.parse(raw) as { action: string; params: Record<string, unknown> };
			actions.push(body.action);
			let result: unknown = null;
			if (body.action === "deckNames") result = ["Default", "Spanish"];
			else if (body.action === "modelNames") result = ["Connla Quick Card"];
			else if (body.action === "modelFieldNames") result = ["Front", "Back", "Note", "Audio"];
			else if (body.action === "storeMediaFile") result = body.params.filename;
			else if (body.action === "addNote") {
				addNote = body.params.note as Record<string, unknown>;
				result = 42;
			}
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ result, error: null }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	process.env.LH_ANKI_CONNECT_URL = `http://127.0.0.1:${port}`;
	try {
		const { sendQuickCard } = await import("../src/server/anki-connect.ts");
		const card: FlashcardRecord = {
			id: "fc_test",
			kind: "translation",
			front: "hablar",
			back: "to speak",
			note: "",
			language: "es",
			target: "en",
			audio: { text: "hablar", language: "es", file: "fc_test.mp3" },
			source: { chatId: null, messageId: null },
			createdAt: new Date().toISOString(),
		};
		const sent = await sendQuickCard(card, "Spanish", { filename: "fc_test.mp3", data: new Uint8Array([1, 2]) });
		assert.equal(sent.noteId, 42);
		assert.deepEqual(actions, ["deckNames", "modelNames", "modelFieldNames", "storeMediaFile", "addNote"]);
		assert.equal((addNote as Record<string, unknown> | null)?.deckName, "Spanish");
		const fields = (addNote as { fields: Record<string, string> } | null)?.fields;
		assert.equal(fields?.Audio, "[sound:fc_test.mp3]");
		assert.match(fields?.Front ?? "", /hablar/);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
