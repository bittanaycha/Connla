import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-azure-"));
const previousDataDir = process.env.LH_DATA_DIR;
process.env.LH_DATA_DIR = path.join(directory, "data");
process.env.AZURE_SPEECH_KEY = "0123456789abcdef0123456789abcdef";
process.env.AZURE_SPEECH_REGION = "westeurope";

const { hasAzureSpeech, synthesizeAzure, AzureSpeechError } = await import("../src/server/azure-tts.ts");

const originalFetch = globalThis.fetch;
after(() => {
	globalThis.fetch = originalFetch;
	delete process.env.AZURE_SPEECH_KEY;
	delete process.env.AZURE_SPEECH_REGION;
	if (previousDataDir === undefined) delete process.env.LH_DATA_DIR;
	else process.env.LH_DATA_DIR = previousDataDir;
	fs.rmSync(directory, { recursive: true, force: true });
});

test("Azure configuration requires both key and region", () => {
	assert.equal(hasAzureSpeech(), true);
	delete process.env.AZURE_SPEECH_REGION;
	assert.equal(hasAzureSpeech(), false);
	process.env.AZURE_SPEECH_REGION = "westeurope";
});

test("synthesizeAzure returns mp3 bytes and sends the mapped voice", async () => {
	let request: { url: string; init?: RequestInit } | null = null;
	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		request = { url: String(url), init };
		return new Response(new Uint8Array([0xff, 0xf3, 0x64]), { status: 200 });
	}) as typeof fetch;
	const result = await synthesizeAzure("bore da", "cy");
	assert.equal(result.voice, "cy-GB-NiaNeural");
	assert.deepEqual([...result.audio], [0xff, 0xf3, 0x64]);
	assert.match(request!.url, /^https:\/\/westeurope\.tts\.speech\.microsoft\.com\//);
	assert.equal((request!.init?.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"], process.env.AZURE_SPEECH_KEY);
	assert.match(String(request!.init?.body), /cy-GB-NiaNeural/);
});

test("synthesizeAzure maps a rejected key to unauthorized", async () => {
	globalThis.fetch = (async () => new Response("denied", { status: 401 })) as typeof fetch;
	await assert.rejects(
		() => synthesizeAzure("prynhawn da", "cy"),
		(error: unknown) => error instanceof AzureSpeechError && error.code === "unauthorized" && error.status === 401,
	);
});
