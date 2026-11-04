"use client";
/**
 * THE MODE SWITCH — one click between paper and the cold room.
 *
 * It lives in the sidebar header, next to the collapse control, because the
 * mode is a property of the whole window and the header is the one strip
 * every surface shares. The switch is optimistic: the class flips on <html>
 * immediately (the provider's job), then the section is PUT; a rejected write
 * puts the old mode back rather than leaving the screen and the record
 * disagreeing.
 *
 * The delta is sent, not the resolved appearance: writing back a resolved
 * object would freeze today's factory values (font, size, heading weight)
 * into the learner's record.
 */
import { MoonIcon, SunIcon } from "lucide-react";
import { useAppearance } from "@/components/settings/appearance";
import { Hint } from "@/components/ui/hint";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
	const { appearance, delta, onAppearanceChange } = useAppearance();
	const dark = appearance.mode === "dark";

	const flip = async () => {
		const previous = delta;
		const next = { ...(delta ?? {}), mode: dark ? ("light" as const) : ("dark" as const) };
		onAppearanceChange(next);
		try {
			const res = await fetch("/api/settings/appearance", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(next),
			});
			if (!res.ok) onAppearanceChange(previous);
		} catch {
			onAppearanceChange(previous);
		}
	};

	return (
		<Hint label={dark ? "Light mode" : "Dark mode"}>
			<Button
				variant="ghost"
				size="icon"
				aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
				aria-pressed={dark}
				data-testid="theme-toggle"
				onClick={() => void flip()}
				className="lh-no-drag"
			>
				{dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
			</Button>
		</Hint>
	);
}
