/**
 * Open a Forvo search in a small window instead of a tab. In Electron the
 * preload bridge opens a sandboxed child BrowserWindow (the app denies
 * window.open and routes it to the system browser, which is the annoyance
 * this replaces); in the browser it falls back to a named 420×560 popup.
 */

export function openForvoWindow(url: string): void {
	if (typeof window === "undefined") return;
	const bridge = (window as Window & { lh?: { openForvoWindow?: (target: string) => Promise<unknown> } }).lh;
	if (bridge?.openForvoWindow) {
		void bridge.openForvoWindow(url);
		return;
	}
	const popup = window.open(url, "lh-forvo", "popup=yes,width=420,height=560");
	if (!popup) window.open(url, "_blank", "noopener,noreferrer");
}
