"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLinkIcon, Loader2Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchEdgeAudio, releaseEdgeAudio, type EdgeAudioHandle } from "@/lib/edge-audio";
import { openForvoWindow } from "@/lib/forvo-popup";
import {
	forvoSearchUrl,
	hasEdgeVoice,
	PRONOUNCE_BCP47,
	PRONOUNCE_LANGUAGE_NAMES,
	type PronounceLanguage,
} from "@/src/core";

function speakableVoice(voices: SpeechSynthesisVoice[], language: PronounceLanguage): SpeechSynthesisVoice | null {
	const target = PRONOUNCE_BCP47[language].toLowerCase();
	const exact = voices.find((voice) => voice.lang.replace(/_/g, "-").toLowerCase() === target);
	if (exact) return exact;
	const base = target.split("-")[0]!;
	return voices.find((voice) => voice.lang.replace(/_/g, "-").toLowerCase().split("-")[0] === base) ?? null;
}

/**
 * A spoken word inside prose. Click the speaker: Edge TTS first (the free
 * Read Aloud endpoint), then the OS voice when the browser has one, then a
 * small card offering the Forvo recordings in a 420×560 window. No inline
 * Forvo link — the card is the only way out, on purpose.
 */
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
	const [fallbackOpen, setFallbackOpen] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const audioRef = useRef<EdgeAudioHandle | null>(null);
	const speakingRef = useRef(false);
	const abortRef = useRef<AbortController | null>(null);
	const aliveRef = useRef(true);
	const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
	const wrapRef = useRef<HTMLSpanElement | null>(null);

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
			releaseEdgeAudio(audioRef.current);
			audioRef.current = null;
			if (speakingRef.current) {
				window.speechSynthesis?.cancel();
				speakingRef.current = false;
			}
		};
	}, []);

	useEffect(() => {
		if (!fallbackOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!wrapRef.current?.contains(event.target as Node)) setFallbackOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setFallbackOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [fallbackOpen]);

	const stop = () => {
		abortRef.current?.abort();
		abortRef.current = null;
		releaseEdgeAudio(audioRef.current);
		audioRef.current = null;
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

	const showFallback = () => {
		releaseEdgeAudio(audioRef.current);
		audioRef.current = null;
		if (speakSystem()) return;
		setFallbackOpen(true);
		setState("error");
	};

	const playEdge = (handle: EdgeAudioHandle) => {
		audioRef.current = handle;
		handle.audio.onended = () => {
			releaseEdgeAudio(handle);
			if (audioRef.current === handle) audioRef.current = null;
			if (aliveRef.current) setState("idle");
		};
		handle.audio.onerror = () => {
			if (!aliveRef.current) return;
			showFallback();
		};
		setState("playing");
		void handle.audio.play().catch(() => {
			if (aliveRef.current) showFallback();
		});
	};

	const onClick = async () => {
		if (state === "loading" || state === "playing") {
			stop();
			return;
		}
		setMessage(null);
		setFallbackOpen(false);
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		setState("loading");

		const handle = await fetchEdgeAudio(word, lang, controller.signal);
		if (!aliveRef.current || controller.signal.aborted) {
			releaseEdgeAudio(handle);
			return;
		}
		if (handle) {
			playEdge(handle);
			return;
		}
		showFallback();
	};

	const openForvo = () => {
		setFallbackOpen(false);
		openForvoWindow(forvoSearchUrl(word, lang));
	};

	const languageName = PRONOUNCE_LANGUAGE_NAMES[lang];
	const label =
		state === "loading"
			? `Loading pronunciation of ${word}`
			: state === "playing"
				? `Stop pronunciation of ${word}`
				: `Hear ${word} in ${languageName}`;

	return (
		<span
			ref={wrapRef}
			data-pronounce-lang={lang}
			className={cn("relative inline-flex items-baseline gap-0.5 whitespace-nowrap align-baseline", className)}
		>
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
			{fallbackOpen ? (
				<span
					role="dialog"
					aria-label={`Forvo recordings of ${word}`}
					className="absolute left-0 top-full z-50 mt-1 flex w-60 flex-col gap-1.5 rounded-md border border-border bg-popover p-2.5 text-left text-popover-foreground shadow-lg"
				>
					<span className="text-[11px] leading-snug text-muted-foreground">
						{message ??
							(hasEdgeVoice(lang) ? "Edge audio is unavailable right now." : `Edge has no ${languageName} voice.`)}
					</span>
					<button
						type="button"
						onClick={openForvo}
						className="inline-flex items-center gap-1 self-start rounded-sm bg-accent px-2 py-1 text-[11px] font-medium text-accent-foreground transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<ExternalLinkIcon className="size-3" />
						Play on Forvo
					</button>
				</span>
			) : null}
		</span>
	);
}
