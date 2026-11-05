/**
 * The ten languages the pronunciation button knows. Shared by the server
 * route, the Markdown renderer, and the Forvo search link.
 *
 * The code is what the teacher writes in `[word](/pronounce/{code})`; the
 * BCP-47 tag is what the OS voice needs; Forvo has separate search and API
 * slugs (Portuguese search is `pt_other`; the API's European Portuguese is
 * `pt_pt`).
 */

export const PRONOUNCE_LANGUAGES = ["en", "fr", "ja", "cy", "it", "es", "pt", "zh", "ga", "gd"] as const;
export type PronounceLanguage = (typeof PRONOUNCE_LANGUAGES)[number];

const LANGUAGE_SET: ReadonlySet<string> = new Set(PRONOUNCE_LANGUAGES);

export function isPronounceLanguage(value: string): value is PronounceLanguage {
	return LANGUAGE_SET.has(value);
}

export const PRONOUNCE_BCP47: Record<PronounceLanguage, string> = {
	en: "en-GB",
	fr: "fr-FR",
	ja: "ja-JP",
	cy: "cy-GB",
	it: "it-IT",
	es: "es-ES",
	pt: "pt-PT",
	zh: "zh-CN",
	ga: "ga-IE",
	gd: "gd-GB",
};

export const PRONOUNCE_LANGUAGE_NAMES: Record<PronounceLanguage, string> = {
	en: "English",
	fr: "French",
	ja: "Japanese",
	cy: "Welsh",
	it: "Italian",
	es: "Spanish",
	pt: "Portuguese",
	zh: "Mandarin",
	ga: "Irish",
	gd: "Scottish Gaelic",
};

const FORVO_SEARCH_LANGUAGE: Record<PronounceLanguage, string> = {
	en: "en",
	fr: "fr",
	ja: "ja",
	cy: "cy",
	it: "it",
	es: "es",
	pt: "pt_other",
	zh: "zh",
	ga: "ga",
	gd: "gd",
};

const FORVO_API_LANGUAGE: Record<PronounceLanguage, string> = {
	...FORVO_SEARCH_LANGUAGE,
	pt: "pt_pt",
};

/** The free Forvo search URL — the no-key path. */
export function forvoSearchUrl(word: string, language: PronounceLanguage): string {
	return `https://forvo.com/search/${encodeURIComponent(word)}/${FORVO_SEARCH_LANGUAGE[language]}/`;
}

/** The Forvo API's language slug (searches and the API differ for Portuguese). */
export function forvoApiLanguage(language: PronounceLanguage): string {
	return FORVO_API_LANGUAGE[language];
}
