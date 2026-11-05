"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	forvoSearchUrl,
	PRONOUNCE_BCP47,
	PRONOUNCE_LANGUAGE_NAMES,
	type PronounceLanguage,
} from "@/src/core";

interface PronunciationResponse {
	audio: string;
	mimeType?: string;
	speaker?: string;
	forvoUrl?: string;
}

interface CachedAudio {
	value: PronunciationResponse;
	expires: number;
}

const AUDIO_CACHE_MS = 30 * 60 * 1000;
const audioCache = new Map<string, CachedAudio>();

function cacheKey(language: string, word: string): string {
	return `${language}:${word}`;
}

function speakableVoice(voices: SpeechSynthesisVoice[], language: PronounceLanguage): SpeechSynthesisVoice | null {
	const target = PRONOUNCE_BCP47[language].toLowerCase();
	const exact = voices.find((voice) => voice.lang.replace(/_/g, "-").toLowerCase() === target);
	if (exact) return exact;
	const base = target.split("-")[0]!;
	return voices.find((voice) => voice.lang.replace(/_/g, "-").toLowerCase().split("-")[0] === base) ?? null;
}

async function fetchPronunciation(
	language: PronounceLanguage,
	word: string,
	signal: AbortSignal,
): Promise<PronunciationResponse | null> {
	try {
		const response = await fetch(
			`/api/pronounce?lang=${encodeURIComponent(language)}&word=${encodeURIComponent(word)}`,
			{ cache: "no-store", signal },
		);
		if (!response.ok) return null;
		const data = (await response.json()) as Partial<PronunciationResponse>;
		if (typeof data.audio !== "string" || !data.audio) return null;
		return {
			audio: data.audio,
			mimeType: typeof data.mimeType === "string" ? data.mimeType : "audio/mpeg",
			...(typeof data.speaker === "string" ? { speaker: data.speaker } : {}),
			...(typeof data.forvoUrl === "string" ? { forvoUrl: data.forvoUrl } : {}),
		};
	} catch {
		return null;
	}
}

function playAudio(
	data: PronunciationResponse,
	audioRef: { current: HTMLAudioElement | null },
	onEnded: () => void,
	onFailed: () => void,
): void {
	const audio = new Audio(`data:${data.mimeType ?? "audio/mpeg"};base64,${data.audio}`);
	audioRef.current = audio;
	audio.onended = onEnded;
	audio.onerror = onFailed;
	void audio.play().catch(onFailed);
}

export function PronounceWord({
	word,
	lang,
	className,
}: {
	word: string;
	lang: PronounceLanguage;
	className?: string;
}) {
	const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
	const [message, setMessage] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const speakingRef = useRef(false);
	const abortRef = useRef<AbortController | null>(null);
	const aliveRef = useRef(true);
	const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

	useEffect(() => {
		if (!("speechSynthesis" in window)) return;
		const synth = window.speechSynthesis;
		const update = () => {
			voicesRef.current = synth.getVoices();
		};
		update();
		synth.addEventListener("voiceschanged", update);
		return () => synth.removeEventListener("voiceschanged", update);
	}, []);

	useEffect(() => {
		aliveRef.current = true;
		return () => {
			aliveRef.current = false;
			abortRef.current?.abort();
			audioRef.current?.pause();
			audioRef.current = null;
			if (speakingRef.current) {
				window.speechSynthesis?.cancel();
				speakingRef.current = false;
			}
		};
	}, []);

	const stop = () => {
		abortRef.current?.abort();
		abortRef.current = null;
		const audio = audioRef.current;
		if (audio) {
			audio.pause();
			audio.currentTime = 0;
			audioRef.current = null;
		}
		if (speakingRef.current) {
			window.speechSynthesis?.cancel();
			speakingRef.current = false;
		}
		setState("idle");
	};

	const speakSystem = (): boolean => {
		if (!("speechSynthesis" in window)) return false;
		const synth = window.speechSynthesis;
		const voices = voicesRef.current.length > 0 ? voicesRef.current : synth.getVoices();
		const voice = speakableVoice(voices, lang);
		if (!voice) return false;
		synth.cancel();
		speakingRef.current = true;
		const utterance = new SpeechSynthesisUtterance(word);
		utterance.lang = PRONOUNCE_BCP47[lang];
		utterance.voice = voice;
		utterance.rate = 0.9;
		utterance.onend = () => {
			speakingRef.current = false;
			if (aliveRef.current) setState("idle");
		};
		utterance.onerror = () => {
			speakingRef.current = false;
			if (!aliveRef.current) return;
			setMessage("The system voice could not speak this word.");
			setState("error");
		};
		setMessage(null);
		setState("playing");
		synth.speak(utterance);
		return true;
	};

	const onClick = async () => {
		if (state === "loading" || state === "playing") {
			stop();
			return;
		}
		setMessage(null);
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		setState("loading");

		const playbackFailed = () => {
			if (!aliveRef.current) return;
			if (speakSystem()) return;
			setMessage("The recording could not play.");
			setState("error");
		};

		const key = cacheKey(lang, word);
		const cached = audioCache.get(key);
		if (cached && cached.expires > Date.now()) {
			setState("playing");
			playAudio(
				cached.value,
				audioRef,
				() => aliveRef.current && setState("idle"),
				playbackFailed,
			);
			return;
		}

		const data = await fetchPronunciation(lang, word, controller.signal);
		if (controller.signal.aborted || !aliveRef.current) return;
		if (data) {
			audioCache.set(key, { value: data, expires: Date.now() + AUDIO_CACHE_MS });
			setState("playing");
			playAudio(
				data,
				audioRef,
				() => aliveRef.current && setState("idle"),
				playbackFailed,
			);
			return;
		}

		// No Forvo key, no recording, or Forvo unreachable: use the OS voice.
		if (speakSystem()) return;

		// No OS voice for this language: the free Forvo search is the path.
		window.open(forvoSearchUrl(word, lang), "_blank", "noopener,noreferrer");
		setState("idle");
	};

	const languageName = PRONOUNCE_LANGUAGE_NAMES[lang];
	const label =
		state === "error"
			? (message ?? "Pronunciation unavailable")
			: state === "playing"
				? `Stop pronunciation of ${word}`
				: `Hear ${word} in ${languageName}`;

	return (
		<span className={cn("inline-flex items-baseline gap-0.5 whitespace-nowrap align-baseline", className)}>
			<span>{word}</span>
			<button
				type="button"
				onClick={() => void onClick()}
				aria-label={label}
				title={label}
				className={cn(
					"relative -mb-0.5 inline-flex size-5 shrink-0 translate-y-[1px] items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					state === "playing" && "text-foreground",
				)}
			>
				{state === "loading" ? (
					<Loader2Icon className="size-3 animate-spin" />
				) : state === "error" ? (
					<VolumeXIcon className="size-3" />
				) : (
					<Volume2Icon className={cn("size-3", state === "playing" && "animate-pulse")} />
				)}
			</button>
			<a
				href={forvoSearchUrl(word, lang)}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Search ${word} on Forvo (opens in a new tab)`}
				title="Search this word on Forvo"
				className="text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground/55 transition-colors hover:text-foreground"
			>
				Forvo
			</a>
		</span>
	);
}
