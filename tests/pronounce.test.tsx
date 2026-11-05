import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PronounceWord } from "../components/pronounce.tsx";
import { ExternalLink } from "../components/link-preview.tsx";
import { forvoApiLanguage, forvoSearchUrl, isPronounceLanguage } from "../src/core/pronounce.ts";
import { fetchForvoPronunciation } from "../src/server/forvo.ts";

test("Forvo search links use Forvo's language slugs", () => {
	assert.equal(forvoSearchUrl("bonjour", "fr"), "https://forvo.com/search/bonjour/fr/");
	assert.equal(forvoSearchUrl("gretar", "pt"), "https://forvo.com/search/gretar/pt_other/");
	assert.equal(forvoApiLanguage("pt"), "pt_pt", "the API's European Portuguese slug");
	assert.equal(forvoSearchUrl("中文", "zh"), "https://forvo.com/search/%E4%B8%AD%E6%96%87/zh/");
	assert.equal(isPronounceLanguage("gd"), true);
	assert.equal(isPronounceLanguage("de"), false);
});

test("Forvo lookup returns the first playable recording as base64", async () => {
	const original = globalThis.fetch;
	const calls: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		calls.push(url);
		if (url.startsWith("https://apifree.forvo.com/")) {
			return Response.json({
				items: [
					{ pathmp3: "https://audio.forvo.com/bonjour.mp3", username: "Alice" },
					{ pathmp3: "https://audio.forvo.com/bonjour-2.mp3", username: "Bob" },
				],
			});
		}
		if (url === "https://audio.forvo.com/bonjour.mp3") {
			return new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "audio/mpeg" },
			});
		}
		return new Response(null, { status: 404 });
	};
	try {
		const result = await fetchForvoPronunciation("bonjour", "fr", "test-key");
		assert.ok(result);
		assert.equal(result.audio, Buffer.from([1, 2, 3]).toString("base64"));
		assert.equal(result.mimeType, "audio/mpeg");
		assert.equal(result.speaker, "Alice");
		assert.match(result.forvoUrl, /^https:\/\/forvo\.com\/search\/bonjour\/fr\/$/);
		assert.ok(calls[0]!.startsWith("https://apifree.forvo.com/key/test-key/"));
		assert.ok(calls[0]!.includes("language/fr/"));
	} finally {
		globalThis.fetch = original;
	}
});

test("pronounce word renders a speaker and the free Forvo link", () => {
	const html = renderToStaticMarkup(React.createElement(PronounceWord, { word: "bonjour", lang: "fr" }));
	assert.match(html, /Hear bonjour in French/);
	assert.match(html, /https:\/\/forvo\.com\/search\/bonjour\/fr\//);
	assert.match(html, />Forvo</);
});

test("external links render as anchors", () => {
	const html = renderToStaticMarkup(
		React.createElement(ExternalLink, { href: "https://example.com/", children: "Example" }),
	);
	assert.match(html, /href="https:\/\/example\.com\/"/);
	assert.match(html, />Example</);
});
