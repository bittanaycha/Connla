import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { parseHTML } from "linkedom";
import type { LinkPreview } from "../core/contracts/link-preview.ts";

/**
 * Link previews for the chat renderer. Wikipedia goes through the REST
 * summary API; everything else reads OpenGraph/Twitter metadata (with a
 * <title>/description fallback) from the page itself. The caller only ever
 * sees a small JSON card — no page HTML is stored or rendered.
 *
 * The fetch is deliberately conservative: http(s) only, default ports only,
 * no credentials, no local/private hosts, bounded redirects, a 7 s timeout
 * and a 1.5 MB HTML cap. Results are cached in memory for 30 minutes and
 * concurrent requests for one URL share a single fetch.
 */

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 7_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const CACHE_TTL_MS = 30 * 60 * 1000;
const FAILURE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

type ParsedDocument = ReturnType<typeof parseHTML>["document"];

interface CacheEntry {
	expires: number;
	value: LinkPreview | null;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<LinkPreview | null>>();

/** One preview per URL; null means "nothing worth showing". */
export async function fetchLinkPreview(raw: string): Promise<LinkPreview | null> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	url.hash = "";
	const key = url.href;
	const hit = cache.get(key);
	if (hit && hit.expires > Date.now()) return hit.value;
	if (hit) cache.delete(key);
	const running = pending.get(key);
	if (running) return running;
	const task = buildPreview(url)
		.catch(() => null)
		.then((value) => {
			writeCache(key, value);
			return value;
		})
		.finally(() => {
			pending.delete(key);
		});
	pending.set(key, task);
	return task;
}

async function buildPreview(url: URL): Promise<LinkPreview | null> {
	const wiki = wikipediaTarget(url);
	if (wiki) return wikipediaPreview(wiki.lang, wiki.title);
	return webPreview(url);
}

// ── Wikipedia ───────────────────────────────────────────────────────────────

interface WikipediaSummary {
	type?: string;
	title?: string;
	description?: string;
	extract?: string;
	lang?: string;
	thumbnail?: { source?: string };
	originalimage?: { source?: string };
	content_urls?: { desktop?: { page?: string } };
}

function wikipediaTarget(url: URL): { lang: string; title: string } | null {
	const host = url.hostname.toLowerCase();
	const match = /^(?:([a-z-]{2,12})\.)?(?:m\.)?wikipedia\.org$/.exec(host);
	if (!match) return null;
	if (!url.pathname.startsWith("/wiki/")) return null;
	let lang = match[1] && match[1] !== "www" ? match[1] : "en";
	if (!/^[a-z][a-z-]{1,11}$/.test(lang)) return null;
	if (["commons", "meta", "species", "wikidata", "incubator"].includes(lang)) return null;
	let title: string;
	try {
		title = decodeURIComponent(url.pathname.slice("/wiki/".length));
	} catch {
		return null;
	}
	title = title.replace(/_/g, " ").trim();
	if (!title) return null;
	return { lang, title };
}

async function wikipediaPreview(lang: string, title: string): Promise<LinkPreview | null> {
	const api = new URL(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
	api.searchParams.set("redirect", "true");
	const response = await fetch(api, {
		headers: { Accept: "application/json", "User-Agent": USER_AGENT },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		redirect: "follow",
	});
	if (!response.ok) return null;
	const data = (await response.json()) as WikipediaSummary;
	const pageTitle = cleanText(data.title ?? title, 140);
	const description = cleanText(data.extract ?? data.description ?? "", 300);
	const image = safeImageUrl(data.thumbnail?.source ?? data.originalimage?.source, api);
	const pageUrl = data.content_urls?.desktop?.page ?? api.href;
	if (!pageTitle && !description) return null;
	return {
		url: pageUrl,
		title: pageTitle || title,
		...(description ? { description } : {}),
		...(image ? { image } : {}),
		siteName: "Wikipedia",
		kind: "wikipedia",
		lang: data.lang ?? lang,
	};
}

// ── Ordinary pages ──────────────────────────────────────────────────────────

async function webPreview(url: URL): Promise<LinkPreview | null> {
	const page = await fetchPage(url);
	if (!page) return null;
	const { response, finalUrl } = page;
	const contentType = response.headers.get("content-type") ?? "";
	if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) return null;
	const declared = Number(response.headers.get("content-length") ?? 0);
	if (declared > MAX_HTML_BYTES) return null;
	const html = await readCapped(response, MAX_HTML_BYTES);
	if (!html) return null;
	let document: ParsedDocument;
	try {
		({ document } = parseHTML(html));
	} catch {
		return null;
	}
	const title = cleanText(
		meta(document, ["og:title", "twitter:title"]) ?? document.querySelector("title")?.textContent ?? "",
		140,
	);
	const description = cleanText(
		meta(document, ["og:description", "description", "twitter:description"]) ?? "",
		300,
	);
	const image = safeImageUrl(
		meta(document, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]),
		finalUrl,
	);
	const siteName = cleanText(
		meta(document, ["og:site_name", "application-name"]) ?? finalUrl.hostname.replace(/^www\./, ""),
		60,
	);
	if (!title && !description && !image) return null;
	return {
		url: finalUrl.href,
		title: title || siteName || finalUrl.hostname,
		...(description ? { description } : {}),
		...(image ? { image } : {}),
		siteName: siteName || finalUrl.hostname.replace(/^www\./, ""),
		kind: "web",
	};
}

