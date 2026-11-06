import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

// Isolate the data dir before config.ts is first imported: the store reads
// config.GLOSSARY_FILE etc. at module load.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connla-library-"));
process.env.LH_DATA_DIR = dir;

const { MAX_GLOSSARY_CHARS, normalizeLanguage, parseGeneratedDefinition, readingKey } = await import(
	"../src/core/library.ts"
);
const { createLibraryStore } = await import("../src/store/library.ts");

after(() => fs.rmSync(dir, { recursive: true, force: true }));

// ─── Pure helpers ───────────────────────────────────────────────────────────

test("parseGeneratedDefinition reads strict JSON", () => {
	const parsed = parseGeneratedDefinition(
		'{"term":"manger","language":"fr","partOfSpeech":"verb","definition":"to eat"}',
		"fr",
	);
	assert.deepEqual(parsed, {
		term: "manger",
		language: "fr",
		partOfSpeech: "verb",
		definition: "to eat",
	});
});

test("parseGeneratedDefinition strips a code fence and prose around the object", () => {
	const parsed = parseGeneratedDefinition(
		'Here you go:\n```json\n{"term":"suis","language":"fr","partOfSpeech":"verb","definition":"am"}\n```',
		"fr",
	);
	assert.equal(parsed?.term, "suis");
	assert.equal(parsed?.language, "fr");
});

test("parseGeneratedDefinition rejects answers without a term or definition", () => {
	assert.equal(parseGeneratedDefinition('{"term":"","definition":"x"}'), null);
	assert.equal(parseGeneratedDefinition('{"term":"x","definition":""}'), null);
	assert.equal(parseGeneratedDefinition("not json"), null);
	assert.equal(parseGeneratedDefinition(""), null);
});

test("parseGeneratedDefinition falls back to the hinted language and clamps the definition", () => {
	const parsed = parseGeneratedDefinition(
		JSON.stringify({ term: "bonjour", language: "xx", definition: "a".repeat(900) }),
		"fr",
	);
	assert.equal(parsed?.language, "fr");
	assert.equal(parsed?.definition.length, 600);
});

test("normalizeLanguage only accepts the supported base codes", () => {
	assert.equal(normalizeLanguage("fr-FR"), "fr");
	assert.equal(normalizeLanguage("PT_pt"), "pt");
	assert.equal(normalizeLanguage("gd"), "gd");
	assert.equal(normalizeLanguage("de"), "en");
	assert.equal(normalizeLanguage("klingon", "fr"), "fr");
});

test("readingKey ignores scheme, www, query, and trailing slash", () => {
	const key = readingKey("Book", "https://www.example.com/a/?q=1#x");
	assert.equal(key, "url:example.com/a");
	assert.equal(readingKey("Book", "http://example.com/a"), key);
	assert.equal(readingKey("  Book Title ", ""), "title:book title");
});

test("a glossary term cap is exposed to the routes", () => {
	assert.equal(MAX_GLOSSARY_CHARS, 160);
});

// ─── Store round-trip ───────────────────────────────────────────────────────

test("library store round-trips glossary, highlights, and reading items", () => {
	const store = createLibraryStore();

	const glossary = store.addGlossary({
		term: "manger",
		form: "mangeais",
		language: "fr",
		partOfSpeech: "verb",
		definition: "to eat",
		source: { chatId: "chat_1", messageId: "msg_1" },
	});
	assert.match(glossary.id, /^gla_/);
	assert.equal(store.listGlossary().length, 1);
	assert.equal(store.findGlossary("Manger", "fr")?.id, glossary.id);

	const updated = store.updateGlossary(glossary.id, { definition: "to eat (food)" });
	assert.equal(updated?.definition, "to eat (food)");
	assert.equal(store.findGlossary("manger", "fr")?.definition, "to eat (food)");

	const highlight = store.addHighlight({
		text: "Je mangeais une pomme.",
		language: "fr",
		source: { chatId: "chat_1", messageId: "msg_2" },
	});
	assert.match(highlight.id, /^hl_/);
	assert.equal(store.listHighlights()[0]?.text, "Je mangeais une pomme.");
	assert.equal(store.deleteHighlight(highlight.id), true);
	assert.equal(store.listHighlights().length, 0);

	const item = store.addReading({
		title: "Le Petit Prince",
		author: "Saint-Exupéry",
		url: "https://example.com/petit-prince",
		note: "Short chapters.",
		source: { chatId: null, messageId: null },
	});
	assert.match(item.id, /^rd_/);
	const edited = store.updateReading(item.id, { note: "Read one chapter a day." });
	assert.equal(edited?.note, "Read one chapter a day.");
	assert.equal(store.deleteReading(item.id), true);
	assert.equal(store.listReading().length, 0);

	assert.equal(store.deleteGlossary(glossary.id), true);
	assert.equal(store.listGlossary().length, 0);
});

test("library store skips a corrupt line instead of throwing", () => {
	const file = path.join(dir, "glossary.jsonl");
	fs.writeFileSync(
		file,
		'{"id":"gla_keep","term":"être","form":"suis","language":"fr","partOfSpeech":"verb","definition":"to be","source":{"chatId":null,"messageId":null},"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}\n{not json\n',
	);
	const store = createLibraryStore();
	assert.equal(store.listGlossary().length, 1);
	assert.equal(store.listGlossary()[0]?.term, "être");
});
