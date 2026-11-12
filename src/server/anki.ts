/**
 * .apkg writer (Anki wave). Anki's import format is a ZIP holding a
 * schema-11 SQLite collection plus an optional media map:
 *
 *   collection.anki2  the collection DB
 *   media             {"0":"clip.mp3","1":"diagram.png"}
 *   0, 1, …           the media bytes, named by their media-map index
 *
 * We build the collection in a temp file with node:sqlite (Node 24 bundles
 * it; the Electron server runs on Node 24), then store-only ZIP it. The
 * package is self-contained and standalone per export.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	ankiTemplateFields,
	parseAnkiClozeOrds,
	renderAnkiPreviewHtml,
	renderAnkiTemplate,
	sanitizeAnkiMediaName,
	stripAnkiHtml,
	type AnkiCard,
	type AnkiDeck,
	type AnkiExportDetails,
	type AnkiMediaFile,
	type AnkiNoteType,
} from "../core/anki.ts";
import { PATHS } from "../../config.ts";

const SCHEMA = `
CREATE TABLE col (
  id integer primary key,
  crt integer not null,
  mod integer not null,
  scm integer not null,
  ver integer not null,
  dty integer not null,
  usn integer not null,
  ls integer not null,
  conf text not null,
  models text not null,
  decks text not null,
  dconf text not null,
  tags text not null
);
CREATE TABLE notes (
  id integer primary key,
  guid text not null,
  mid integer not null,
  mod integer not null,
  usn integer not null,
  tags text not null,
  flds text not null,
  sfld integer not null,
  csum integer not null,
  flags integer not null,
  data text not null
);
CREATE TABLE cards (
  id integer primary key,
  nid integer not null,
  did integer not null,
  ord integer not null,
  mod integer not null,
  usn integer not null,
  type integer not null,
  queue integer not null,
  due integer not null,
  ivl integer not null,
  factor integer not null,
  reps integer not null,
  lapses integer not null,
  left integer not null,
  odue integer not null,
  odid integer not null,
  flags integer not null,
  data text not null
);
CREATE TABLE revlog (
  id integer primary key,
  cid integer not null,
  usn integer not null,
  ease integer not null,
  ivl integer not null,
  lastIvl integer not null,
  factor integer not null,
  time integer not null,
  type integer not null
);
CREATE TABLE graves (
  usn integer not null,
  oid integer not null,
  type integer not null
);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

const DEFAULT_CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 20px;
  line-height: 1.45;
  text-align: center;
  color: #1a1a19;
  background: #ffffff;
  padding: 16px;
}
.cloze { font-weight: 600; color: #2563eb; }
hr#answer { border: 0; border-top: 1px solid #d4d4d4; margin: 14px 0; }
.note { font-size: 14px; color: #555; margin-top: 10px; }
.audio { margin-top: 10px; }`;

const LATEX_PRE = "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";
const LATEX_POST = "\\end{document}";

function sha1(value: string | Uint8Array): Buffer {
	return crypto.createHash("sha1").update(value).digest();
}

function stableId(seed: string): number {
	const digest = sha1(`connla-anki:${seed}`);
	// A 6-byte slice stays a safe JS integer and is ample for one deck/model.
	const value = digest.readUIntBE(0, 6);
	return value || 1;
}

function noteGuid(deck: AnkiDeck, card: AnkiCard, index: number): string {
	if (card.guid) return sha1(`connla-guid:${card.guid}`).toString("hex").slice(0, 10);
	// Without an explicit guid, the note's own content is its identity: a
	// repeated import of the same card updates instead of duplicating.
	const body = [deck.noteType.name, ...deck.noteType.fields.map((field) => card.fields[field] ?? "")].join("\u001f");
	const digest = sha1(`connla-note:${deck.name}\u001f${body}`).toString("hex").slice(0, 10);
	return digest || sha1(`connla-note:${index}`).toString("hex").slice(0, 10);
}

function fieldChecksum(value: string): number {
	const digest = sha1(stripAnkiHtml(value));
	return digest.readUInt32BE(0);
}

function templateReq(noteType: AnkiNoteType): [number, "all", number[]][] {
	if ((noteType.kind ?? "basic") === "cloze") return [];
	return noteType.templates.map((template, ord) => {
		const names = ankiTemplateFields(template.front + template.back).filter((name) =>
			noteType.fields.includes(name),
		);
		const indexes = [...new Set(names.map((name) => noteType.fields.indexOf(name)))];
		return [ord, "all", indexes.length ? indexes : [0]];
	});
}

function modelJson(deck: AnkiDeck, modelId: number, nowSeconds: number): Record<string, unknown> {
	const noteType = deck.noteType;
	const kind = noteType.kind ?? "basic";
	return {
		vers: [],
		name: noteType.name,
		tags: [],
		did: 0,
		usn: -1,
		req: templateReq(noteType),
		flds: noteType.fields.map((name, ord) => ({
			name,
			ord,
			font: "Arial",
			size: 20,
			media: [],
			rtl: false,
			sticky: false,
		})),
		sortf: 0,
		latexPre: LATEX_PRE,
		latexPost: LATEX_POST,
		tmpls: noteType.templates.map((template, ord) => ({
			name: template.name,
			ord,
			qfmt: template.front,
			afmt: template.back,
			did: null,
			bqfmt: "",
			bafmt: "",
		})),
		type: kind === "cloze" ? 1 : 0,
		id: modelId,
		css: noteType.css?.trim() || DEFAULT_CSS,
		mod: nowSeconds,
	};
}

function deckJson(deckId: number, name: string, nowSeconds: number): Record<string, unknown> {
	return {
		desc: "",
		name,
		extendRev: 50,
		usn: 0,
		collapsed: false,
		newToday: [0, 0],
		timeToday: [0, 0],
		dyn: 0,
		extendNew: 10,
		conf: 1,
		revToday: [0, 0],
		lrnToday: [0, 0],
		id: deckId,
		mod: nowSeconds,
	};
}

function dconfJson(): Record<string, unknown> {
	return {
		id: 1,
		name: "Default",
		mod: 0,
		usn: 0,
		maxTaken: 60,
		autoplay: true,
		timer: 0,
		replayq: true,
		rev: {
			perDay: 200,
			ivlFct: 1,
			ease4: 1.3,
			maxIvl: 36500,
			bury: true,
			hardFactor: 1.2,
		},
		new: {
			perDay: 20,
			delays: [1, 10],
			separate: true,
			order: 1,
			bury: true,
			ints: [1, 4, 7],
			initialFactor: 2500,
		},
		lapse: {
			delays: [10],
			mult: 0,
			minInt: 1,
			leechFails: 8,
			leechAction: 0,
		},
		dyn: false,
	};
}

/** Anki's day starts at 04:00 UTC in this writer; only the rollover stamp needs it. */
function collectionCrt(nowMs: number): number {
	const dayMs = 24 * 60 * 60 * 1000;
	const fourAmMs = 4 * 60 * 60 * 1000;
	return Math.floor((nowMs - fourAmMs) / dayMs) * (dayMs / 1000) + fourAmMs / 1000;
}

