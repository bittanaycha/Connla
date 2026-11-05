"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The opening: the salmon is drawn in marks that arrive on a swirl, resolve into
 * the print, and are released again around a single outward front.
 *
 * Connla is named for the well under the nine hazels. The plate is a green
 * dither of the 1904 Salmon of Knowledge; here it is assembled rather than
 * shown. Two rules keep it legible, both borrowed from the Mimir startup film:
 *
 *   1. Sparseness. A mark every ~14px, and only ink travels — the print's own
 *      paper stays still. A dense cloud reads as fog, not as pixels.
 *   2. One front. Marks leave on a front that starts at the plate's centre and
 *      moves out, each with its own velocity and a downward bias, so the exit is
 *      a dispersal rather than an explosion.
 *
 * The resolved print fades in over most of a second while the marks fade out,
 * so the picture never snaps into focus.
 *
 * The animation is the splash. Any click or keypress jumps to the exit, and the
 * whole thing leaves on its own in about five seconds. Shown once per app
 * launch: `shown` is module state, not storage — a reload is a launch, a
 * client-side navigation is not.
 */

let shown = false;

/** One mark per this many CSS pixels of the plate. */
const CELL = 9;
const FLY_IN_MS = 1500;
const STAGGER_MS = 420;
const HOLD_MS = 1500;
const RELEASE_MS = 170;
const FLY_OUT_MS = 900;
const FADE_MS = 420;

type Mark = {
	tx: number;
	ty: number;
	/** Start polar (radius, angle). */
	r0: number;
	a0: number;
	rt: number;
	at: number;
	spin: number;
	delay: number;
	/** Exit velocity, in pixels per second. */
	vx: number;
	vy: number;
	color: string;
};

