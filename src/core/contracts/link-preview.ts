/** One link-preview card's data. Fetched server-side and never model-facing. */
export interface LinkPreview {
	/** Canonical URL after redirects; the card opens this. */
	url: string;
	title: string;
	description?: string;
	/** Absolute http(s) image URL, already screened for local/private hosts. */
	image?: string;
	siteName: string;
	kind: "wikipedia" | "web";
	/** Wikipedia language subdomain, when kind is "wikipedia". */
	lang?: string;
}