/** One note's cards: one per template (basic) or one per cloze ordinal. */
function cardOrds(noteType: AnkiNoteType, card: AnkiCard): number[] {
	if ((noteType.kind ?? "basic") === "cloze") return parseAnkiClozeOrds(card);
	return noteType.templates.map((_, ord) => ord);
}

interface CollectionBuild {
	data: Buffer;
	noteCount: number;
	cardCount: number;
}

/** Build just the SQLite collection; exported for tests. */
export function buildAnkiCollection(deck: AnkiDeck): CollectionBuild {
	const nowMs = Date.now();
	const nowSeconds = Math.floor(nowMs / 1000);
	const noteType = deck.noteType;
	const deckId = stableId(`deck:${deck.name}`);
	const modelId = stableId(`model:${noteType.name}`);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connla-anki-"));
	const file = path.join(dir, "collection.anki2");
	let noteCount = 0;
	let cardCount = 0;
	try {
		const db = new DatabaseSync(file);
		try {
			db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA page_size = 4096; PRAGMA encoding = 'UTF-8';");
			db.exec(SCHEMA);
			db.exec("BEGIN");
			try {
				const conf = {
					nextPos: 1,
					estTimes: true,
					activeDecks: [deckId],
					sortType: "noteFld",
					timeLim: 0,
					sortBackwards: false,
					addToCur: true,
					curDeck: deckId,
					newBury: true,
					newSpread: 0,
					dueCounts: true,
					curModel: modelId,
					collapseTime: 1200,
				};
				const confJson = JSON.stringify(conf);
				const modelsJson = JSON.stringify({ [String(modelId)]: modelJson(deck, modelId, nowSeconds) });
				const decksJson = JSON.stringify({ [String(deckId)]: deckJson(deckId, deck.name, nowSeconds) });
				const dconf = JSON.stringify({ "1": dconfJson() });
				db.prepare(
					"INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')",
				).run(collectionCrt(nowMs), nowMs, nowMs, confJson, modelsJson, decksJson, dconf);

				const insertNote = db.prepare(
					"INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')",
				);
				const insertCard = db.prepare(
					"INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')",
				);

				deck.cards.forEach((card, cardIndex) => {
					const noteId = cardIndex + 1;
					const values = noteType.fields.map((field) => card.fields[field] ?? "");
					const sfld = stripAnkiHtml(values[0] ?? "");
					const tags = ` ${(card.tags ?? []).join(" ")} `;
					insertNote.run(
						noteId,
						noteGuid(deck, card, cardIndex),
						modelId,
						nowSeconds,
						tags,
						values.join("\u001f"),
						sfld,
						fieldChecksum(values[0] ?? ""),
					);
					noteCount += 1;
					for (const ord of cardOrds(noteType, card)) {
						cardCount += 1;
						insertCard.run(cardCount, noteId, deckId, ord, nowSeconds, cardCount);
					}
				});
				db.prepare("UPDATE col SET conf = ?").run(JSON.stringify({ ...conf, nextPos: cardCount + 1 }));
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
			db.exec("ANALYZE;");
		} finally {
			db.close();
		}
		return { data: fs.readFileSync(file), noteCount, cardCount };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// ─── Store-only ZIP ─────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function dosStamp(date: Date): { time: number; date: number } {
	const year = Math.min(2107, Math.max(1980, date.getFullYear()));
	const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
	const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
	return { time, date: day };
}

interface ZipEntry {
	name: string;
	data: Uint8Array;
}

/** Store-only ZIP: no deflate needed, and every .apkg consumer accepts it. */
export function zipStore(entries: ZipEntry[]): Buffer {
	const stamp = dosStamp(new Date());
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "utf-8");
		const data = Buffer.from(entry.data);
		const crc = crc32(data);
		const local = Buffer.alloc(30 + name.length);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt16LE(stamp.time, 10);
		local.writeUInt16LE(stamp.date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		name.copy(local, 30);
		locals.push(local, data);

		const central = Buffer.alloc(46 + name.length);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt16LE(stamp.time, 12);
		central.writeUInt16LE(stamp.date, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(offset, 42);
		name.copy(central, 46);
		centrals.push(central);

		offset += local.length + data.length;
	}
	const centralBuffer = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralBuffer.length, 12);
	eocd.writeUInt32LE(offset, 16);
	eocd.writeUInt16LE(0, 20);
	return Buffer.concat([...locals, centralBuffer, eocd]);
}


export interface PackagedDeck {
	data: Buffer;
	noteCount: number;
	cardCount: number;
	mediaNames: string[];
}

/** Build the standalone .apkg bytes for one authored deck. */
export function buildAnkiPackage(deck: AnkiDeck, media: AnkiMediaFile[] = []): PackagedDeck {
	const collection = buildAnkiCollection(deck);
	const used = new Set<string>();
	const files: { filename: string; data: Uint8Array }[] = [];
	for (const item of media) {
		const filename = sanitizeAnkiMediaName(item.filename);
		if (used.has(filename)) continue;
		used.add(filename);
		files.push({ filename, data: item.data });
	}
	const mediaMap: Record<string, string> = {};
	for (const [index, file] of files.entries()) mediaMap[String(index)] = file.filename;
	const entries: ZipEntry[] = [
		{ name: "collection.anki2", data: collection.data },
		{ name: "media", data: Buffer.from(JSON.stringify(mediaMap), "utf-8") },
		...files.map((file, index) => ({ name: String(index), data: file.data })),
	];
	return {
		data: zipStore(entries),
		noteCount: collection.noteCount,
		cardCount: collection.cardCount,
		mediaNames: files.map((file) => file.filename),
	};
}


function mediaMime(name: string): string {
	const lower = name.toLowerCase();
	if (lower.endsWith(".mp3")) return "audio/mpeg";
	if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
	if (lower.endsWith(".wav")) return "audio/wav";
	if (lower.endsWith(".m4a")) return "audio/mp4";
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".svg")) return "image/svg+xml";
	return "application/octet-stream";
}

