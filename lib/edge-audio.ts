/**
 * Client side of the Edge TTS route: fetch mp3 bytes, wrap them in an
 * Audio element, and hand back a handle that knows its object URL so the
 * caller can release it. Browser-only (called from client components).
 */

export interface EdgeAudioHandle {
	audio: HTMLAudioElement;
	url: string;
}

export async function fetchEdgeAudio(
	text: string,
	language: string,
	signal?: AbortSignal,
): Promise<EdgeAudioHandle | null> {
	try {
		const response = await fetch(
			`/api/tts?lang=${encodeURIComponent(language)}&text=${encodeURIComponent(text)}`,
			{ cache: "no-store", signal },
		);
		if (!response.ok) return null;
		const blob = await response.blob();
		if (!blob.size) return null;
		const url = URL.createObjectURL(blob);
		return { audio: new Audio(url), url };
	} catch {
		return null;
	}
}

export function releaseEdgeAudio(handle: EdgeAudioHandle | null): void {
	if (!handle) return;
	try {
		handle.audio.pause();
		handle.audio.src = "";
	} catch {
		// already detached
	}
	URL.revokeObjectURL(handle.url);
}
