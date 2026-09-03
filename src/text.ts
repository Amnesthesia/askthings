// Deterministic text checks that run before any paid judging.

import type { DeckKind } from "./shared.ts";
import { normaliseText } from "./shared.ts";

/** Phrases that mark a question as written by a model rather than a person. */
export const BANNED = [
	/\bdelve/i,
	/\btapestry\b/i,
	/\bjourney\b/i,
	/\bunpack\b/i,
	/what'?s one thing/i,
	/\bin what ways\b/i,
	/\bnavigate\b/i,
	/\bresonate/i,
	/\bhold space\b/i,
	/\bboundar(?:y|ies)\b/i,
	/\bself-care\b/i,
	/\bauthentic\b/i,
	/\bvulnerabilit/i,
	/\bworldview\b/i,
	/\bsignificantly\b/i,
	/\bshaped who you are\b/i,
	/\bpivotal\b/i,
	/\btestament\b/i,
];

export function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface Fields {
	text?: string;
	a?: string;
	b?: string;
	title?: string;
	setup?: string;
	dilemma?: string;
	probes?: string[];
	word?: string;
}

/**
 * Why a candidate is slop, or null when it passes. Cheap, so it runs on every
 * candidate before a model sees it; the reasons are persisted with rejections.
 */
export function slopReason(kind: DeckKind, f: Fields): string | null {
	const parts = [
		f.text,
		f.a,
		f.b,
		f.title,
		f.setup,
		f.dilemma,
		...(f.probes ?? []),
	].filter((s): s is string => typeof s === "string");
	const all = parts.join(" ");
	for (const re of BANNED)
		if (re.test(all)) return `banned phrase ${re.source}`;
	if ((all.match(/—/g) ?? []).length >= 2) return "two or more em-dashes";
	if (kind === "question") {
		const t = f.text ?? "";
		if (wordCount(t) > 30) return `${wordCount(t)} words`;
		if ((t.match(/\?/g) ?? []).length > 2)
			return "more than two questions in one card";
		if (!/[?.!]$/.test(t.trim())) return "no terminal punctuation";
	}
	if (kind === "pair") {
		for (const [k, v] of [
			["a", f.a],
			["b", f.b],
		] as const) {
			if (!v) return `${k} missing`;
			if (wordCount(v) > 14) return `option ${k} is ${wordCount(v)} words`;
			if (/^would you rather/i.test(v))
				return `option ${k} repeats "would you rather"`;
		}
	}
	if (kind === "improv") {
		if (wordCount(f.word ?? "") > 3)
			return `${wordCount(f.word ?? "")} words for one slot`;
		if (/[.?!]$/.test(f.word ?? "")) return "slot word ends in punctuation";
	}
	if (kind === "dilemma") {
		if (wordCount(f.setup ?? "") > 130)
			return `setup is ${wordCount(f.setup ?? "")} words`;
		if (!f.probes || f.probes.length < 2 || f.probes.length > 3)
			return "needs 2-3 probes";
		if (!(f.dilemma ?? "").includes("?")) return "dilemma is not a question";
	}
	return null;
}

function bigrams(s: string): Map<string, number> {
	const out = new Map<string, number>();
	const t = normaliseText(s).replace(/ /g, "_");
	for (let i = 0; i < t.length - 1; i++) {
		const g = t.slice(i, i + 2);
		out.set(g, (out.get(g) ?? 0) + 1);
	}
	return out;
}

/** Sørensen–Dice over character bigrams of the normalised text, 0..1. */
export function diceSimilarity(a: string, b: string): number {
	const A = bigrams(a);
	const B = bigrams(b);
	let overlap = 0;
	for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
	const total =
		[...A.values()].reduce((x, y) => x + y, 0) +
		[...B.values()].reduce((x, y) => x + y, 0);
	return total === 0 ? 1 : (2 * overlap) / total;
}

/** Thresholds: measured on the fixture deck, where the closest two distinct
 * questions score 0.52 and a reworded duplicate scores 0.87. */
export const DUPLICATE_AT = 0.85;
export const AMBIGUOUS_FROM = 0.6;
