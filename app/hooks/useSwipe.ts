import { type RefObject, useEffect } from "react";

interface Handlers {
	onHorizontal: (direction: 1 | -1) => void;
	onVertical: (direction: 1 | -1) => void;
}

/**
 * Touch-only swipe detection. Deliberately no mouse or pointer events: on a
 * desktop the arrow keys and buttons do this job, and a mouse drag that
 * turned pages was a bug waiting to happen. Fires only for a decisive,
 * single-axis swipe — a diagonal drift or a slow drag is ignored, so a
 * scroll-like gesture never turns the page.
 */
export function useSwipe(
	ref: RefObject<HTMLElement | null>,
	{ onHorizontal, onVertical }: Handlers,
) {
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		let start: { x: number; y: number; t: number } | null = null;

		const onStart = (e: TouchEvent) => {
			if (e.touches.length !== 1) {
				start = null;
				return;
			}
			const t = e.touches[0];
			start = { x: t.clientX, y: t.clientY, t: Date.now() };
		};
		const onEnd = (e: TouchEvent) => {
			if (!start) return;
			const t = e.changedTouches[0];
			const dx = t.clientX - start.x;
			const dy = t.clientY - start.y;
			const elapsed = Date.now() - start.t;
			start = null;
			const ax = Math.abs(dx);
			const ay = Math.abs(dy);
			const major = Math.max(ax, ay);
			const minor = Math.min(ax, ay);
			// 48px: below that a thumb adjusting its grip fires; 800ms: slower is
			// a drag, not a swipe; minor > half of major is a drift, not an axis.
			if (major < 48 || elapsed > 800 || minor > major / 2) return;
			if (ax > ay) onHorizontal(dx < 0 ? 1 : -1);
			else onVertical(dy < 0 ? 1 : -1);
		};
		const onCancel = () => {
			start = null;
		};

		el.addEventListener("touchstart", onStart, { passive: true });
		el.addEventListener("touchend", onEnd, { passive: true });
		el.addEventListener("touchcancel", onCancel, { passive: true });
		return () => {
			el.removeEventListener("touchstart", onStart);
			el.removeEventListener("touchend", onEnd);
			el.removeEventListener("touchcancel", onCancel);
		};
	}, [ref, onHorizontal, onVertical]);
}
