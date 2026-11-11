"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

/** Pointer travel below this reads as a click, not a text-selection drag. */
export const CLICK_SLOP_PX = 4;

export interface Point {
	x: number;
	y: number;
}

/** True when the pointer travelled far enough that the gesture was a drag. */
export function movedForSelection(from: Point | null, to: Point): boolean {
	if (!from) return false;
	return Math.hypot(to.x - from.x, to.y - from.y) >= CLICK_SLOP_PX;
}

/**
 * Option rows are buttons AND prose: dragging across a label to select a
 * word must not answer the question. A click counts only when the pointer
 * barely moved between press and release; keyboard activation (detail 0)
 * always counts.
 */
export function useDragGuard() {
	const press = useRef<Point | null>(null);
	return {
		onPointerDown(event: PointerEvent) {
			press.current = { x: event.clientX, y: event.clientY };
		},
		onPointerCancel() {
			press.current = null;
		},
		/** True when the click's action should run. */
		allowClick(event: MouseEvent) {
			const from = press.current;
			press.current = null;
			if (event.detail === 0) return true;
			return !movedForSelection(from, { x: event.clientX, y: event.clientY });
		},
	};
}
