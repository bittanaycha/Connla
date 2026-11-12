"use client";

/**
 * The on-highlight action popup (library wave): a single floating card for
 * Listen (Edge), Add to glossary, Save highlight, Wikipedia, Google, Translate,
 * and Create card — inline panels for a target language, a translation, an
 * explanation, deck choice, and direct-or-queued delivery to Anki.
 *
 * Mounted once in AppShell. It only appears for a non-collapsed selection
 * that starts and ends inside `[data-highlightable]` prose, so sidebar
 * drags and inputs never trigger it. The host page tags its passages and
 * message anchors; this component reads them, never owns them.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
	ArrowLeftIcon,
	BookOpenIcon,
	CheckIcon,
	CopyIcon,
	HighlighterIcon,
	LanguagesIcon,
	LayersIcon,
	Loader2Icon,
	PlusIcon,
	RefreshCwIcon,
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
	MAX_TRANSLATE_CHARS,
	PRONOUNCE_LANGUAGES,
	PRONOUNCE_LANGUAGE_NAMES,
	type GeneratedTranslation,
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
const DECK_STORAGE_KEY = "lh.cards.deck";
const TARGET_STORAGE_KEY = "lh.selection.target";
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

function storedTarget(): PronounceLanguage {
	try {
		const value = window.localStorage.getItem(TARGET_STORAGE_KEY);
		return value && isPronounceLanguage(value) ? value : "en";
	} catch {
		return "en";
	}
}

function rememberTarget(value: PronounceLanguage) {
	try {
		window.localStorage.setItem(TARGET_STORAGE_KEY, value);
	} catch {
		// private mode
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
	const [busy, setBusy] = useState<"glossary" | "highlight" | "translate" | "card" | "explain" | null>(null);
	const [mode, setMode] = useState<"actions" | "translate" | "card" | "explain">("actions");
	const [target, setTarget] = useState<PronounceLanguage>("en");
	const [translation, setTranslation] = useState<GeneratedTranslation | null>(null);
	const [translateError, setTranslateError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [explanation, setExplanation] = useState<string | null>(null);
	const [explainError, setExplainError] = useState<string | null>(null);
	const [deckName, setDeckName] = useState("Connla Cards");
	const [ankiDecks, setAnkiDecks] = useState<string[] | null>(null);
	const [ankiConnected, setAnkiConnected] = useState<boolean | null>(null);
	const [cardSaved, setCardSaved] = useState(false);
	const [popupHeight, setPopupHeight] = useState(0);
	const popupRef = useRef<HTMLDivElement | null>(null);
	const audioRef = useRef<EdgeAudioHandle | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const copyTimerRef = useRef<number | null>(null);

	useEffect(() => setMounted(true), []);

	// The card's height depends on its mode (a translation panel is taller
	// than the action grid), so the flip decision below measures it.
	useLayoutEffect(() => {
		const element = popupRef.current;
		if (!element) return;
		const measure = () => setPopupHeight(element.offsetHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [selection]);

	const chatId = pathname?.match(/^\/chat\/([^/]+)/)?.[1] ?? null;

	const close = () => {
		abortRef.current?.abort();
		releaseEdgeAudio(audioRef.current);
		audioRef.current = null;
		if (copyTimerRef.current !== null) {
			window.clearTimeout(copyTimerRef.current);
			copyTimerRef.current = null;
		}
		setListenState("idle");
		setSelection(null);
		setFeedback(null);
		setBusy(null);
		setMode("actions");
		setTranslation(null);
		setTranslateError(null);
		setCopied(false);
		setExplanation(null);
		setExplainError(null);
		setCardSaved(false);
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
			abortRef.current?.abort();
			abortRef.current = null;
			setBusy(null);
			setFeedback(null);
			setListenState("idle");
			releaseEdgeAudio(audioRef.current);
			audioRef.current = null;
			setMode("actions");
			setTranslation(null);
			setTranslateError(null);
			setCopied(false);
			setExplanation(null);
			setExplainError(null);
			setCardSaved(false);
			setTarget(storedTarget());
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
		const onScroll = (event: Event) => {
			// The popup scrolls its own long translation; that is not the page moving.
			if (popupRef.current?.contains(event.target as Node)) return;
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

	useEffect(() => {
		try {
			const saved = window.localStorage.getItem(DECK_STORAGE_KEY);
			if (saved) setDeckName(saved);
		} catch {
			// private mode
		}
	}, []);

	if (!mounted || !selection) return null;

	const glossaryDisabled = busy !== null || selection.text.length > MAX_GLOSSARY_CHARS;
	const highlightDisabled = busy !== null || selection.text.length > MAX_HIGHLIGHT_CHARS;
	const translateDisabled = busy !== null || selection.text.length > MAX_TRANSLATE_CHARS;
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

	const runTranslate = async (into: PronounceLanguage) => {
		abortRef.current?.abort();
		releaseEdgeAudio(audioRef.current);
		audioRef.current = null;
		setListenState("idle");
		const controller = new AbortController();
		abortRef.current = controller;
		setBusy("translate");
		setTranslateError(null);
		setTranslation(null);
		setCopied(false);
		let response: Response | null = null;
		try {
			response = await fetch("/api/translate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					text: selection.text,
					language,
					target: into,
					context: selection.context,
				}),
				signal: controller.signal,
			});
		} catch {
			response = null;
		}
		if (controller.signal.aborted) return;
		setBusy(null);
		const data = response
			? ((await response.json().catch(() => null)) as { translation?: string; note?: string } | null)
			: null;
		if (!response?.ok) {
			setTranslateError(
				response?.status === 503
					? "No model configured for translation."
					: response?.status === 422
						? `Select up to ${MAX_TRANSLATE_CHARS} characters to translate.`
						: "The translation could not be generated.",
			);
			return;
		}
		const text = typeof data?.translation === "string" ? data.translation : "";
		if (!text) {
			setTranslateError("The translation came back empty.");
			return;
		}
		setTranslation({ translation: text, note: typeof data?.note === "string" ? data.note : "" });
	};

	const startTranslate = () => {
		if (translateDisabled) return;
		setMode("translate");
		setCardSaved(false);
		ensureDecks();
		void runTranslate(target);
	};

	const loadAnkiDecks = async () => {
		try {
			const response = await fetch("/api/anki/decks");
			const body = (await response.json().catch(() => null)) as
				| { connected?: boolean; decks?: string[] }
				| null;
			setAnkiConnected(body?.connected === true);
			setAnkiDecks(Array.isArray(body?.decks) ? body.decks : []);
		} catch {
			setAnkiConnected(false);
			setAnkiDecks([]);
		}
	};

	const ensureDecks = () => {
		if (ankiDecks === null && ankiConnected === null) void loadAnkiDecks();
	};

	const startCard = () => {
		if (translateDisabled) return;
		setMode("card");
		setFeedback(null);
		setCardSaved(false);
		ensureDecks();
	};

	const runExplain = async () => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		setBusy("explain");
		setExplainError(null);
		setExplanation(null);
		setCardSaved(false);
		let response: Response | null = null;
		try {
			response = await fetch("/api/explain", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					text: selection.text,
					language,
					context: selection.context,
				}),
				signal: controller.signal,
			});
		} catch {
			response = null;
		}
		if (controller.signal.aborted) return;
		setBusy(null);
		const data = response
			? ((await response.json().catch(() => null)) as { explanation?: string } | null)
			: null;
		if (!response?.ok) {
			setExplainError(
				response?.status === 503
					? "No model configured for explanations."
					: response?.status === 422
						? `Select up to ${MAX_TRANSLATE_CHARS} characters to explain.`
						: "The explanation could not be generated.",
			);
			return;
		}
		const text = typeof data?.explanation === "string" ? data.explanation.trim() : "";
		if (!text) {
			setExplainError("The explanation came back empty.");
			return;
		}
		setExplanation(text);
	};

	const startExplain = () => {
		if (translateDisabled) return;
		setMode("explain");
		setFeedback(null);
		setCardSaved(false);
		ensureDecks();
		void runExplain();
	};

	const saveCard = async (kind: "translation" | "explanation") => {
		const back = kind === "translation" ? translation?.translation : explanation;
		if (!back || busy !== null || cardSaved || !deckName.trim()) return;
		setBusy("card");
		setFeedback(null);
		const created = await postAction("/api/cards", {
			kind,
			front: selection.text,
			back,
			note: kind === "translation" ? (translation?.note ?? "") : "",
			language,
			target: kind === "translation" ? target : null,
			source: { chatId, messageId: selection.messageId },
		});
		if (!created.ok) {
			setBusy(null);
			setFeedback({
				tone: "error",
				text:
					created.status === 422
						? `Select up to ${MAX_TRANSLATE_CHARS} characters for a card.`
						: "The card could not be saved.",
			});
			return;
		}
		const data = created.data as
			| { card?: { id: string }; duplicate?: boolean; warning?: string }
			| null;
		const cardId = data?.card?.id;
		const warning = data?.warning ? ` ${data.warning}` : "";
		let sent = false;
		let sendError = "";
		if (ankiConnected === true && cardId) {
			const delivered = await postAction("/api/cards/send", { deckName, ids: [cardId] });
			if (delivered.ok) {
				const body = delivered.data as { sent?: number; failed?: { error?: string }[] } | null;
				if (body?.sent) sent = true;
				else sendError = body?.failed?.[0]?.error ?? "Anki did not accept the card.";
			} else {
				sendError =
					(delivered.data as { error?: string } | null)?.error ?? "AnkiConnect is not reachable.";
			}
		}
		setBusy(null);
		setCardSaved(true);
		if (sent) {
			setFeedback({ tone: "ok", text: `Sent to Anki (${deckName}).${warning}` });
		} else if (sendError) {
			setFeedback({ tone: "warn", text: `Saved to Cards; ${sendError}${warning}` });
		} else {
			setFeedback({
				tone: data?.duplicate ? "warn" : "ok",
				text: data?.duplicate ? "Already in Cards." : `Saved to Cards.${warning}`,
			});
		}
	};

	const selectedDeck = (value: string) => {
		setDeckName(value);
		try {
			window.localStorage.setItem(DECK_STORAGE_KEY, value);
		} catch {
			// private mode
		}
	};

	const setChosenTarget = (value: string) => {
		if (!isPronounceLanguage(value) || value === target) return;
		setTarget(value);
		rememberTarget(value);
		void runTranslate(value);
	};

	const copyTranslation = async () => {
		if (!translation) return;
		try {
			await navigator.clipboard.writeText(translation.translation);
			setCopied(true);
			if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
			copyTimerRef.current = window.setTimeout(() => {
				copyTimerRef.current = null;
				setCopied(false);
			}, 1500);
		} catch {
			setFeedback({ tone: "error", text: "The clipboard was unavailable." });
		}
	};

	const copyExplanation = async () => {
		if (!explanation) return;
		try {
			await navigator.clipboard.writeText(explanation);
			setCopied(true);
			if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
			copyTimerRef.current = window.setTimeout(() => {
				copyTimerRef.current = null;
				setCopied(false);
			}, 1500);
		} catch {
			setFeedback({ tone: "error", text: "The clipboard was unavailable." });
		}
	};

	const backToActions = () => {
		abortRef.current?.abort();
		setBusy(null);
		setMode("actions");
		setTranslation(null);
		setTranslateError(null);
		setCopied(false);
		setExplanation(null);
		setExplainError(null);
		setCardSaved(false);
		setFeedback(null);
	};

	const cardControls = (kind: "translation" | "explanation") => (
		<div className="flex flex-col gap-1.5 rounded-sm border border-border/70 bg-muted/30 p-1.5">
			<div className="flex items-center gap-1">
				<label className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-sm border border-border/70 bg-background px-1.5 py-1">
					<span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">Deck</span>
					<input
						value={deckName}
						onChange={(event) => selectedDeck(event.target.value)}
						list="selection-anki-decks"
						aria-label="Anki deck name"
						className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none"
					/>
				</label>
				<button
					type="button"
					onClick={() => void loadAnkiDecks()}
					title="Check AnkiConnect"
					aria-label="Check AnkiConnect"
					className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<RefreshCwIcon className={cn("size-3", ankiConnected === null && "animate-spin")} />
				</button>
			</div>
			<datalist id="selection-anki-decks">
				{(ankiDecks ?? []).map((name) => (
					<option key={name} value={name} />
				))}
			</datalist>
			<button
				type="button"
				onClick={() => void saveCard(kind)}
				disabled={busy !== null || cardSaved || !deckName.trim()}
				className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-sm border border-border/70 bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
			>
				{busy === "card" ? <Loader2Icon className="size-3.5 animate-spin" /> : <LayersIcon className="size-3.5" />}
				{cardSaved ? "Saved" : ankiConnected === true ? "Send to Anki" : "Save to Cards"}
			</button>
			<p className="text-[10px] leading-snug text-muted-foreground">
				{ankiConnected === null
					? "Checking AnkiConnect…"
					: ankiConnected
						? `Sends to “${deckName}” when Anki is running.`
						: "AnkiConnect not connected — the card waits in the Cards queue."}
			</p>
		</div>
	);

	const left = Math.max(8, Math.min(selection.x - POPUP_WIDTH / 2, window.innerWidth - POPUP_WIDTH - 8));
	const height = popupHeight || 220;
	const top =
		selection.y + 8 > window.innerHeight - height - 8
			? Math.max(8, selection.y - height - 8)
			: selection.y + 8;

	return createPortal(
		<div
			ref={popupRef}
			role="dialog"
			aria-label="Selection actions"
			className="fixed z-[80] flex max-h-[calc(100dvh-1rem)] w-[19rem] flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-xl"
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

			{mode === "translate" ? (
				<div className="flex flex-col gap-2">
					<label className="inline-flex items-center gap-1 rounded-sm border border-border/70 px-1.5 py-1">
						<span className="shrink-0 text-[11px] text-muted-foreground">Into</span>
						<select
							value={target}
							onChange={(event) => setChosenTarget(event.target.value)}
							aria-label="Target language"
							className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none"
						>
							{PRONOUNCE_LANGUAGES.map((code) => (
								<option key={code} value={code}>
									{PRONOUNCE_LANGUAGE_NAMES[code]}
								</option>
							))}
						</select>
					</label>
					<div className="min-h-16 rounded-sm border border-border/70 px-2 py-1.5">
						{busy === "translate" ? (
							<p className="flex items-center gap-1.5 text-[11px] leading-snug text-muted-foreground">
								<Loader2Icon className="size-3 animate-spin" />
								Translating…
							</p>
						) : translateError ? (
							<p className="text-[11px] leading-snug text-destructive">{translateError}</p>
						) : translation ? (
							<div className="max-h-52 overflow-y-auto">
								<p className="whitespace-pre-wrap text-[13px] leading-snug text-foreground">{translation.translation}</p>
								{translation.note ? (
									<p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{translation.note}</p>
								) : null}
							</div>
						) : null}
					</div>
					<div className="grid grid-cols-2 gap-1">
						<ActionButton
							icon={copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
							label={copied ? "Copied" : "Copy"}
							disabled={!translation}
							title="Copy the translation"
							onClick={() => void copyTranslation()}
						/>
						<ActionButton
							icon={<ArrowLeftIcon className="size-3.5" />}
							label="Back"
							title="Back to the actions"
							onClick={backToActions}
						/>
					</div>
					{translation ? cardControls("translation") : null}
				</div>
			) : mode === "card" ? (
				<div className="flex flex-col gap-2">
					<p className="text-[11px] leading-snug text-muted-foreground">Make a card from this selection.</p>
					<button
						type="button"
						onClick={startTranslate}
						disabled={translateDisabled}
						className="inline-flex items-center gap-2 rounded-sm border border-border/70 px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
					>
						<LanguagesIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0">
							<span className="block text-[11px] font-medium text-foreground">Translation</span>
							<span className="block truncate text-[10px] text-muted-foreground">
								Source + audio → {PRONOUNCE_LANGUAGE_NAMES[target]}
							</span>
						</span>
					</button>
					<button
						type="button"
						onClick={startExplain}
						disabled={translateDisabled}
						className="inline-flex items-center gap-2 rounded-sm border border-border/70 px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
					>
						<BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0">
							<span className="block text-[11px] font-medium text-foreground">Explanation</span>
							<span className="block truncate text-[10px] text-muted-foreground">
								The selected text, explained
							</span>
						</span>
					</button>
					<ActionButton
						icon={<ArrowLeftIcon className="size-3.5" />}
						label="Back"
						title="Back to the actions"
						onClick={backToActions}
					/>
				</div>
			) : mode === "explain" ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-medium text-foreground">Explanation</span>
					</div>
					<div className="min-h-16 rounded-sm border border-border/70 px-2 py-1.5">
						{busy === "explain" ? (
							<p className="flex items-center gap-1.5 text-[11px] leading-snug text-muted-foreground">
								<Loader2Icon className="size-3 animate-spin" />
								Explaining…
							</p>
						) : explainError ? (
							<p className="text-[11px] leading-snug text-destructive">{explainError}</p>
						) : explanation ? (
							<div className="max-h-52 overflow-y-auto">
								<p className="whitespace-pre-wrap text-[13px] leading-snug text-foreground">{explanation}</p>
							</div>
						) : null}
					</div>
					{explanation ? cardControls("explanation") : null}
					<div className="grid grid-cols-2 gap-1">
						<ActionButton
							icon={copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
							label={copied ? "Copied" : "Copy"}
							disabled={!explanation}
							title="Copy the explanation"
							onClick={() => void copyExplanation()}
						/>
						<ActionButton
							icon={<ArrowLeftIcon className="size-3.5" />}
							label="Back"
							title="Back to the actions"
							onClick={backToActions}
						/>
					</div>
				</div>
			) : (
				<>
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
					<button
						type="button"
						onClick={startTranslate}
						disabled={translateDisabled}
						title={
							selection.text.length > MAX_TRANSLATE_CHARS
								? `Select up to ${MAX_TRANSLATE_CHARS} characters to translate`
								: `Translate into ${PRONOUNCE_LANGUAGE_NAMES[target]}`
						}
						className="inline-flex h-8 w-full items-center justify-start gap-1.5 rounded-sm border border-border/70 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
					>
						<LanguagesIcon className="size-3.5" />
						Translate into {PRONOUNCE_LANGUAGE_NAMES[target]}
					</button>
					<button
						type="button"
						onClick={startCard}
						disabled={translateDisabled}
						title={
							selection.text.length > MAX_TRANSLATE_CHARS
								? `Select up to ${MAX_TRANSLATE_CHARS} characters to make a card`
								: "Make an Anki card from this selection"
						}
						className="inline-flex h-8 w-full items-center justify-start gap-1.5 rounded-sm border border-border/70 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
					>
						<LayersIcon className="size-3.5" />
						Create card
					</button>
				</>
			)}

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
