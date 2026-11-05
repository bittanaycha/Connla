"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The opening: the print loads as pixels, sharpens, and coarsens again.
 *
 * Connla is named for the well under the nine hazels. The plate is a green
 * dither of the 1904 Salmon of Knowledge. Here it is not drawn, it is loaded:
 * the plate is cut into a grid of square pixels and switched on in a raster
 * sweep from the top down, the way a bitmap arrives on an old screen. Then the
 * grid resolves into the full-resolution etching, holds, coarsens back into
 * pixels and clears.
 *
 * The rules:
 *
 *   1. Pixels, not points. One square per cell of a 10px grid across the
 *      plate, filled flat and aligned to whole pixels.
 *   2. A front you can read. Rows light top to bottom with a little jitter, so
 *      the plate paints itself instead of sparkling into place.
 *   3. Two resolutions, one picture. The mosaic and the etching are the same
 *      image at two sizes, so the crossfade between them reads as sharpening
 *      rather than as a dissolve.
 *
 * The wordmark types itself out under the plate while the sharp plate holds.
 * The whole thing leaves on its own in about five seconds; any click or
 * keypress jumps to the exit.
 *
 * Shown once per app launch: `shown` is module state, not storage — a reload is
 * a launch, a client-side navigation is not.
 */

let shown = false;

/** The plate's longest side, in CSS pixels. */
const PLATE_MAX = 560;

/** One pixel of the loaded image, in CSS pixels. */
const CELL = 10;

/** The timeline, in milliseconds from the first frame. */
const SWEEP_MS = 1150;
const SWEEP_JITTER_MS = 80;
/** How far the sweep leans: 0 = flat rows, 1 = a 45-degree diagonal. */
const SWEEP_SKEW = 0;
/** How long a pixel holds a bright edge after it switches on. */
const FLASH_MS = 90;
const FLASH_ALPHA = 0.18;
/** The pixels sharpen back into the full-resolution plate. */
const REFINE_START = 1250;
const REFINE_MS = 700;
const TYPE_START = 1900;
const TYPE_MS = 95;
const EXIT = 3400;
/** The plate coarsens back into pixels before it clears. */
const RECHUNK_MS = 400;
const WIPE_MS = 650;
const WIPE_JITTER_MS = 90;
const FADE_MS = 420;

const WORD = "CONNLA";

/**
 * The resolutions between the pixel grid and the plate, as multiples of the
 * grid. Even 1.5x ratios, so each sharpening step is a small one.
 */
const STEP_SCALES = [1.5, 2.25, 3.4, 5.1, 7.5];

/** The plate itself: the level above the finest step. */
const FULL_LEVEL = STEP_SCALES.length + 1;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;

type Pixel = {
	x: number;
	y: number;
	/** The colour as "r, g, b", one string per pixel so fills can be batched. */
	colour: string;
	/** When it switches on, and when it switches off again. */
	on: number;
	off: number;
};