/** Write a self-contained deck plus its preview and return the artifact details. */
export function writeAnkiExport(deck: AnkiDeck, media: AnkiMediaFile[] = []): AnkiExportDetails {
	const id = crypto.randomBytes(8).toString("hex");
	const dir = path.join(PATHS.anki, id);
	fs.mkdirSync(dir, { recursive: true });
	const built = buildAnkiPackage(deck, media);
	fs.writeFileSync(path.join(dir, "deck.apkg"), built.data);
	const mediaMap = new Map<string, { mime: string; data: Uint8Array }>();
	for (const item of media) {
		const name = sanitizeAnkiMediaName(item.filename);
		if (mediaMap.has(name)) continue;
		mediaMap.set(name, { mime: item.mime ?? mediaMime(name), data: item.data });
	}
	fs.writeFileSync(path.join(dir, "preview.html"), renderAnkiPreviewHtml(deck, mediaMap), "utf-8");
	fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ deckName: deck.name }), "utf-8");
	return {
		deckName: deck.name,
		noteType: deck.noteType.name,
		noteCount: built.noteCount,
		cardCount: built.cardCount,
		mediaCount: built.mediaNames.length,
		downloadUrl: `/api/anki/${id}/download`,
		previewUrl: `/api/anki/${id}/preview`,
	};
}

/** The on-disk directory for an export id, or null when the id is not ours. */
export function ankiExportDir(id: string): string | null {
	return /^[a-f0-9]{16}$/.test(id) ? path.join(PATHS.anki, id) : null;
}
