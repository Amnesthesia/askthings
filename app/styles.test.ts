import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// "Measure, don't eyeball": every tier hue is used on text, so it must clear
// WCAG AA (4.5:1) against --surface in the theme it is declared in. Parsing
// the stylesheet rather than repeating the values keeps the test honest when
// a colour changes.
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf-8");

function luminance(hex: string): number {
	const h = hex.length === 4 ? hex.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : hex;
	const [r, g, b] = [1, 3, 5]
		.map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255)
		.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** `--name: #hex` declarations inside one `{ ... }` block. */
function tokens(block: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g))
		out[m[1]] = m[2];
	return out;
}

function block(selectorStart: string): string {
	const at = css.indexOf(selectorStart);
	assert.notEqual(at, -1, `${selectorStart} block not found`);
	const open = css.indexOf("{", at);
	let depth = 0;
	for (let i = open; i < css.length; i++) {
		if (css[i] === "{") depth++;
		if (css[i] === "}" && --depth === 0) return css.slice(open, i);
	}
	throw new Error("unbalanced braces");
}

const themes = {
	light: tokens(block(":root {")),
	"dark (system)": tokens(block(':root:not([data-theme="light"])')),
	"dark (explicit)": tokens(block(':root[data-theme="dark"]')),
};

for (const [theme, t] of Object.entries(themes)) {
	test(`tier hues and muted text are >= 4.5:1 on the ${theme} surface`, () => {
		const surface = t.surface;
		assert.ok(surface, "--surface declared");
		for (const name of [
			"tier-1",
			"tier-2",
			"tier-3",
			"tier-4",
			"muted",
			"fg",
		]) {
			assert.ok(t[name], `--${name} declared in ${theme}`);
			const ratio = contrast(t[name], surface);
			assert.ok(
				ratio >= 4.5,
				`--${name} ${t[name]} on ${surface} is ${ratio.toFixed(2)}:1`,
			);
		}
	});
}

test("both dark blocks declare the same tokens", () => {
	assert.deepEqual(themes["dark (system)"], themes["dark (explicit)"]);
});
