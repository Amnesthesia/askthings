import { useEffect } from "react";

/**
 * iOS Safari tints the notch and toolbar areas from a `theme-color` meta, or,
 * without one, from a sample of the page taken at load and never again. Game
 * mode changes colour with the level, so the game owns a meta while it is on
 * screen and removes it on exit (pages without a game keep Safari's own
 * sampling, which follows the light/dark page background correctly).
 */
export function useThemeColor(tier: number, driftDeg = 0) {
	useEffect(() => {
		const root = document.documentElement;
		const base = getComputedStyle(root)
			.getPropertyValue(`--game-${tier}`)
			.trim();
		if (!base) return;
		let meta = document.querySelector<HTMLMetaElement>(
			'meta[name="theme-color"][data-game]',
		);
		if (!meta) {
			meta = document.createElement("meta");
			meta.name = "theme-color";
			meta.dataset.game = "";
			document.head.appendChild(meta);
		}
		meta.content = rotateHue(base, driftDeg);
	}, [tier, driftDeg]);
	useEffect(
		() => () => {
			document.querySelector('meta[name="theme-color"][data-game]')?.remove();
		},
		[],
	);
}

/** #rrggbb rotated by `deg` on the hue wheel: the same thing the page layer's
 * `filter: hue-rotate(var(--drift))` does, so the toolbar matches the card. */
export function rotateHue(hex: string, deg: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex);
	if (!m || !deg) return hex;
	const n = Number.parseInt(m[1], 16);
	let r = ((n >> 16) & 255) / 255;
	let g = ((n >> 8) & 255) / 255;
	let b = (n & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return hex;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h =
		max === r
			? ((g - b) / d + (g < b ? 6 : 0)) / 6
			: max === g
				? ((b - r) / d + 2) / 6
				: ((r - g) / d + 4) / 6;
	h = ((((h * 360 + deg) % 360) + 360) % 360) / 360;
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const f = (t: number) => {
		let x = t;
		if (x < 0) x += 1;
		if (x > 1) x -= 1;
		if (x < 1 / 6) return p + (q - p) * 6 * x;
		if (x < 1 / 2) return q;
		if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
		return p;
	};
	r = f(h + 1 / 3);
	g = f(h);
	b = f(h - 1 / 3);
	const to = (v: number) =>
		Math.round(v * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${to(r)}${to(g)}${to(b)}`;
}
