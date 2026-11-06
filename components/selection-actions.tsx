"use client";

/**
 * The on-highlight action popup (library wave): a single floating card for
 * Listen (Edge), Add to glossary, Save highlight, Wikipedia, and Google.
 *
 * Mounted once in AppShell. It only appears for a non-collapsed selection
 * that starts and ends inside `[data-highlightable]` prose, so sidebar
 * drags and inputs never trigger it. The host page tags its passages and
 * message anchors; this component reads them, never owns them.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
	BookOpenIcon,
	CheckIcon,
	HighlighterIcon,
	LanguagesIcon,
	Loader2Icon,
	PlusIcon,
	SearchIcon,
	Volume2Icon,
	XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchEdgeAudio, releaseEdgeAudio, type EdgeAudioHandle } from "@/lib/edge-audio";
import {
	isPronounceLanguage,
	MAX_GLOSSARY_CHARS,
	MAX_HIGHLIGHT_CHARS,
	PRONOUNCE_LANGUAGES,
	PRONOUNCE_LANGUAGE_NAMES,
	type PronounceLanguage,
} from "@/src/core";

interface SelectionInfo {
	text: string;
	language: PronounceLanguage;
	messageId: string | null;
	/** The passage's text, capped — the model's disambiguation context. */
	context: string;
	x: number;
	y: number;
}

type Feedback = { tone: "ok" | "warn" | "error"; text: string } | null;
type ListenState = "idle" | "loading" | "playing";

const LANGUAGE_STORAGE_KEY = "lh.selection.language";
const POPUP_WIDTH = 304;

function elementOf(node: Node): Element | null {
	if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
	return node.parentElement;
}

function scriptGuess(text: string): PronounceLanguage | null {
	if (/[\u3040-\u30ff]/u.test(text)) return "ja";
	if (/[\u4e00-\u9fff]/u.test(text)) return "zh";
	if (/[ŵŷ]/iu.test(text)) return "cy";
	return null;
}

function storedLanguage(): PronounceLanguage | null {
	try {
		const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
		return value && isPronounceLanguage(value) ? value : null;
	} catch {
		return null;
	}
}

function chooseLanguage(text: string, start: Element, end: Element): PronounceLanguage {
	const tagged =
		start.closest("[data-pronounce-lang]")?.getAttribute("data-pronounce-lang") ??
		end.closest("[data-pronounce-lang]")?.getAttribute("data-pronounce-lang");
	if (tagged && isPronounceLanguage(tagged)) return tagged;
	return scriptGuess(text) ?? storedLanguage() ?? "en";
}

async function postAction(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const data = await response.json().catch(() => null);
		return { ok: response.ok, status: response.status, data };
	} catch {
		return { ok: false, status: 0, data: null };
	}
}

