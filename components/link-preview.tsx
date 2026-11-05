"use client";

import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import type { LinkPreview } from "@/src/core";

/** Streamdown's default markdown-anchor treatment. A custom `a` component
 *  replaces MarkdownA, so it has to carry this itself or links lose their
 *  emphasis and underline. */
export const MARKDOWN_LINK_CLASS = "wrap-anywhere font-medium text-primary underline";

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;

interface CachedPreview {
	value: LinkPreview | null;
	expires: number;
}

const previewCache = new Map<string, CachedPreview>();
const inFlight = new Map<string, Promise<LinkPreview | null>>();

function readCache(url: string): LinkPreview | null | undefined {
	const hit = previewCache.get(url);
	if (!hit) return undefined;
	return hit.expires > Date.now() ? hit.value : undefined;
}

function isPreview(value: unknown): value is LinkPreview {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.url === "string" &&
		typeof record.title === "string" &&
		typeof record.siteName === "string" &&
		(record.kind === "wikipedia" || record.kind === "web")
	);
}

async function loadPreview(url: string): Promise<LinkPreview | null> {
	const cached = readCache(url);
	if (cached !== undefined) return cached;
	const pending = inFlight.get(url);
	if (pending) return pending;

	const request = (async () => {
		let value: LinkPreview | null = null;
		try {
			const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
				cache: "no-store",
			});
			if (response.ok) {
				const data: unknown = await response.json();
				if (isPreview(data)) value = data;
			}
		} catch {
			value = null;
		}
		previewCache.set(url, {
			value,
			expires: Date.now() + (value ? PREVIEW_TTL_MS : FAILURE_TTL_MS),
		});
		return value;
	})().finally(() => {
		inFlight.delete(url);
	});

	inFlight.set(url, request);
	return request;
}

function hostname(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function PreviewImage({ src }: { src: string }) {
	const [visible, setVisible] = useState(true);
	if (!visible) return null;
	return (
		// eslint-disable-next-line @next/next/no-img-element -- remote OG images, not app assets
		<img
			src={src}
			alt=""
			referrerPolicy="no-referrer"
			className="h-32 w-full border-b object-cover"
			onError={() => setVisible(false)}
		/>
	);
}

function WikipediaMark() {
	return (
		<span
			aria-hidden="true"
			className="grid size-4 shrink-0 place-items-center rounded-[3px] bg-foreground/10 font-serif text-[10px] font-bold leading-none"
		>
			W
		</span>
	);
}

function PreviewCard({ url, onFail }: { url: string; onFail: () => void }) {
	const [preview, setPreview] = useState<LinkPreview | null>(null);
	const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

	useEffect(() => {
		let cancelled = false;
		const cached = readCache(url);
		if (cached === null) {
			setStatus("failed");
			return;
		}
		if (cached) {
			setPreview(cached);
			setStatus("ready");
			return;
		}
		setStatus("loading");
		void loadPreview(url).then((result) => {
			if (cancelled) return;
			if (result) {
				setPreview(result);
				setStatus("ready");
			} else {
				setStatus("failed");
			}
		});
		return () => {
			cancelled = true;
		};
	}, [url]);

	useEffect(() => {
		if (status === "failed") onFail();
	}, [status, onFail]);

	if (status === "failed") return null;

	if (status === "loading" || !preview) {
		return (
			<div className="w-full overflow-hidden rounded-xl border bg-popover shadow-lg">
				<div className="h-24 animate-pulse bg-muted" />
				<div className="space-y-2 p-3">
					<div className="h-2.5 w-20 animate-pulse rounded bg-muted" />
					<div className="h-3.5 w-52 max-w-full animate-pulse rounded bg-muted" />
					<div className="h-3 w-full animate-pulse rounded bg-muted" />
					<div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
				</div>
			</div>
		);
	}

	return (
		<a
			href={preview.url}
			target="_blank"
			rel="noopener noreferrer"
			className="block w-full overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg transition-colors hover:border-foreground/25"
		>
			{preview.image ? <PreviewImage src={preview.image} /> : null}
			<div className="space-y-1.5 p-3">
				<div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
					{preview.kind === "wikipedia" ? <WikipediaMark /> : null}
					<span className="truncate">{preview.siteName || hostname(preview.url)}</span>
				</div>
				<div className="line-clamp-2 text-sm font-semibold leading-snug">{preview.title}</div>
				{preview.description ? (
					<p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
						{preview.description}
					</p>
				) : null}
				<div className="truncate pt-1 text-[10px] text-muted-foreground/70">
					{hostname(preview.url)}
				</div>
			</div>
		</a>
	);
}

export function ExternalLink({
	href,
	children,
	className,
	...props
}: ComponentProps<"a"> & { href: string; children: ReactNode }) {
	const [failed, setFailed] = useState(false);
	const onFail = useCallback(() => setFailed(true), []);

	if (failed) {
		return (
			<a
				href={href}
				{...props}
				className={cn(MARKDOWN_LINK_CLASS, className)}
				target="_blank"
				rel="noopener noreferrer"
			>
				{children}
			</a>
		);
	}

	return (
		<HoverCardPrimitive.Root openDelay={350} closeDelay={120}>
			<HoverCardPrimitive.Trigger asChild>
				<a
					href={href}
					{...props}
					className={cn(MARKDOWN_LINK_CLASS, className)}
					target="_blank"
					rel="noopener noreferrer"
				>
					{children}
				</a>
			</HoverCardPrimitive.Trigger>
			<HoverCardPrimitive.Portal>
				<HoverCardPrimitive.Content
					side="top"
					align="start"
					sideOffset={8}
					collisionPadding={12}
					className="z-50 w-80 max-w-[calc(100vw-2rem)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
				>
					<PreviewCard url={href} onFail={onFail} />
				</HoverCardPrimitive.Content>
			</HoverCardPrimitive.Portal>
		</HoverCardPrimitive.Root>
	);
}

export function isExternalHref(href: string): boolean {
	return /^(https?:\/\/|\/\/)/i.test(href);
}