export function IntroSplash() {
	const [plate, setPlate] = useState<HTMLImageElement | null>(null);
	const [fading, setFading] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const [wordmarkTop, setWordmarkTop] = useState(0);
	const [typed, setTyped] = useState(0);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const skipRef = useRef(false);
	const leaveRef = useRef<() => void>(() => {});

	const leave = useCallback(() => {
		setFading(true);
		window.setTimeout(() => setDismissed(true), FADE_MS);
	}, []);
	leaveRef.current = leave;

	// Hold the overlay back until the plate is decoded: the app stays visible
	// under it, so there is no blank screen waiting on the image.
	useEffect(() => {
		if (shown) return;
		shown = true;
		const img = new Image();
		img.src = "/intro/salmon-dither.png";
		const arm = () => setPlate(img);
		if (img.complete && img.naturalWidth > 0) arm();
		else img.onload = arm;
	}, []);

	useEffect(() => {
		if (!plate) return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let raf = 0;
		let cancelled = false;
		const img = plate;

		const reduced =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		const start = () => {
			if (cancelled) return;

			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			canvas.width = Math.floor(vw * dpr);
			canvas.height = Math.floor(vh * dpr);
			canvas.style.width = `${vw}px`;
			canvas.style.height = `${vh}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.imageSmoothingEnabled = false;

			const plateW = Math.min(vw * 0.62, vh * 0.62 * (img.width / img.height), PLATE_MAX);
			const plateH = plateW * (img.height / img.width);
			const cols = Math.max(1, Math.floor(plateW / CELL));
			const rows = Math.max(1, Math.floor(plateH / CELL));
			// Centre the pixel grid inside the plate so its edges land on the
			// same rectangle at every viewport.
			const left = Math.round((vw - cols * CELL) / 2);
			const top = Math.round((vh - rows * CELL) / 2);

			setWordmarkTop(top + rows * CELL + Math.min(60, vh * 0.06));

			// One sample per cell: the image at grid size, so each pixel carries
			// the average colour of its block rather than one point's colour.
			const grid = document.createElement("canvas");
			grid.width = cols;
			grid.height = rows;
			const gctx = grid.getContext("2d");
			if (!gctx) return;
			gctx.drawImage(img, 0, 0, cols, rows);
			const data = gctx.getImageData(0, 0, cols, rows).data;

			// The same picture at each step's resolution: every step is a crisp
			// plate, so resolving sharpens rather than blurs.
			const steps = STEP_SCALES.map((factor) => {
				const step = document.createElement("canvas");
				step.width = Math.round(cols * factor);
				step.height = Math.round(rows * factor);
				const sc = step.getContext("2d");
				sc?.drawImage(img, 0, 0, step.width, step.height);
				return step;
			});

			const pixels: Pixel[] = [];
			for (let row = 0; row < rows; row++) {
				for (let col = 0; col < cols; col++) {
					const i = (row * cols + col) * 4;
					if ((data[i + 3] ?? 0) < 8) continue;
					pixels.push({
						x: left + col * CELL,
						y: top + row * CELL,
						colour: `${data[i] ?? 0}, ${data[i + 1] ?? 0}, ${data[i + 2] ?? 0}`,
						on:
							((row + col * SWEEP_SKEW) / (rows + cols * SWEEP_SKEW)) * SWEEP_MS +
							Math.random() * SWEEP_JITTER_MS,
						off:
							((rows - 1 - row + (cols - 1 - col) * SWEEP_SKEW) / (rows + cols * SWEEP_SKEW)) *
								WIPE_MS +
							Math.random() * WIPE_JITTER_MS,
					});
				}
			}

			// Batched by colour: one fillStyle per distinct colour per frame
			// instead of one per pixel.
			const byColour = new Map<string, Pixel[]>();
			for (const pixel of pixels) {
				const bucket = byColour.get(pixel.colour);
				if (bucket) bucket.push(pixel);
				else byColour.set(pixel.colour, [pixel]);
			}

			const plateX = left;
			const plateY = top;
			const plateWidth = cols * CELL;
			const plateHeight = rows * CELL;

			const drawPixels = (t: number, wipeAge: number) => {
				const flashing = wipeAge === 0 && t < SWEEP_MS + SWEEP_JITTER_MS + FLASH_MS;
				for (const [colour, bucket] of byColour) {
					ctx.fillStyle = `rgb(${colour})`;
					for (const pixel of bucket) {
						if (t < pixel.on) continue;
						if (wipeAge > 0 && wipeAge > pixel.off) continue;
						ctx.fillRect(pixel.x, pixel.y, CELL, CELL);
					}
					// The leading edge of the sweep: a pixel is briefly brighter
					// than its final colour, the way a scanned row is.
					if (!flashing) continue;
					for (const pixel of bucket) {
						const age = t - pixel.on;
						if (age < 0 || age > FLASH_MS) continue;
						ctx.globalAlpha = (1 - age / FLASH_MS) * FLASH_ALPHA;
						ctx.fillStyle = "#ffffff";
						ctx.fillRect(pixel.x, pixel.y, CELL, CELL);
					}
					ctx.globalAlpha = 1;
					ctx.fillStyle = `rgb(${colour})`;
				}
			};

			const paint = (t: number) => {
				ctx.clearRect(0, 0, vw, vh);
				const exitAge = t > EXIT ? t - EXIT : 0;
				const wipeAge = Math.max(0, exitAge - RECHUNK_MS);
				if (wipeAge > WIPE_MS + WIPE_JITTER_MS) return;

				// 1 at full resolution, 0 while the plate is still pixels: the
				// image sharpens up out of the grid, then coarsens back into it
				// before the wipe.
				// Resolution runs 0 = pixels to FULL_LEVEL = the etching, one
				// crisp step at a time: up out of the grid, hold, back down
				// before the wipe.
				const up = clamp01((t - REFINE_START) / REFINE_MS);
				const down = exitAge > 0 ? clamp01(exitAge / RECHUNK_MS) : 0;
				const level =
					exitAge > 0
						? Math.max(0, FULL_LEVEL - Math.floor(down * FULL_LEVEL + 0.0001))
						: Math.min(FULL_LEVEL, Math.floor(up * FULL_LEVEL + 0.0001));

				if (level === 0) {
					drawPixels(t, wipeAge);
				} else if (level >= FULL_LEVEL) {
					ctx.imageSmoothingEnabled = true;
					ctx.drawImage(img, plateX, plateY, plateWidth, plateHeight);
					ctx.imageSmoothingEnabled = false;
				} else {
					ctx.drawImage(steps[level - 1]!, plateX, plateY, plateWidth, plateHeight);
				}

				const letters = Math.max(
					0,
					Math.min(WORD.length, Math.floor((t - TYPE_START) / TYPE_MS) + 1),
				);
				setTyped((current) => (current === letters ? current : letters));
			};

			if (reduced) {
				// No sweep: the plate is simply there, the wordmark already set.
				ctx.drawImage(img, left, top, cols * CELL, rows * CELL);
				setTyped(WORD.length);
				window.setTimeout(() => leaveRef.current(), 1600);
				return;
			}

			const t0 = performance.now();
			let shift: number | null = null;
			const end = EXIT + RECHUNK_MS + WIPE_MS + WIPE_JITTER_MS + 200;

			const frame = (now: number) => {
				if (cancelled) return;
				const elapsed = now - t0;
				if (skipRef.current && shift === null) {
					// The exit's clock starts at the skip, not on the schedule.
					shift = elapsed - EXIT;
				}
				const t = shift === null ? elapsed : elapsed - shift;
				paint(t);
				if (t < end) raf = requestAnimationFrame(frame);
				else leaveRef.current();
			};
			raf = requestAnimationFrame(frame);
		};

		start();

		const skip = () => {
			skipRef.current = true;
		};
		window.addEventListener("pointerdown", skip, { once: true });
		window.addEventListener("keydown", skip, { once: true });

		return () => {
			cancelled = true;
			cancelAnimationFrame(raf);
			window.removeEventListener("pointerdown", skip);
			window.removeEventListener("keydown", skip);
		};
	}, [plate]);

	if (!plate || dismissed) return null;

	const letters = WORD.split("");

	return (
		<div
			data-testid="intro-splash"
			aria-hidden="true"
			onClick={leave}
			className={`fixed inset-0 z-[100] overflow-hidden bg-background transition-opacity duration-[420ms] ease-out ${
				fading ? "pointer-events-none opacity-0" : "opacity-100"
			}`}
		>
			<canvas ref={canvasRef} className="absolute inset-0 block" />
			{wordmarkTop > 0 && (
				<div
					data-testid="intro-wordmark"
					className={`absolute inset-x-0 flex items-center justify-center font-code text-[0.9rem] font-medium uppercase tracking-[0.46em] text-foreground/70 transition-opacity duration-500 ease-out ${
						typed > 0 ? "opacity-100" : "opacity-0"
					}`}
					style={{ top: `${wordmarkTop}px` }}
				>
					<span className="whitespace-pre">
						{letters.map((letter, index) => (
							<span key={`${letter}-${index}`} className="contents">
								<span
									className={`transition-opacity duration-100 ${
										index < typed ? "opacity-100" : "opacity-0"
									}`}
								>
									{letter}
								</span>
								{index === typed - 1 && <span className="lh-caret text-mark">▌</span>}
							</span>
						))}
					</span>
				</div>
			)}
		</div>
	);
}