const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
const smoothstep = (p: number) => p * p * (3 - 2 * p);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function IntroSplash() {
	const [visible, setVisible] = useState(false);
	const [fading, setFading] = useState(false);
	const [wordmarkTop, setWordmarkTop] = useState(0);
	const [formed, setFormed] = useState(false);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const skipRef = useRef(false);
	const leaveRef = useRef<() => void>(() => {});

	const leave = useCallback(() => {
		setFading(true);
		window.setTimeout(() => setVisible(false), FADE_MS);
	}, []);
	leaveRef.current = leave;

	useEffect(() => {
		if (shown) return;
		shown = true;
		setVisible(true);
	}, []);

	useEffect(() => {
		if (!visible) return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let raf = 0;
		let cancelled = false;
		const img = new Image();
		img.src = "/intro/salmon-dither.png";

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

			const plateW = Math.min(vw * 0.62, vh * 0.62 * (img.width / img.height), 520);
			const plateH = plateW * (img.height / img.width);
			const left = (vw - plateW) / 2;
			const top = (vh - plateH) / 2;

			const cols = Math.max(1, Math.round(plateW / CELL));
			const rows = Math.max(1, Math.round(plateH / CELL));
			const sampler = document.createElement("canvas");
			sampler.width = cols;
			sampler.height = rows;
			const sctx = sampler.getContext("2d");
			if (!sctx) return;
			sctx.drawImage(img, 0, 0, cols, rows);
			const data = new Float32Array(sctx.getImageData(0, 0, cols, rows).data);

			// The print's own paper does not travel: only ink does.
			const paper: readonly [number, number, number] = [data[0] ?? 232, data[1] ?? 230, data[2] ?? 216];
			const isPaper = (i: number) => {
				const dr = (data[i] ?? 0) - paper[0];
				const dg = (data[i + 1] ?? 0) - paper[1];
				const db = (data[i + 2] ?? 0) - paper[2];
				return dr * dr + dg * dg + db * db < 420;
			};

			const cx = vw / 2;
			const cy = vh / 2;
			// Marks start just outside the plate rather than at the window edge: with
			// only the ink travelling, a wider ring reads as an empty screen.
			const far = Math.hypot(vw, vh) * 0.4;
			const maxRT = Math.hypot(plateW, plateH) * 0.5;
			const marks: Mark[] = [];

			for (let row = 0; row < rows; row++) {
				for (let col = 0; col < cols; col++) {
					const i = (row * cols + col) * 4;
					if ((data[i + 3] ?? 0) < 8 || isPaper(i)) continue;
					const tx = left + (col + 0.5) * (plateW / cols);
					const ty = top + (row + 0.5) * (plateH / rows);
					const dx = tx - cx;
					const dy = ty - cy;
					const rt = Math.hypot(dx, dy);
					const at = Math.atan2(dy, dx);
					// Centre first, rim last: the print is drawn outward from its
					// middle, which reads as one gesture rather than static.
					const delay = (rt / maxRT) * STAGGER_MS + Math.random() * 120;
					const outAngle = at + (Math.random() - 0.5) * 0.9;
					const speed = 300 + Math.random() * 420;
					marks.push({
						tx,
						ty,
						r0: far * (0.75 + Math.random() * 0.5),
						a0: Math.random() * Math.PI * 2,
						rt,
						at,
						spin: (Math.random() < 0.5 ? -1 : 1) * (Math.PI * (0.7 + Math.random() * 0.6)),
						delay,
						vx: Math.cos(outAngle) * speed,
						vy: Math.sin(outAngle) * speed * 0.5 + 150,
						color: `rgb(${data[i] ?? 0} ${data[i + 1] ?? 0} ${data[i + 2] ?? 0})`,
					});
				}
			}

			setWordmarkTop(top + plateH + Math.min(60, vh * 0.06));

			const cell = plateW / cols;
			const total = FLY_IN_MS + STAGGER_MS;

			if (reduced) {
				ctx.drawImage(img, left, top, plateW, plateH);
				setFormed(true);
				window.setTimeout(() => leaveRef.current(), 1600);
				return;
			}

			const paint = (elapsed: number, outAge: number) => {
				ctx.clearRect(0, 0, vw, vh);
				// The print resolves under the marks over most of a second, and the
				// marks give way as it does: no doubling, no snap.
				const settle = outAge > 0 ? 0 : clamp01((elapsed - total * 0.72) / 1150);
				const shownPrint = smoothstep(settle);

				for (const m of marks) {
					let x: number;
					let y: number;
					let alpha: number;
					let size = cell * 0.8;

					if (outAge <= 0) {
						const p = easeInOutCubic(clamp01((elapsed - m.delay) / FLY_IN_MS));
						const q = 1 - p;
						const a = m.at + (m.a0 - m.at + m.spin) * q ** 1.15;
						const r = m.rt + (m.r0 - m.rt) * q;
						x = cx + Math.cos(a) * r;
						y = cy + Math.sin(a) * r;
						alpha = clamp01(p * 2.4) * (1 - 0.94 * shownPrint);
						size = cell * (0.55 + 0.45 * p);
					} else {
						// Released on a front that starts at the centre and climbs
						// outward, then carried by its own velocity with a downward bias.
						const delay = (m.rt / maxRT) * RELEASE_MS;
						const age = outAge - delay;
						if (age <= 0) {
							x = m.tx;
							y = m.ty;
							alpha = 1;
							// Still in place: the tile is the print's own square, so the
							// sheet reads as breaking up rather than turning into a grid.
							size = cell + 1;
						} else {
							const t = age / 1000;
							x = m.tx + m.vx * t;
							y = m.ty + m.vy * t + 46 * t * t;
							alpha = 1 - clamp01(age / FLY_OUT_MS);
						}
					}

					if (alpha <= 0.01) continue;
					const px = Math.ceil(size);
					ctx.globalAlpha = alpha;
					ctx.fillStyle = m.color;
					ctx.fillRect(Math.round(x - px / 2), Math.round(y - px / 2), px, px);
				}

				// In: the print resolves under the marks. Out: it holds for the first
				// third of a second while the marks take over, then goes — the exit
				// crossfades for the same reason the entrance does.
				const printAlpha = outAge > 0 ? 1 - clamp01(outAge / 150) : shownPrint;
				if (printAlpha > 0) {
					ctx.globalAlpha = printAlpha;
					ctx.drawImage(img, left, top, plateW, plateH);
				}
				ctx.globalAlpha = 1;
			};

			const t0 = performance.now();
			let outStart = 0;
			const frame = (now: number) => {
				if (cancelled) return;
				const elapsed = now - t0;

				if (!outStart) {
					if (elapsed > total * 0.95) setFormed(true);
					if (skipRef.current || elapsed > total + HOLD_MS) {
						// The exit's clock starts here, not on the schedule: a skip must
						// not land mid-dispersal.
						outStart = now;
						setFormed(false);
					} else {
						paint(elapsed, 0);
						raf = requestAnimationFrame(frame);
						return;
					}
				}

				const age = now - outStart;
				paint(elapsed, age);
				if (age < RELEASE_MS + FLY_OUT_MS) raf = requestAnimationFrame(frame);
				else leaveRef.current();
			};
			raf = requestAnimationFrame(frame);
		};

		if (img.complete && img.naturalWidth > 0) start();
		else img.onload = start;

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
	}, [visible]);

	if (!visible) return null;

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
					className={`absolute inset-x-0 flex items-center justify-center gap-[0.45em] font-code text-[0.9rem] font-medium uppercase tracking-[0.46em] text-foreground/70 transition-opacity duration-700 ease-out ${
						formed ? "opacity-100" : "opacity-0"
					}`}
					style={{ top: `${wordmarkTop}px` }}
				>
					<span>Connla</span>
					<span className="lh-caret text-mark">▌</span>
				</div>
			)}
		</div>
	);
}
