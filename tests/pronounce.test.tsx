import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PronounceWord } from "../components/pronounce.tsx";
import { ExternalLink } from "../components/link-preview.tsx";
import {
	EDGE_VOICES,
	PRONOUNCE_LANGUAGES,
	forvoApiLanguage,
	forvoSearchUrl,
	hasEdgeVoice,
	isPronounceLanguage,
} from "../src/core/pronounce.ts";
import { EDGE_SEC_MS_GEC_TEST_VECTOR, generateSecMsGec } from "../src/server/edge-tts.ts";

test("Forvo search links use Forvo's language slugs", () => {
	assert.equal(forvoSearchUrl("bonjour", "fr"), "https://forvo.com/search/bonjour/fr/");
	assert.equal(forvoSearchUrl("gretar", "pt"), "https://forvo.com/search/gretar/pt_other/");
	assert.equal(forvoApiLanguage("pt"), "pt_pt", "the API's European Portuguese slug");
	assert.equal(forvoSearchUrl("中文", "zh"), "https://forvo.com/search/%E4%B8%AD%E6%96%87/zh/");
	assert.equal(isPronounceLanguage("gd"), true);
	assert.equal(isPronounceLanguage("de"), false);
});

test("Edge covers every language except Scottish Gaelic", () => {
	for (const language of PRONOUNCE_LANGUAGES) {
		assert.ok(EDGE_VOICES[language] !== undefined, `${language} has a voice entry`);
		assert.equal(hasEdgeVoice(language), language !== "gd", `${language} voice presence`);
	}
});

test("Sec-MS-GEC matches the Edge client vector", () => {
	assert.equal(
		generateSecMsGec(EDGE_SEC_MS_GEC_TEST_VECTOR.timestamp),
		EDGE_SEC_MS_GEC_TEST_VECTOR.token,
	);
});

test("pronounce word renders a speaker and no inline Forvo link", () => {
	const html = renderToStaticMarkup(
		React.createElement(PronounceWord, { word: "bonjour", lang: "fr" }),
	);
	assert.match(html, /Hear bonjour in French/);
	assert.match(html, /data-pronounce-lang="fr"/);
	assert.doesNotMatch(html, />Forvo</);
	assert.doesNotMatch(html, /forvo\.com\/search/);
});

test("external links render as anchors", () => {
	const html = renderToStaticMarkup(
		React.createElement(ExternalLink, { href: "https://example.com/", children: "Example" }),
	);
	assert.match(html, /href="https:\/\/example\.com\/"/);
	assert.match(html, />Example</);
});