function meta(document: ParsedDocument, properties: string[]): string | undefined {
	for (const property of properties) {
		const element =
			document.querySelector(`meta[property="${property}"]`) ??
			document.querySelector(`meta[name="${property}"]`);
		const content = element?.getAttribute("content")?.trim();
		if (content) return content;
	}
	return undefined;
}

function cleanText(value: string, max: number): string {
	const text = value
		.replace(/<[^>]*>/g, " ")
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const space = cut.lastIndexOf(" ");
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ── Fetching + safety ───────────────────────────────────────────────────────

interface FetchedPage {
	response: Response;
	finalUrl: URL;
}

async function fetchPage(start: URL): Promise<FetchedPage | null> {
	let current = start;
	for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
		if (!(await isPublicUrl(current))) return null;
		const response = await fetch(current, {
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			redirect: "manual",
			credentials: "omit",
			cache: "no-store",
		});
		if (response.status >= 300 && response.status < 400 && response.status !== 304) {
			const location = response.headers.get("location");
			if (!location) return null;
			try {
				current = new URL(location, current);
			} catch {
				return null;
			}
			continue;
		}
		return { response, finalUrl: current };
	}
	return null;
}

async function readCapped(response: Response, cap: number): Promise<string | null> {
	const reader = response.body?.getReader();
	if (!reader) return null;
	const chunks: Buffer[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > cap) {
				await reader.cancel();
				return null;
			}
			chunks.push(Buffer.from(value));
		}
	} catch {
		return null;
	}
	return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

async function isPublicUrl(url: URL): Promise<boolean> {
	if (url.protocol !== "http:" && url.protocol !== "https:") return false;
	if (url.username || url.password) return false;
	if (url.port && url.port !== "80" && url.port !== "443") return false;
	const host = url.hostname.toLowerCase();
	if (!host) return false;
	if (host === "localhost" || host.endsWith(".localhost")) return false;
	if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return false;
	if (host === "metadata.google.internal") return false;
	const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	if (isIP(bare)) return !isPrivateAddress(bare);
	let addresses: LookupAddress[];
	try {
		addresses = await withTimeout(lookup(bare, { all: true }), 2_500);
	} catch {
		return false;
	}
	return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
}

function isPrivateAddress(address: string): boolean {
	if (isIP(address) === 4) {
		const value = ipv4ToNumber(address);
		if (value === null) return true;
		const blocks: Array<[string, number]> = [
			["0.0.0.0", 8],
			["10.0.0.0", 8],
			["100.64.0.0", 10],
			["127.0.0.0", 8],
			["169.254.0.0", 16],
			["172.16.0.0", 12],
			["192.0.0.0", 24],
			["192.0.2.0", 24],
			["192.168.0.0", 16],
			["198.18.0.0", 15],
			["198.51.100.0", 24],
			["203.0.113.0", 24],
			["224.0.0.0", 4],
			["240.0.0.0", 4],
		];
		return blocks.some(([base, bits]) => {
			const baseValue = ipv4ToNumber(base);
			if (baseValue === null) return false;
			const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
			return (value & mask) === (baseValue & mask);
		});
	}
	const value = address.toLowerCase();
	if (value === "::" || value === "::1") return true;
	if (value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("ff")) return true;
	if (value.startsWith("::ffff:")) {
		const tail = value.slice("::ffff:".length);
		if (isIP(tail) === 4) return isPrivateAddress(tail);
	}
	return false;
}

function ipv4ToNumber(address: string): number | null {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const octet = Number(part);
		if (octet > 255) return null;
		value = value * 256 + octet;
	}
	return value >>> 0;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("Timed out")), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function safeImageUrl(source: string | undefined, base: URL): string | undefined {
	if (!source) return undefined;
	let url: URL;
	try {
		url = new URL(source, base);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	if (url.username || url.password) return undefined;
	if (url.port && url.port !== "80" && url.port !== "443") return undefined;
	const host = url.hostname.toLowerCase();
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
		return undefined;
	}
	const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	if (isIP(bare) && isPrivateAddress(bare)) return undefined;
	return url.href;
}

function writeCache(key: string, value: LinkPreview | null): void {
	cache.delete(key);
	cache.set(key, {
		expires: Date.now() + (value ? CACHE_TTL_MS : FAILURE_TTL_MS),
		value,
	});
	while (cache.size > MAX_CACHE_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (!oldest) break;
		cache.delete(oldest);
	}
}
