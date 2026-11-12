"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
	BookMarkedIcon,
	BookOpenIcon,
	DownloadIcon,
	CheckIcon,
	CopyIcon,
	ExternalLinkIcon,
	HighlighterIcon,
	LayersIcon,
	Loader2Icon,
	PencilIcon,
	PlayIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
	SendIcon,
	SquareIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fetchEdgeAudio, releaseEdgeAudio } from "@/lib/edge-audio";
import {
	PRONOUNCE_LANGUAGE_NAMES,
	flashcardKindLabel,
	type AnkiExportDetails,
	type FlashcardRecord,
	type GlossaryEntry,
	type HighlightEntry,
	type LibrarySource,
	type ReadingItem,
} from "@/src/core";

type Tab = "glossary" | "highlights" | "reading" | "cards";

const TABS: { id: Tab; label: string; icon: typeof BookMarkedIcon }[] = [
	{ id: "glossary", label: "Glossary", icon: BookMarkedIcon },
	{ id: "highlights", label: "Highlights", icon: HighlighterIcon },
	{ id: "reading", label: "Reading list", icon: BookOpenIcon },
	{ id: "cards", label: "Cards", icon: LayersIcon },
];

interface Props {
	initialGlossary: GlossaryEntry[];
	initialHighlights: HighlightEntry[];
	initialReading: ReadingItem[];
	initialCards: FlashcardRecord[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** UTC parts, not toLocaleDateString: server and browser must render the same string. */
function formatDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function sourceHref(source: LibrarySource): string | null {
	if (!source.chatId) return null;
	return `/chat/${source.chatId}${source.messageId ? `#message-${source.messageId}` : ""}`;
}

async function readBody<T>(response: Response): Promise<T> {
	const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status}).`);
	return body as T;
}

function SourceLine({ source, createdAt }: { source: LibrarySource; createdAt: string }) {
	const href = sourceHref(source);
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-ui text-[11px] text-muted-foreground">
			{href && (
				<Link href={href} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
					<ExternalLinkIcon className="size-3" />
					Open source
				</Link>
			)}
			<span>{formatDate(createdAt)}</span>
		</div>
	);
}

export function LibraryView({ initialGlossary, initialHighlights, initialReading, initialCards }: Props) {
	const [tab, setTab] = useState<Tab>("glossary");
	const [query, setQuery] = useState("");
	const [glossary, setGlossary] = useState(initialGlossary);
	const [highlights, setHighlights] = useState(initialHighlights);
	const [reading, setReading] = useState(initialReading);
	const [cards, setCards] = useState(initialCards);
	const [deckName, setDeckName] = useState("Connla Cards");
	const [ankiConnected, setAnkiConnected] = useState<boolean | null>(null);
	const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
	const [playingCard, setPlayingCard] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [playing, setPlaying] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [pendingDelete, setPendingDelete] = useState<string | null>(null);

	const [editingGlossary, setEditingGlossary] = useState<{
		id: string;
		term: string;
		partOfSpeech: string;
		definition: string;
	} | null>(null);

	const [addingReading, setAddingReading] = useState(false);
	const [readingDraft, setReadingDraft] = useState({ title: "", author: "", url: "", note: "" });
	const [editingReading, setEditingReading] = useState<{
		id: string;
		title: string;
		author: string;
		url: string;
		note: string;
	} | null>(null);

	const audioRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
	const cardAudioRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		return () => {
			releaseEdgeAudio(audioRef.current);
			audioRef.current = null;
			cardAudioRef.current?.pause();
			cardAudioRef.current = null;
		};
	}, []);

	const q = query.trim().toLowerCase();

	const glossaryRows = useMemo(
		() =>
			glossary
				.filter(
					(entry) =>
						!q ||
						[entry.term, entry.form, entry.partOfSpeech, entry.definition].some((value) =>
							value.toLowerCase().includes(q),
						),
				)
				.slice()
				.reverse(),
		[glossary, q],
	);

	const highlightRows = useMemo(
		() =>
			highlights
				.filter((entry) => !q || entry.text.toLowerCase().includes(q))
				.slice()
				.reverse(),
		[highlights, q],
	);

	const readingRows = useMemo(
		() =>
			reading
				.filter(
					(entry) =>
						!q ||
						[entry.title, entry.author, entry.note].some((value) => value.toLowerCase().includes(q)),
				)
				.slice()
				.reverse(),
		[reading, q],
	);

	const cardRows = useMemo(
		() =>
			cards
				.filter(
					(entry) =>
						!q ||
						[entry.front, entry.back, entry.note].some((value) => value.toLowerCase().includes(q)),
				)
				.slice()
				.reverse(),
		[cards, q],
	);

	const counts: Record<Tab, number> = {
		glossary: glossary.length,
		highlights: highlights.length,
		reading: reading.length,
		cards: cards.length,
	};

	function flash(message: string) {
		setNotice(message);
		window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2500);
	}

	function noteError(value: unknown) {
		setError(value instanceof Error ? value.message : "Something went wrong.");
	}

	function stopAudio() {
		releaseEdgeAudio(audioRef.current);
		audioRef.current = null;
		setPlaying(null);
	}

	function stopCardAudio() {
		cardAudioRef.current?.pause();
		cardAudioRef.current = null;
		setPlayingCard(null);
	}

	function selectedDeck(value: string) {
		setDeckName(value);
		window.localStorage.setItem("lh.cards.deck", value);
	}

	async function loadAnkiDecks() {
		try {
			const response = await fetch("/api/anki/decks");
			const body = (await response.json().catch(() => null)) as
				| { connected?: boolean; decks?: string[] }
				| null;
			const connected = body?.connected === true;
			setAnkiConnected(connected);
			setAnkiDecks(Array.isArray(body?.decks) ? body.decks : []);
		} catch {
			setAnkiConnected(false);
			setAnkiDecks([]);
		}
	}

	async function playCard(entry: FlashcardRecord) {
		stopCardAudio();
		setError(null);
		const audio = new Audio(`/api/cards/${entry.id}/audio`);
		cardAudioRef.current = audio;
		setPlayingCard(entry.id);
		audio.onended = () => {
			if (cardAudioRef.current === audio) cardAudioRef.current = null;
			setPlayingCard((current) => (current === entry.id ? null : current));
		};
		try {
			await audio.play();
		} catch {
			if (cardAudioRef.current === audio) cardAudioRef.current = null;
			setPlayingCard(null);
			setError("Audio could not play.");
		}
	}

	async function removeCard(entry: FlashcardRecord) {
		setBusy(`card-delete:${entry.id}`);
		setError(null);
		try {
			await readBody(await fetch(`/api/cards/${entry.id}`, { method: "DELETE" }));
			setCards((rows) => rows.filter((row) => row.id !== entry.id));
			setPendingDelete(null);
			if (playingCard === entry.id) stopCardAudio();
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	async function exportCards() {
		setBusy("cards:export");
		setError(null);
		try {
			const details = await readBody<AnkiExportDetails>(
				await fetch("/api/cards/export", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ deckName }),
				}),
			);
			const link = document.createElement("a");
			link.href = details.downloadUrl;
			link.download = "";
			document.body.appendChild(link);
			link.click();
			link.remove();
			flash(`Built “${details.deckName}” — ${details.cardCount} cards.`);
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	async function sendAllCards() {
		setBusy("cards:send");
		setError(null);
		try {
			const response = await fetch("/api/cards/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deckName }),
			});
			const body = (await response.json().catch(() => null)) as
				| { sent?: number; failed?: { error?: string }[]; error?: string }
				| null;
			if (!response.ok && !body?.failed?.length) {
				throw new Error(body?.error ?? `Request failed (${response.status}).`);
			}
			const sent = body?.sent ?? 0;
			const failed = body?.failed ?? [];
			const list = await readBody<{ cards: FlashcardRecord[] }>(await fetch("/api/cards"));
			setCards(list.cards);
			if (failed.length) {
				setError(`${sent} sent; ${failed.length} still queued — ${failed[0]?.error ?? "Anki did not accept them."}`);
			} else {
				flash(`Sent ${sent} card${sent === 1 ? "" : "s"} to Anki.`);
			}
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	useEffect(() => {
		const saved = window.localStorage.getItem("lh.cards.deck");
		if (saved) setDeckName(saved);
	}, []);

	const ankiLoaded = useRef(false);
	useEffect(() => {
		if (tab !== "cards" || ankiLoaded.current) return;
		ankiLoaded.current = true;
		void loadAnkiDecks();
	}, [tab]);

	async function playWord(entry: GlossaryEntry) {
		stopAudio();
		setError(null);
		setPlaying(entry.id);
		const handle = await fetchEdgeAudio(entry.form || entry.term, entry.language);
		if (!handle) {
			setPlaying(null);
			setError(`No audio for “${entry.term}” in ${PRONOUNCE_LANGUAGE_NAMES[entry.language]}.`);
			return;
		}
		audioRef.current = handle;
		handle.audio.onended = () => {
			if (audioRef.current === handle) {
				releaseEdgeAudio(handle);
				audioRef.current = null;
			}
			setPlaying((current) => (current === entry.id ? null : current));
		};
		void handle.audio.play().catch(() => {
			releaseEdgeAudio(handle);
			if (audioRef.current === handle) audioRef.current = null;
			setPlaying(null);
			setError("Audio could not play.");
		});
	}

	async function regenerate(entry: GlossaryEntry) {
		setBusy(`regen:${entry.id}`);
		setError(null);
		try {
			const body = await readBody<{ entry: GlossaryEntry }>(
				await fetch(`/api/glossary/${entry.id}/regenerate`, { method: "POST" }),
			);
			setGlossary((rows) => rows.map((row) => (row.id === body.entry.id ? body.entry : row)));
			flash("Definition regenerated.");
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	async function saveGlossary() {
		if (!editingGlossary) return;
		setBusy(`glossary:${editingGlossary.id}`);
		setError(null);
		try {
			const body = await readBody<{ entry: GlossaryEntry }>(
				await fetch(`/api/glossary/${editingGlossary.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						term: editingGlossary.term,
						partOfSpeech: editingGlossary.partOfSpeech,
						definition: editingGlossary.definition,
					}),
				}),
			);
			setGlossary((rows) => rows.map((row) => (row.id === body.entry.id ? body.entry : row)));
			setEditingGlossary(null);
			flash("Glossary entry saved.");
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	async function removeGlossary(entry: GlossaryEntry) {
		setBusy(`delete:${entry.id}`);
		setError(null);
		try {
			await readBody(await fetch(`/api/glossary/${entry.id}`, { method: "DELETE" }));
			setGlossary((rows) => rows.filter((row) => row.id !== entry.id));
			setPendingDelete(null);
			if (playing === entry.id) stopAudio();
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	async function removeHighlight(entry: HighlightEntry) {
		setBusy(`delete:${entry.id}`);
		setError(null);
		try {
			await readBody(await fetch(`/api/highlights/${entry.id}`, { method: "DELETE" }));
			setHighlights((rows) => rows.filter((row) => row.id !== entry.id));
			setPendingDelete(null);
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	async function copyHighlight(entry: HighlightEntry) {
		try {
			await navigator.clipboard.writeText(entry.text);
			setCopied(entry.id);
			window.setTimeout(() => setCopied((current) => (current === entry.id ? null : current)), 1500);
		} catch {
			setError("The clipboard is unavailable.");
		}
	}

	async function addReading() {
		const title = readingDraft.title.trim();
		if (!title) {
			setError("A reading item needs a title.");
			return;
		}
		setBusy("reading:add");
		setError(null);
		try {
			const body = await readBody<{ entry: ReadingItem; duplicate?: boolean }>(
				await fetch("/api/reading", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(readingDraft),
				}),
			);
			setReading((rows) => (body.duplicate ? rows : [...rows, body.entry]));
			setReadingDraft({ title: "", author: "", url: "", note: "" });
			setAddingReading(false);
			flash(body.duplicate ? "That item is already on the list." : "Added to the reading list.");
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	async function saveReading() {
		if (!editingReading) return;
		setBusy(`reading:${editingReading.id}`);
		setError(null);
		try {
			const body = await readBody<{ entry: ReadingItem }>(
				await fetch(`/api/reading/${editingReading.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: editingReading.title,
						author: editingReading.author,
						url: editingReading.url,
						note: editingReading.note,
					}),
				}),
			);
			setReading((rows) => rows.map((row) => (row.id === body.entry.id ? body.entry : row)));
			setEditingReading(null);
			flash("Reading item saved.");
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	async function removeReading(entry: ReadingItem) {
		setBusy(`delete:${entry.id}`);
		setError(null);
		try {
			await readBody(await fetch(`/api/reading/${entry.id}`, { method: "DELETE" }));
			setReading((rows) => rows.filter((row) => row.id !== entry.id));
			setPendingDelete(null);
		} catch (value) {
			noteError(value);
		} finally {
			setBusy(null);
		}
	}

	function DeleteControl({
		id,
		label,
		onDelete,
	}: {
		id: string;
		label: string;
		onDelete: () => void;
	}) {
		if (pendingDelete === id) {
			return (
				<span className="flex items-center gap-1">
					<Button size="xs" variant="destructive" onClick={onDelete} disabled={busy !== null}>
						Delete
					</Button>
					<Button size="icon-xs" variant="ghost" aria-label="Cancel delete" onClick={() => setPendingDelete(null)}>
						<XIcon />
					</Button>
				</span>
			);
		}
		return (
			<Button
				size="icon-xs"
				variant="ghost"
				aria-label={label}
				title={label}
				onClick={() => setPendingDelete(id)}
			>
				<Trash2Icon />
			</Button>
		);
	}

	const emptyCopy: Record<Tab, string> = {
		glossary: "No terms yet. Select a word or phrase in a session and choose Add to glossary.",
		highlights: "No highlights yet. Select a passage in a session and choose Save highlight.",
		reading: "The reading list is empty. Add a book, article, or course you want to come back to.",
		cards: "No cards yet. Select text in a session and choose Create card, or ask the teacher for an Anki deck.",
	};

	return (
		<main className="h-full overflow-y-auto bg-background">
			<div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6">
				<header>
					<h1 className="font-serif text-3xl leading-none tracking-tight">Library</h1>
					<p className="mt-2 font-serif text-sm text-muted-foreground">
						Definitions, passages, reading, and cards.
					</p>
				</header>

				<nav className="mt-6 flex flex-wrap items-end gap-x-5 gap-y-1 border-b border-border/60">
					{TABS.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							onClick={() => {
								setTab(id);
								setError(null);
								setPendingDelete(null);
							}}
							className={cn(
								"-mb-px inline-flex items-center gap-1.5 border-b-2 px-0.5 pb-2 font-ui text-xs uppercase tracking-wider transition-colors",
								tab === id
									? "border-foreground text-foreground"
									: "border-transparent text-muted-foreground hover:text-foreground",
							)}
						>
							<Icon className="size-3.5" />
							{label}
							<span className="font-ui text-[10px] tabular-nums text-muted-foreground">{counts[id]}</span>
						</button>
					))}
				</nav>

				<div className="mt-4 flex items-center gap-2">
					<div className="relative flex-1">
						<SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={`Search ${TABS.find((entry) => entry.id === tab)?.label.toLowerCase() ?? ""}`}
							className="h-8 pl-8 font-ui text-xs"
						/>
					</div>
					{tab === "reading" && (
						<Button size="sm" variant="outline" onClick={() => setAddingReading((value) => !value)}>
							<PlusIcon />
							Add
						</Button>
					)}
				</div>

				{(error || notice) && (
					<div
						role="status"
						className={cn(
							"mt-3 rounded-md border px-3 py-2 font-ui text-xs",
							error
								? "border-destructive/40 bg-destructive/5 text-destructive"
								: "border-border bg-muted/40 text-muted-foreground",
						)}
					>
						{error ?? notice}
					</div>
				)}

				{tab === "cards" && (
					<div className="mt-3 rounded-lg border bg-card/40 p-3">
						<div className="flex flex-wrap items-end gap-2">
							<label className="min-w-40 flex-1">
								<span className="mb-1 block font-ui text-[10px] uppercase tracking-wider text-muted-foreground">
									Deck
								</span>
								<Input
									value={deckName}
									list="anki-deck-names"
									onChange={(event) => selectedDeck(event.target.value)}
									placeholder="Connla Cards"
									className="h-8 font-serif"
								/>
								<datalist id="anki-deck-names">
									{ankiDecks.map((name) => (
										<option key={name} value={name} />
									))}
								</datalist>
							</label>
							<Button
								size="sm"
								variant="outline"
								onClick={() => void exportCards()}
								disabled={!cards.length || busy !== null}
							>
								{busy === "cards:export" ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
								Download .apkg
							</Button>
							<Button
								size="sm"
								onClick={() => void sendAllCards()}
								disabled={!cards.length || busy !== null || ankiConnected !== true}
							>
								{busy === "cards:send" ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
								Send all
							</Button>
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label="Check AnkiConnect"
								title="Check AnkiConnect"
								onClick={() => void loadAnkiDecks()}
							>
								<RefreshCwIcon />
							</Button>
						</div>
						<p className="mt-2 font-ui text-[11px] text-muted-foreground">
							{ankiConnected === null
								? "Checking AnkiConnect…"
								: ankiConnected
									? "AnkiConnect is running. Send all, or download a standalone deck."
									: "AnkiConnect is not running; cards stay queued. Download a standalone deck instead, or install the AnkiConnect add-on (code 2055492159)."}
						</p>
					</div>
				)}

				{tab === "reading" && addingReading && (
					<form
						className="mt-3 grid gap-2 rounded-lg border bg-card/40 p-3"
						onSubmit={(event) => {
							event.preventDefault();
							void addReading();
						}}
					>
						<Input
							autoFocus
							placeholder="Title"
							value={readingDraft.title}
							onChange={(event) => setReadingDraft({ ...readingDraft, title: event.target.value })}
							className="h-8 font-serif"
						/>
						<div className="grid gap-2 sm:grid-cols-2">
							<Input
								placeholder="Author or source"
								value={readingDraft.author}
								onChange={(event) => setReadingDraft({ ...readingDraft, author: event.target.value })}
								className="h-8"
							/>
							<Input
								placeholder="Link (https://…)"
								value={readingDraft.url}
								onChange={(event) => setReadingDraft({ ...readingDraft, url: event.target.value })}
								className="h-8"
							/>
						</div>
						<textarea
							placeholder="Note (optional)"
							value={readingDraft.note}
							onChange={(event) => setReadingDraft({ ...readingDraft, note: event.target.value })}
							className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
						/>
						<div className="flex items-center justify-end gap-2">
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => {
									setAddingReading(false);
									setReadingDraft({ title: "", author: "", url: "", note: "" });
								}}
							>
								Cancel
							</Button>
							<Button type="submit" size="sm" disabled={busy === "reading:add"}>
								{busy === "reading:add" && <Loader2Icon className="animate-spin" />}
								Add
							</Button>
						</div>
					</form>
				)}

				<div className="mt-2">
					{tab === "glossary" &&
						(glossaryRows.length === 0 ? (
							<p className="py-10 text-center font-serif text-sm text-muted-foreground">
								{q ? "No terms match that search." : emptyCopy.glossary}
							</p>
						) : (
							glossaryRows.map((entry) => {
								const editing = editingGlossary?.id === entry.id;
								return (
									<article key={entry.id} className="border-b border-border/50 py-4">
										<div className="flex items-start gap-2">
											<div className="min-w-0 flex-1">
												{editing ? (
													<div className="grid gap-2">
														<Input
															value={editingGlossary.term}
															onChange={(event) =>
																setEditingGlossary({ ...editingGlossary, term: event.target.value })
															}
															className="h-8 font-serif"
														/>
														<Input
															value={editingGlossary.partOfSpeech}
															onChange={(event) =>
																setEditingGlossary({
																	...editingGlossary,
																	partOfSpeech: event.target.value,
																})
															}
															placeholder="Part of speech"
															className="h-8"
														/>
														<textarea
															value={editingGlossary.definition}
															onChange={(event) =>
																setEditingGlossary({
																	...editingGlossary,
																	definition: event.target.value,
																})
															}
															className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 font-serif text-sm outline-none focus-visible:border-ring"
														/>
														<div className="flex items-center justify-end gap-2">
															<Button size="xs" variant="ghost" onClick={() => setEditingGlossary(null)}>
																Cancel
															</Button>
															<Button size="xs" onClick={() => void saveGlossary()} disabled={busy !== null}>
																{busy === `glossary:${entry.id}` && <Loader2Icon className="animate-spin" />}
																Save
															</Button>
														</div>
													</div>
												) : (
													<>
														<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
															<h2 className="font-serif text-lg leading-snug">{entry.term}</h2>
															{entry.form && entry.form !== entry.term && (
																<span className="font-ui text-[11px] text-muted-foreground">
																	{entry.form}
																</span>
															)}
															<span className="font-ui text-[10px] uppercase tracking-wider text-muted-foreground">
																{PRONOUNCE_LANGUAGE_NAMES[entry.language] ?? entry.language}
															</span>
															{entry.partOfSpeech && (
																<span className="rounded-full border border-border px-1.5 py-0.5 font-ui text-[10px] text-muted-foreground">
																	{entry.partOfSpeech}
																</span>
															)}
														</div>
														<p className="mt-1.5 font-serif text-sm leading-relaxed text-foreground/90">
															{entry.definition}
														</p>
													</>
												)}
												{!editing && (
													<div className="mt-1.5">
														<SourceLine source={entry.source} createdAt={entry.createdAt} />
													</div>
												)}
											</div>
											{!editing && (
												<div className="flex shrink-0 items-center gap-0.5">
													<Button
														size="icon-xs"
														variant="ghost"
														aria-label={`Play ${entry.term}`}
														title="Play"
														onClick={() => void playWord(entry)}
													>
														{playing === entry.id ? (
															<Loader2Icon className="animate-spin" />
														) : (
															<PlayIcon />
														)}
													</Button>
													<Button
														size="icon-xs"
														variant="ghost"
														aria-label={`Edit ${entry.term}`}
														title="Edit"
														onClick={() =>
															setEditingGlossary({
																id: entry.id,
																term: entry.term,
																partOfSpeech: entry.partOfSpeech,
																definition: entry.definition,
															})
														}
													>
														<PencilIcon />
													</Button>
													<Button
														size="icon-xs"
														variant="ghost"
														aria-label={`Regenerate ${entry.term}`}
														title="Regenerate definition"
														onClick={() => void regenerate(entry)}
														disabled={busy !== null}
													>
														{busy === `regen:${entry.id}` ? (
															<Loader2Icon className="animate-spin" />
														) : (
															<RefreshCwIcon />
														)}
													</Button>
													<DeleteControl
														id={entry.id}
														label={`Delete ${entry.term}`}
														onDelete={() => void removeGlossary(entry)}
													/>
												</div>
											)}
										</div>
									</article>
								);
							})
						))}

					{tab === "highlights" &&
						(highlightRows.length === 0 ? (
							<p className="py-10 text-center font-serif text-sm text-muted-foreground">
								{q ? "No highlights match that search." : emptyCopy.highlights}
							</p>
						) : (
							highlightRows.map((entry) => (
								<article key={entry.id} className="border-b border-border/50 py-4">
									<div className="flex items-start gap-2">
										<blockquote className="min-w-0 flex-1 border-l-2 border-muted-foreground/30 pl-3 font-serif text-[15px] leading-relaxed">
											{entry.text}
										</blockquote>
										<div className="flex shrink-0 items-center gap-0.5">
											<Button
												size="icon-xs"
												variant="ghost"
												aria-label="Copy highlight"
												title="Copy"
												onClick={() => void copyHighlight(entry)}
											>
												{copied === entry.id ? <CheckIcon /> : <CopyIcon />}
											</Button>
											<DeleteControl
												id={entry.id}
												label="Delete highlight"
												onDelete={() => void removeHighlight(entry)}
											/>
										</div>
									</div>
									<div className="mt-2 pl-5">
										<SourceLine source={entry.source} createdAt={entry.createdAt} />
									</div>
								</article>
							))
						))}

					{tab === "cards" &&
						(cardRows.length === 0 ? (
							<p className="py-10 text-center font-serif text-sm text-muted-foreground">
								{q ? "No cards match that search." : emptyCopy.cards}
							</p>
						) : (
							cardRows.map((entry) => (
								<article key={entry.id} className="border-b border-border/50 py-4">
									<div className="flex items-start gap-2">
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-x-2 font-ui text-[10px] uppercase tracking-wider text-muted-foreground">
												<span>{flashcardKindLabel(entry.kind)}</span>
												{entry.kind === "translation" && entry.target && (
													<span>
														{PRONOUNCE_LANGUAGE_NAMES[entry.language] ?? entry.language} →{" "}
														{PRONOUNCE_LANGUAGE_NAMES[entry.target] ?? entry.target}
													</span>
												)}
											</div>
											<p className="mt-1 whitespace-pre-wrap font-serif text-sm">{entry.front}</p>
											<p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{entry.back}</p>
											{entry.note && (
												<p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>
											)}
											<div className="mt-2">
												<SourceLine source={entry.source} createdAt={entry.createdAt} />
											</div>
										</div>
										<div className="flex shrink-0 items-center gap-1">
											{entry.audio && (
												<Button
													size="icon-xs"
													variant="ghost"
													aria-label={playingCard === entry.id ? "Stop audio" : "Play audio"}
													title={playingCard === entry.id ? "Stop audio" : "Play audio"}
													onClick={() =>
														playingCard === entry.id ? stopCardAudio() : void playCard(entry)
													}
												>
													{playingCard === entry.id ? <SquareIcon /> : <PlayIcon />}
												</Button>
											)}
											<DeleteControl
												id={entry.id}
												label="Delete card"
												onDelete={() => void removeCard(entry)}
											/>
										</div>
									</div>
								</article>
							))
						))}

					{tab === "reading" &&
						(readingRows.length === 0 ? (
							<p className="py-10 text-center font-serif text-sm text-muted-foreground">
								{q ? "No reading items match that search." : emptyCopy.reading}
							</p>
						) : (
							readingRows.map((entry) => {
								const editing = editingReading?.id === entry.id;
								return (
									<article key={entry.id} className="border-b border-border/50 py-4">
										{editing ? (
											<div className="grid gap-2">
												<Input
													value={editingReading.title}
													onChange={(event) => setEditingReading({ ...editingReading, title: event.target.value })}
													className="h-8 font-serif"
												/>
												<div className="grid gap-2 sm:grid-cols-2">
													<Input
														placeholder="Author or source"
														value={editingReading.author}
														onChange={(event) =>
															setEditingReading({ ...editingReading, author: event.target.value })
														}
														className="h-8"
													/>
													<Input
														placeholder="Link (https://…)"
														value={editingReading.url}
														onChange={(event) =>
															setEditingReading({ ...editingReading, url: event.target.value })
														}
														className="h-8"
													/>
												</div>
												<textarea
													value={editingReading.note}
													placeholder="Note"
													onChange={(event) => setEditingReading({ ...editingReading, note: event.target.value })}
													className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
												/>
												<div className="flex items-center justify-end gap-2">
													<Button size="xs" variant="ghost" onClick={() => setEditingReading(null)}>
														Cancel
													</Button>
													<Button size="xs" onClick={() => void saveReading()} disabled={busy !== null}>
														{busy === `reading:${entry.id}` && <Loader2Icon className="animate-spin" />}
														Save
													</Button>
												</div>
											</div>
										) : (
											<div className="flex items-start gap-2">
												<div className="min-w-0 flex-1">
													<h2 className="font-serif text-lg leading-snug">
														{/^https?:\/\//i.test(entry.url) ? (
															<a
																href={entry.url}
																target="_blank"
																rel="noopener noreferrer"
																className="hover:underline"
															>
																{entry.title}
															</a>
														) : (
															entry.title
														)}
													</h2>
													{entry.author && (
														<p className="mt-0.5 font-ui text-[11px] text-muted-foreground">{entry.author}</p>
													)}
													{entry.note && (
														<p className="mt-1.5 whitespace-pre-wrap font-serif text-sm leading-relaxed text-foreground/80">
															{entry.note}
														</p>
													)}
													<div className="mt-1.5">
														<SourceLine source={entry.source} createdAt={entry.createdAt} />
													</div>
												</div>
												<div className="flex shrink-0 items-center gap-0.5">
													<Button
														size="icon-xs"
														variant="ghost"
														aria-label={`Edit ${entry.title}`}
														title="Edit"
														onClick={() =>
															setEditingReading({
																id: entry.id,
																title: entry.title,
																author: entry.author,
																url: entry.url,
																note: entry.note,
															})
														}
													>
														<PencilIcon />
													</Button>
													<DeleteControl
														id={entry.id}
														label={`Delete ${entry.title}`}
														onDelete={() => void removeReading(entry)}
													/>
												</div>
											</div>
										)}
									</article>
								);
							})
						))}
				</div>
			</div>
		</main>
	);
}
