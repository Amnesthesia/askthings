// pnpm rank [deck,...] — comparative pass over the survivors. The rubric's
// absolute scores decide the gate, but everything that passes sits at voice
// 4-5, so "best first" at publish was close to arbitrary. Here the judge orders
// batches of safe candidates within a level; each card's mean within-batch
// percentile over two rolls (different batch mates) is stored as `rank`, and
// publish sorts by it. Nothing is rejected here.

import {
	type Candidate,
	judgeText,
	readCandidates,
	writeCandidates,
} from "./candidates.ts";
import { type DeckSpec, deckSpec, loadDeckSpecs } from "./decks.ts";
import { callJsonMany, installUsageReporting } from "./llm.ts";
import { PROMPT_VERSION, rankSchema, rankSystem, rankUser } from "./prompts.ts";
import {
	batches,
	deckArgs,
	itemsByIndex,
	JUDGE_BATCH,
	RATE_MODEL,
} from "./stage.ts";

const ROLLS = 2;

/** Deterministic per deck and roll so a rerun hits the cache. */
function shuffled<T>(items: T[], seed: number): T[] {
	let s = seed;
	const rand = () => {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

async function rankDeck(spec: DeckSpec) {
	const all = readCandidates(spec.deck);
	const todo = all.filter((c) => c.status === "safe" && c.rank === undefined);
	if (!todo.length || spec.generation.rate === false) return;
	const percentiles = new Map<Candidate, number[]>();
	for (let roll = 0; roll < ROLLS; roll++) {
		// Batches never mix levels: a level-1 opener against a level-4 card is
		// not a fair contest, and publish fills each level separately.
		const groups: Candidate[][] = [];
		for (const tier of spec.tiers)
			groups.push(
				...batches(
					shuffled(
						todo.filter((c) => c.tier === tier.level),
						tier.level * 1000 + roll,
					),
					JUDGE_BATCH,
				),
			);
		const results = await callJsonMany(
			groups.map((batch) => ({
				model: RATE_MODEL,
				system: rankSystem,
				user: rankUser(
					spec.kind,
					batch.map((c) => judgeText(spec.kind, c.fields)),
				),
				schema: rankSchema,
				maxOutputTokens: 4000,
				effort: "none" as const,
				temperature: 0,
			})),
			{
				stage: `rank/${spec.deck}`,
				promptVersion: `${PROMPT_VERSION.rank}#${roll}`,
			},
		);
		if (results.some((r) => r === null)) {
			console.warn(
				`  [${spec.deck}] ranking model unavailable — publish sorts by scores`,
			);
			return;
		}
		groups.forEach((batch, g) => {
			const res = results[g];
			if (res instanceof Error || res === null) return;
			const byIdx = itemsByIndex(res.json, batch.length);
			// A batch of one has no order to give; a missing or duplicate place
			// leaves that card without a percentile for this roll.
			if (batch.length < 2) return;
			const seen = new Set<number>();
			batch.forEach((c, i) => {
				const place = byIdx.get(i)?.place;
				if (
					!Number.isInteger(place) ||
					(place as number) < 1 ||
					(place as number) > batch.length ||
					seen.has(place as number)
				)
					return;
				seen.add(place as number);
				// 1 = best -> percentile 1; last -> 0.
				const pct = 1 - ((place as number) - 1) / (batch.length - 1);
				percentiles.set(c, [...(percentiles.get(c) ?? []), pct]);
			});
		});
	}
	let ranked = 0;
	for (const c of todo) {
		const p = percentiles.get(c);
		if (!p?.length) continue;
		c.rank = Number((p.reduce((a, b) => a + b, 0) / p.length).toFixed(3));
		ranked++;
	}
	writeCandidates(spec.deck, all);
	console.log(`  rank ${spec.deck}: ${todo.length} -> ${ranked} ranked`);
}

async function main() {
	installUsageReporting();
	for (const d of deckArgs(loadDeckSpecs().map((s) => s.deck)))
		await rankDeck(deckSpec(d));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
