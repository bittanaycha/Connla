/**
 * Edge Read Aloud (Edge TTS) — the free default voice (library wave).
 *
 * This is the consumer endpoint the Edge browser's read-aloud uses, not an
 * official API: a WebSocket to api.msedgeservices.com, authenticated with
 * the well-known client token plus the v2 Sec-MS-GEC token (a CS64/SHA-256
 * pair over the current 5-minute window). Ported from the maintained
 * TypeScript implementation in readest (edgeTTS.ts), which in turn follows
 * rany2/edge-tts PR #492.
 *
 * The mp3 bytes are cached on disk under config.TTS_CACHE_DIR keyed by
 * language + text. Synthesis failures surface as thrown errors; the route
 * maps them to 502 and the client falls back to the OS voice, then Forvo.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";
import { TTS_CACHE_DIR } from "../../config.ts";
import { EDGE_VOICES, type PronounceLanguage } from "../core/pronounce.ts";

const EDGE_SPEECH_URL = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
const EDGE_API_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_MAJOR_VERSION = 143;
const SEC_MS_GEC_VERSION = "2-143.0.3650.75";
const CACHE_VERSION = "edge-v2-1";

const WIN_EPOCH_OFFSET = 11644473600; // seconds from 1601-01-01 to 1970-01-01
const TICKS_PER_SECOND = 10_000_000n; // 100-nanosecond intervals
const GEC_PREFIX_WORDS = [
	0x79706f43, 0x68676972, 0x43282074, 0x694d2029, 0x736f7263, 0x2074666f, 0x70726f43, 0x7461726f,
	0x2e6e6f69, 0x6c6c4120, 0x67697220, 0x20737468, 0x65736572, 0x64657672, 0x0000002e,
];
const GEC_PREFIX_LENGTH = 57;

const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();

const rol16 = (x: number): number => ((x << 16) | (x >>> 16)) >>> 0;

/** Little-endian 32-bit words, zero-padded to an even word count. */
function toWords(bytes: Uint8Array): number[] {
	const padded = new Uint8Array(Math.ceil(bytes.length / 8) * 8);
	padded.set(bytes);
	const view = new DataView(padded.buffer);
	return Array.from({ length: padded.length / 4 }, (_, i) => view.getUint32(i * 4, true));
}

/** The first CS64 chain (word swap). */
function cs64WordSwap(words: number[], a: number, b: number): [number, number] {
	let acc = 0;
	let last = 0;
	for (let i = 0; i < words.length; i += 2) {
		const x = words[i]!;
		const y = words[i + 1]!;
		let t = rol16((Math.imul(rol16(x), 0xef0569fb) + Math.imul(x, a)) >>> 0);
		let q = Math.imul(t, 0x76f50f34) >>> 0;
		acc = (acc + Math.imul(rol16(q), 0xc3efea97) + q) >>> 0;
		t = rol16((Math.imul(rol16(y), 0xc31713db) + Math.imul(y, b)) >>> 0);
		q = Math.imul(t, 0x1881ce3c) >>> 0;
		last = (Math.imul(rol16(q), 0x35bd1ec9) + q) >>> 0;
		acc = (acc + last) >>> 0;
	}
	return [last, acc];
}

/** The second CS64 chain (reversible). */
function cs64Reversible(words: number[], a: number, b: number): [number, number] {
	let state = 0;
	let acc = 0;
	for (let i = 0; i < words.length; i += 2) {
		state = Math.imul(state + words[i]!, a) >>> 0;
		for (const c of [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]) {
			state = Math.imul(rol16(state), c) >>> 0;
		}
		let t = Math.imul(words[i + 1]! + state, b) >>> 0;
		t = Math.imul(rol16(t), 0xa27416f5) >>> 0;
		t = rol16(Math.imul(rol16(t), 0xd38396ff) >>> 0);
		acc = (acc + state) >>> 0;
		state = Math.imul(rol16(Math.imul(t, 0x7c932b89) >>> 0), 0xbfa49f69) >>> 0;
		acc = (acc + state) >>> 0;
	}
	return [state, acc];
}

/**
 * The v2 Sec-MS-GEC token: `CS64-SHA256` over the 57-byte prefix plus the
 * Windows file time (rounded down to 5 minutes) and the client token.
 * Exported for the token test vector.
 */
export function generateSecMsGec(now: number = Date.now()): string {
	let ticks = Math.floor(now / 1000) + WIN_EPOCH_OFFSET;
	ticks -= ticks % 300;
	const windowsTicks = (BigInt(ticks) * TICKS_PER_SECOND).toString();
	const suffix = new TextEncoder().encode(`${windowsTicks}${EDGE_API_TOKEN}`);
	const data = new Uint8Array(GEC_PREFIX_LENGTH + suffix.length);
	const view = new DataView(data.buffer);
	GEC_PREFIX_WORDS.forEach((word, i) => view.setUint32(i * 4, word, true));
	data.set(suffix, GEC_PREFIX_LENGTH);

	const digest = new Uint8Array(createHash("sha256").update(data).digest());
	const words = toWords(data);
	const [key0, key1] = toWords(digest);
	const a = (key0! | 1) >>> 0;
	const b = (key1! | 1) >>> 0;
	const [s0, s1] = cs64WordSwap(words, a, b);
	const [r0, r1] = cs64Reversible(words, a, b);
	const cs64 = new DataView(new ArrayBuffer(8));
	cs64.setUint32(0, (s0 ^ r0) >>> 0, true);
	cs64.setUint32(4, (s1 ^ r1) >>> 0, true);
	return `${toHex(new Uint8Array(cs64.buffer))}-${toHex(digest)}`;
}

