import assert from "node:assert/strict";
import test from "node:test";
import { fetchLinkPreview } from "../src/server/link-preview.ts";

test("Wikipedia links use the REST summary and keep the lead image", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		assert.match(url, /^https:\/\/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Ada_Lovelace/);
		return Response.json({
			title: "Ada Lovelace",
			description: "English mathematician and writer",
			extract: "Ada Lovelace was an English mathematician and writer.",
			thumbnail: { source: "https://upload.wikimedia.org/ada.jpg" },
			content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Ada_Lovelace" } },
			lang: "en",
		});
	};
	try {
		const preview = await fetchLinkPreview("https://en.wikipedia.org/wiki/Ada_Lovelace");
		assert.ok(preview);
		assert.equal(preview.kind, "wikipedia");
		assert.equal(preview.title, "Ada Lovelace");
		assert.match(preview.description ?? "", /mathematician/);
		assert.equal(preview.image, "https://upload.wikimedia.org/ada.jpg");
		assert.equal(preview.url, "https://en.wikipedia.org/wiki/Ada_Lovelace");
	} finally {
		globalThis.fetch = original;
	}
});

test("ordinary pages read OpenGraph metadata", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async () => {
		return new Response(
			`<!doctype html><html><head>
				<meta property="og:title" content="Example &amp; Co" />
				<meta property="og:description" content="A page about examples." />
				<meta property="og:site_name" content="Example" />
				<meta property="og:image" content="/cover.jpg" />
			</head></html>`,
			{ headers: { "content-type": "text/html; charset=utf-8" } },
		);
	};
	try {
		const preview = await fetchLinkPreview("https://93.184.216.34/page");
		assert.ok(preview);
		assert.equal(preview.kind, "web");
		assert.equal(preview.title, "Example & Co");
		assert.equal(preview.siteName, "Example");
		assert.equal(preview.image, "https://93.184.216.34/cover.jpg");
	} finally {
		globalThis.fetch = original;
	}
});

test("local hosts never reach the network", async () => {
	const original = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return new Response(null, { status: 500 });
	};
	try {
		assert.equal(await fetchLinkPreview("http://127.0.0.1:3000/"), null);
		assert.equal(await fetchLinkPreview("http://localhost/"), null);
		assert.equal(calls, 0);
	} finally {
		globalThis.fetch = original;
	}
});
