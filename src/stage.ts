// Helpers every pipeline stage shares: model selection, batch splitting, and
// index-keyed parsing of structured responses.

import type { ProviderName } from "./providers/base.ts";

/** Generation models: one flagship per provider, because voice variety is the product. */
export const GEN_MODEL: Record<ProviderName, string> = {
	anthropic: process.env.GEN_MODEL_ANTHROPIC ?? "claude-opus-5",
	gemini: process.env.GEN_MODEL_GEMINI ?? "gemini-3.1-pro-preview",
	openai: process.env.GEN_MODEL_OPENAI ?? "gpt-5.6-sol",
};
/** Dedupe tiebreak + rating: the cheapest reliable rubric-follower. */
export const RATE_MODEL = process.env.RATE_MODEL ?? "gemini-3.8-flash";
/** The safety gate gets the stronger reader: a missed rejection costs more than $0.55. */
export const SAFETY_MODEL = process.env.SAFETY_MODEL ?? "claude-sonnet-5";

export const JUDGE_BATCH = 30;
export const STAGE_CONCURRENCY = 4;

export function batches<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

/**
 * `{ items: [{ index, ... }] }` from a model, keyed by the echoed index and
 * bounded to 0..n-1. Never by array position: models drop and reorder items.
 * A duplicate index keeps the first occurrence; a missing one is simply absent,
 * and the caller decides what absence means for that item.
 */
export function itemsByIndex(
	json: unknown,
	n: number,
): Map<number, Record<string, unknown>> {
	const out = new Map<number, Record<string, unknown>>();
	const items = (json as { items?: unknown })?.items;
	if (!Array.isArray(items)) return out;
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const idx = (item as { index?: unknown }).index;
		if (!Number.isInteger(idx) || (idx as number) < 0 || (idx as number) >= n)
			continue;
		if (!out.has(idx as number))
			out.set(idx as number, item as Record<string, unknown>);
	}
	return out;
}

export function str(v: unknown): string | null {
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function strList(v: unknown): string[] {
	return Array.isArray(v)
		? v
				.filter(
					(x): x is string => typeof x === "string" && x.trim().length > 0,
				)
				.map((x) => x.trim())
		: [];
}

/** Deck slugs from argv, or every deck when none given. */
export function deckArgs(all: string[]): string[] {
	const asked = process.argv
		.slice(2)
		.flatMap((a) => a.split(","))
		.map((s) => s.trim())
		.filter(Boolean);
	if (!asked.length) return all;
	for (const a of asked)
		if (!all.includes(a))
			throw new Error(`unknown deck "${a}" (have: ${all.join(", ")})`);
	return asked;
}