function generateMuid(): string {
	return randomBytes(16).toString("hex").toUpperCase();
}

export function edgeVoiceFor(language: string): string | null {
	return EDGE_VOICES[language as PronounceLanguage] ?? null;
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function ssml(text: string, language: string, voice: string): string {
	return (
		`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${language}'>` +
		`<voice name='${voice}'><prosody rate='+0%' pitch='+0Hz'>${escapeXml(text)}</prosody></voice></speak>`
	);
}

function frame(headers: Record<string, string>, body: string): string {
	const head = Object.entries(headers)
		.map(([key, value]) => `${key}: ${value}\r\n`)
		.join("");
	return `${head}\r\n${body}`;
}

interface SynthResult {
	audio: Buffer;
}

function synthesizeOnce(text: string, language: string, voice: string): Promise<SynthResult> {
	const connectionId = randomBytes(16).toString("hex");
	const params = new URLSearchParams({
		ConnectionId: connectionId,
		"Ocp-Apim-Subscription-Key": EDGE_API_TOKEN,
		"Sec-MS-GEC": generateSecMsGec(),
		"Sec-MS-GEC-Version": SEC_MS_GEC_VERSION,
	});
	const url = `${EDGE_SPEECH_URL}?${params.toString()}`;
	const date = new Date().toString();
	const config = frame(
		{
			"Content-Type": "application/json; charset=utf-8",
			Path: "speech.config",
			"X-Timestamp": date,
		},
		JSON.stringify({
			context: {
				synthesis: {
					audio: {
						metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
						outputFormat: "audio-24khz-48kbitrate-mono-mp3",
					},
				},
			},
		}),
	);
	const content = frame(
		{
			"Content-Type": "application/ssml+xml",
			Path: "ssml",
			"X-RequestId": connectionId,
			"X-Timestamp": date,
		},
		ssml(text, language, voice),
	);

	return new Promise<SynthResult>((resolve, reject) => {
		const chunks: Buffer[] = [];
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const ws = new WebSocket(url, {
			headers: {
				"User-Agent":
					`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
					`Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
				"Accept-Language": "en-US,en;q=0.9",
				Pragma: "no-cache",
				"Cache-Control": "no-cache",
				Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
				Cookie: `muid=${generateMuid()};`,
			},
			perMessageDeflate: false,
		});

		const finish = (error?: Error): void => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			try {
				ws.terminate();
			} catch {
				// already gone
			}
			if (error) reject(error);
			else resolve({ audio: Buffer.concat(chunks) });
		};

		const arm = (): void => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => finish(new Error("Edge TTS timed out.")), 20_000);
		};

		ws.on("open", () => {
			arm();
			ws.send(config);
			ws.send(content);
		});

		ws.on("message", (data, isBinary) => {
			arm();
			if (!isBinary) {
				const message = data.toString();
				// Text frames carry only headers; turn.end is the last one.
				if (message.includes("Path:turn.end")) finish();
				return;
			}
			const buffer = Buffer.isBuffer(data)
				? data
				: Array.isArray(data)
					? Buffer.concat(data)
					: Buffer.from(data as ArrayBuffer);
			if (buffer.length < 2) return;
			const headerLength = buffer.readUInt16BE(0);
			if (buffer.length > headerLength + 2) {
				chunks.push(buffer.subarray(headerLength + 2));
			}
		});

		ws.on("unexpected-response", (_request, response) => {
			const status = response.statusCode ?? 0;
			finish(new Error(`Edge TTS HTTP ${status}`));
		});

		ws.on("error", (error) => {
			finish(error instanceof Error ? error : new Error(String(error)));
		});

		ws.on("close", () => {
			finish(new Error("Edge TTS closed before the audio finished."));
		});
	});
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function synthesizeWithRetry(text: string, language: string, voice: string): Promise<Buffer> {
	try {
		const { audio } = await synthesizeOnce(text, language, voice);
		if (!audio.length) throw new Error("Edge TTS returned no audio.");
		return audio;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes("429")) throw error;
		await sleep(1500);
		const { audio } = await synthesizeOnce(text, language, voice);
		if (!audio.length) throw new Error("Edge TTS returned no audio.");
		return audio;
	}
}

function cacheFile(language: string, text: string, voice: string): string {
	const digest = createHash("sha256")
		.update(`${CACHE_VERSION}\0${voice}\0${text}`)
		.digest("hex");
	return path.join(TTS_CACHE_DIR, language, `${digest}.mp3`);
}

/**
 * The route entry: return cached mp3 bytes, or synthesize, cache, and
 * return. Concurrent requests for the same text may both synthesize; the
 * rename makes the cache write atomic either way.
 */
export async function synthesizeEdge(
	text: string,
	language: PronounceLanguage,
): Promise<{ audio: Buffer; voice: string }> {
	const voice = edgeVoiceFor(language);
	if (!voice) throw new Error(`no_voice:${language}`);
	const file = cacheFile(language, text, voice);
	try {
		const cached = fs.readFileSync(file);
		if (cached.length) return { audio: cached, voice };
	} catch {
		// cache miss
	}
	const audio = await synthesizeWithRetry(text, language, voice);
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
		fs.writeFileSync(tmp, audio);
		fs.renameSync(tmp, file);
	} catch {
		// A cache write failure must not fail the request.
	}
	return { audio, voice };
}

/** The token generator is the only part worth a unit test; keep the vector honest. */
export const EDGE_SEC_MS_GEC_TEST_VECTOR = {
	timestamp: 1791888000 * 1000,
	token: "492D7694A183A45E-56E821F95D4579C5B7C7E33DC7303FF379EC36D510213555BBBB9EB17EF15876",
} as const;