export function SelectionActions() {
	const pathname = usePathname();
	const [mounted, setMounted] = useState(false);
	const [selection, setSelection] = useState<SelectionInfo | null>(null);
	const [language, setLanguage] = useState<PronounceLanguage>("en");
	const [listenState, setListenState] = useState<ListenState>("idle");
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [busy, setBusy] = useState<"glossary" | "highlight" | null>(null);
	const popupRef = useRef<HTMLDivElement | null>(null);
	const audioRef = useRef<EdgeAudioHandle | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => setMounted(true), []);

	const chatId = pathname?.match(/^\/chat\/([^/]+)/)?.[1] ?? null;

	const close = () => {
		abortRef.current?.abort();
		releaseEdgeAudio(audioRef.current);
		audioRef.current = null;
		setListenState("idle");
		setSelection(null);
		setFeedback(null);
		setBusy(null);
	};

	useEffect(() => {
		const capture = () => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
			const range = sel.getRangeAt(0);
			const start = elementOf(range.startContainer);
			const end = elementOf(range.endContainer);
			if (!start || !end) return;
			if (!start.closest("[data-highlightable]") || !end.closest("[data-highlightable]")) return;
			const text = sel.toString().replace(/\s+/g, " ").trim();
			if (!text) return;
			const passage = start.closest("[data-highlightable]");
			const context = (passage?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
			const sourceEl = start.closest("[data-source-message-id],[data-message-id]");
			const messageId =
				sourceEl?.getAttribute("data-source-message-id") ??
				sourceEl?.getAttribute("data-message-id") ??
				null;
			const rect = range.getBoundingClientRect();
			const nextLanguage = chooseLanguage(text, start, end);
			setFeedback(null);
			setListenState("idle");
			releaseEdgeAudio(audioRef.current);
			audioRef.current = null;
			setLanguage(nextLanguage);
			setSelection({
				text,
				language: nextLanguage,
				messageId,
				context,
				x: rect.left + rect.width / 2,
				y: rect.bottom,
			});
		};

		const onPointerUp = (event: PointerEvent) => {
			if (popupRef.current?.contains(event.target as Node)) return;
			window.setTimeout(capture, 0);
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (popupRef.current?.contains(event.target as Node)) return;
			if (event.key.startsWith("Arrow") || event.key === "Shift") window.setTimeout(capture, 0);
		};
		const onPointerDown = (event: PointerEvent) => {
			if (popupRef.current?.contains(event.target as Node)) return;
			setSelection((current) => (current ? null : current));
		};
		const onScroll = () => {
			abortRef.current?.abort();
			releaseEdgeAudio(audioRef.current);
			audioRef.current = null;
			setListenState("idle");
			setSelection((current) => (current ? null : current));
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				abortRef.current?.abort();
				releaseEdgeAudio(audioRef.current);
				audioRef.current = null;
				setListenState("idle");
				setSelection(null);
				setFeedback(null);
			}
		};

		document.addEventListener("pointerup", onPointerUp);
		document.addEventListener("keyup", onKeyUp);
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("scroll", onScroll, true);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerup", onPointerUp);
			document.removeEventListener("keyup", onKeyUp);
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("scroll", onScroll, true);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, []);

	useEffect(() => {
		return () => {
			abortRef.current?.abort();
			releaseEdgeAudio(audioRef.current);
		};
	}, []);

	useEffect(() => {
		// Changing the language invalidates the clip that is playing or loading.
		abortRef.current?.abort();
		releaseEdgeAudio(audioRef.current);
		audioRef.current = null;
		setFeedback(null);
		setListenState("idle");
	}, [language]);

	if (!mounted || !selection) return null;

	const glossaryDisabled = busy !== null || selection.text.length > MAX_GLOSSARY_CHARS;
	const highlightDisabled = busy !== null || selection.text.length > MAX_HIGHLIGHT_CHARS;
	const hasSource = Boolean(chatId && selection.messageId);

	const setChosenLanguage = (value: string) => {
		if (!isPronounceLanguage(value)) return;
		setLanguage(value);
		try {
			window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
		} catch {
			// private mode
		}
	};

	const listen = async () => {
		if (listenState === "playing" || listenState === "loading") {
			abortRef.current?.abort();
			releaseEdgeAudio(audioRef.current);
			audioRef.current = null;
			setListenState("idle");
			return;
		}
		setListenState("loading");
		const controller = new AbortController();
		abortRef.current = controller;
		const handle = await fetchEdgeAudio(selection.text, language, controller.signal);
		if (controller.signal.aborted) {
			releaseEdgeAudio(handle);
			return;
		}
		if (!handle) {
			setListenState("idle");
			setFeedback({ tone: "warn", text: `Edge audio is unavailable for ${PRONOUNCE_LANGUAGE_NAMES[language]}.` });
			return;
		}
		audioRef.current = handle;
		handle.audio.onended = () => {
			releaseEdgeAudio(handle);
			if (audioRef.current === handle) audioRef.current = null;
			setListenState("idle");
		};
		setListenState("playing");
		void handle.audio.play().catch(() => {
			releaseEdgeAudio(handle);
			audioRef.current = null;
			setListenState("idle");
			setFeedback({ tone: "error", text: "The audio could not play." });
		});
	};

	const addToGlossary = async () => {
		if (glossaryDisabled) return;
		setBusy("glossary");
		setFeedback(null);
		const result = await postAction("/api/glossary", {
			term: selection.text,
			form: selection.text,
			language,
			context: selection.context,
			source: { chatId, messageId: selection.messageId },
		});
		setBusy(null);
		if (result.ok) {
			const duplicate = (result.data as { duplicate?: boolean } | null)?.duplicate === true;
			setFeedback({ tone: duplicate ? "warn" : "ok", text: duplicate ? "Already in the glossary." : "Added to the glossary." });
			return;
		}
		const message =
			result.status === 503
				? "No model configured for definitions."
				: result.status === 422
					? "That selection is too long for a glossary term."
					: "The definition could not be generated.";
		setFeedback({ tone: "error", text: message });
	};

	const saveHighlight = async () => {
		if (highlightDisabled) return;
		setBusy("highlight");
		setFeedback(null);
		const result = await postAction("/api/highlights", {
			text: selection.text,
			language,
			source: { chatId, messageId: selection.messageId },
		});
		setBusy(null);
		if (result.ok) {
			const duplicate = (result.data as { duplicate?: boolean } | null)?.duplicate === true;
			setFeedback({ tone: duplicate ? "warn" : "ok", text: duplicate ? "Already saved." : "Highlight saved." });
			return;
		}
		setFeedback({ tone: "error", text: "The highlight could not be saved." });
	};

	const search = (url: string) => {
		window.open(url, "_blank", "noopener,noreferrer");
	};

	const left = Math.max(8, Math.min(selection.x - POPUP_WIDTH / 2, window.innerWidth - POPUP_WIDTH - 8));
	const top =
		selection.y + 8 > window.innerHeight - 170 ? selection.y - 170 : selection.y + 8;

	return createPortal(
		<div
			ref={popupRef}
			role="dialog"
			aria-label="Selection actions"
			className="fixed z-[80] flex w-[19rem] flex-col gap-2 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-xl"
			style={{ left, top }}
		>
			<div className="flex items-start justify-between gap-2">
				<span className="line-clamp-2 min-w-0 flex-1 font-serif text-[13px] leading-snug text-foreground">
					{selection.text}
				</span>
				<button
					type="button"
					onClick={close}
					aria-label="Close selection actions"
					className="-mr-1 -mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</button>
			</div>

			<div className="flex items-center gap-1">
				<label className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-sm border border-border/70 px-1.5 py-1">
					<LanguagesIcon className="size-3 shrink-0 text-muted-foreground" />
					<select
						value={language}
						onChange={(event) => setChosenLanguage(event.target.value)}
						aria-label="Language for speech"
						className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none"
					>
						{PRONOUNCE_LANGUAGES.map((code) => (
							<option key={code} value={code}>
								{PRONOUNCE_LANGUAGE_NAMES[code]}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					onClick={() => void listen()}
					className="inline-flex h-7 items-center gap-1 rounded-sm border border-border/70 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
				>
					{listenState === "loading" ? (
						<Loader2Icon className="size-3.5 animate-spin" />
					) : (
						<Volume2Icon className={cn("size-3.5", listenState === "playing" && "animate-pulse")} />
					)}
					{listenState === "playing" ? "Stop" : "Listen"}
				</button>
			</div>

			<div className="grid grid-cols-2 gap-1">
				<ActionButton
					icon={busy === "glossary" ? <Loader2Icon className="size-3.5 animate-spin" /> : <PlusIcon className="size-3.5" />}
					label="Add to glossary"
					disabled={glossaryDisabled}
					title={
						selection.text.length > MAX_GLOSSARY_CHARS
							? `Select up to ${MAX_GLOSSARY_CHARS} characters for a glossary term`
							: "Generate a definition and add it to the library"
					}
					onClick={() => void addToGlossary()}
				/>
				<ActionButton
					icon={busy === "highlight" ? <Loader2Icon className="size-3.5 animate-spin" /> : <HighlighterIcon className="size-3.5" />}
					label="Save highlight"
					disabled={highlightDisabled}
					title="Save this passage to the library"
					onClick={() => void saveHighlight()}
				/>
				<ActionButton
					icon={<BookOpenIcon className="size-3.5" />}
					label="Wikipedia"
					title={`Search Wikipedia in ${PRONOUNCE_LANGUAGE_NAMES[language]}`}
					onClick={() =>
						search(`https://${language}.wikipedia.org/w/index.php?search=${encodeURIComponent(selection.text)}`)
					}
				/>
				<ActionButton
					icon={<SearchIcon className="size-3.5" />}
					label="Google"
					title="Search the web"
					onClick={() => search(`https://www.google.com/search?q=${encodeURIComponent(selection.text)}`)}
				/>
			</div>

			{feedback ? (
				<p
					role="status"
					className={cn(
						"flex items-center gap-1 text-[11px] leading-snug",
						feedback.tone === "ok" && "text-foreground",
						feedback.tone === "warn" && "text-muted-foreground",
						feedback.tone === "error" && "text-destructive",
					)}
				>
					{feedback.tone === "ok" ? <CheckIcon className="size-3" /> : null}
					{feedback.text}
				</p>
			) : null}

			{!hasSource && (busy || feedback) ? (
				<p className="text-[10px] leading-snug text-muted-foreground/70">
					No chat source — the entry is saved without a backlink.
				</p>
			) : null}
		</div>,
		document.body,
	);
}

function ActionButton({
	icon,
	label,
	onClick,
	disabled,
	title,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	title?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className="inline-flex h-8 items-center justify-start gap-1.5 rounded-sm border border-border/70 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
		>
			{icon}
			<span className="truncate">{label}</span>
		</button>
	);
}
