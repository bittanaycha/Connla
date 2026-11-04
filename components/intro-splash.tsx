"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The opening plate.
 *
 * Connla is named for the well under the nine hazels: the nuts fall, the salmon
 * eats them, and the salmon is the one who knows. The picture is printed once
 * per launch — a dithered plate on the same paper as the app — and then it is
 * out of the way. It is a greeting, not a gate: any click or keypress leaves
 * early, and it leaves on its own after two seconds.
 *
 * Shown once per app launch. `shown` is module state, not storage: a reload is
 * a launch, a client-side navigation is not.
 */

let shown = false;

const HOLD_MS = 2000;
const FADE_MS = 600;

export function IntroSplash() {
	const [visible, setVisible] = useState(false);
	const [leaving, setLeaving] = useState(false);

	const leave = useCallback(() => {
		setLeaving(true);
		window.setTimeout(() => setVisible(false), FADE_MS);
	}, []);

	useEffect(() => {
		if (shown) return;
		shown = true;
		setVisible(true);
		// The timer is deliberately NOT cleared on unmount: React's development
		// double-invoke would clear the only timer that hides the splash, and the
		// module guard above means the second run never schedules another one.
		// One stray timer in dev is cheaper than a splash that never leaves.
		window.setTimeout(leave, HOLD_MS);
		const skip = () => window.setTimeout(leave, 0);
		window.addEventListener("pointerdown", skip, { once: true });
		window.addEventListener("keydown", skip, { once: true });
		return () => {
			window.removeEventListener("pointerdown", skip);
			window.removeEventListener("keydown", skip);
		};
	}, [leave]);

	if (!visible) return null;

	return (
		<div
			data-testid="intro-splash"
			aria-hidden="true"
			onClick={leave}
			className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background transition-opacity duration-[600ms] ease-out ${
				leaving ? "pointer-events-none opacity-0" : "opacity-100"
			}`}
		>
			{/* A print, mounted: the plate keeps its own bone stock, ruled and
			    lifted off the page by the same hard offset shadow every other
			    sheet in the app uses. Attempting to blend its paper away only
			    produced a grey rectangle — the grain is part of the print. */}
			<figure className="w-[min(64vw,36rem)] rotate-[-0.4deg] border border-border bg-[#e9e2d2] p-2 shadow-lg">
				<img src="/intro/connla-well.png" alt="" className="block w-full" draggable={false} />
			</figure>
			<div className="font-title text-2xl tracking-tight text-foreground/80">Connla</div>
		</div>
	);
}
