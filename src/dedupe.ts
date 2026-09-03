// pnpm deduplicate [deck,...] ("dedupe" alone is a pnpm built-in) — cross-provider near-duplicate removal. Cheapest test
// first: normalised exact match, then Dice similarity; only the ambiguous band
// goes to a model. Without a judge the band is kept (a visible duplicate is
// recoverable; a wrongly merged card is not).

import {
	type Candidate,
	count,
	headlineOfFields,
	ratio,
	readCandidates,
	reject,
	writeCandidates,
} from "./candidates.ts";
import { headlineOf, normaliseText } from "./common.ts";
import { type DeckSpec, deckSpec, loadDeckSpecs, readDeck } from "./decks.ts";
import { callJsonMany, installUsageReporting } from "./llm.ts";
import {
	dedupeSchema,
	dedupeSystem,
	dedupeUser,
	PROMPT_VERSION,
} from "./prompts.ts";
import {
	batches,
	deckArgs,
	itemsByIndex,
	JUDGE_BATCH,
	RATE_MODEL,
} from "./stage.ts";
import { AMBIGUOUS_FROM, DUPLICATE_AT, diceSimilarity } from "./text.ts";

interface Pair {
	candidate: Candidate;
	against: string;
	score: number;
}

async function dedupeDeck(spec: DeckSpec) {
	const all = readCandidates(spec.deck);
	const deck = readDeck(spec);
	const fresh = all.filter((c) => c.status === "new");
	if (!fresh.length) return;
	// A whole-run deck publishes exactly one run, so the same question in two
	// providers' runs is not a duplicate: rate and publish decide between runs.
	if (spec.generation.wholeRun) {
		for (const c of fresh) c.status = "unique";
		writeCandidates(spec.deck, all);
		console.log(
			ratio(
				`dedupe ${spec.deck}`,
				fresh.length,
				fresh.length,
				new Map([["whole-run deck, not deduplicated", 0]]),
			),
		);
		return;
	}
	const accepted: string[] = [
		...deck.cards.map((c) => headlineOf(deck, c)),
		...all
			.filter((c) =>
				["unique", "rated", "safe", "published"].includes(c.status),
			)
			.map((c) => headlineOfFields(spec.kind, c.fields)),
	];
	const acceptedNorm = new Set(accepted.map(normaliseText));
	const reasons = new Map<string, number>();
	const ambiguous: Pair[] = [];

	for (const c of fresh) {
		const h = headlineOfFields(spec.kind, c.fields);
		if (acceptedNorm.has(normaliseText(h))) {
			reject(c, spec.kind, "dedupe", "exact duplicate");
			count(reasons, "exact duplicate");
			continue;
		}
		let best = { against: "", score: 0 };
		for (const a of accepted) {
			const s = diceSimilarity(h, a);
			if (s > best.score) best = { against: a, score: s };
		}
		if (best.score >= DUPLICATE_AT) {
			reject(
				c,
				spec.kind,
				"dedupe",
				`near duplicate (${best.score.toFixed(2)}) of "${best.against}"`,
			);
			count(reasons, "near duplicate");
			continue;
		}
		if (best.score >= AMBIGUOUS_FROM) {
			ambiguous.push({
				candidate: c,
				against: best.against,
				score: best.score,
			});
			continue;
		}
		c.status = "unique";
		accepted.push(h);
		acceptedNorm.add(normaliseText(h));
	}

	if (ambiguous.length) {
		const groups = batches(ambiguous, JUDGE_BATCH);
		const results = await callJsonMany(
			groups.map((batch) => ({
				model: RATE_MODEL,
				system: dedupeSystem,
				user: dedupeUser(
					batch.map((p) => ({
						a: p.against,
						b: headlineOfFields(spec.kind, p.candidate.fields),
					})),
				),
				schema: dedupeSchema,
				maxOutputTokens: 4000,
				effort: "none" as const,
				temperature: 0,
			})),
			{ stage: `dedupe/${spec.deck}`, promptVersion: PROMPT_VERSION.dedupe },
		);
		let unjudged = 0;
		groups.forEach((batch, g) => {
			const res = results[g];
			const byIdx =
				res && !(res instanceof Error)
					? itemsByIndex(res.json, batch.length)
					: null;
			batch.forEach((p, i) => {
				const verdict = byIdx?.get(i)?.same;
				if (verdict === true) {
					reject(
						p.candidate,
						spec.kind,
						"dedupe",
						`judge: same as "${p.against}" (${p.score.toFixed(2)})`,
					);
					count(reasons, "judged duplicate");
					return;
				}
				// false, or no judge / no verdict: keep both. Recoverable either way.
				p.candidate.status = "unique";
				if (verdict !== false) {
					unjudged++;
					count(reasons, "kept unjudged");
				}
			});
		});
		if (unjudged)
			console.warn(
				`  [${spec.deck}] ${unjudged} ambiguous pairs kept without a judge verdict`,
			);
	}

	writeCandidates(spec.deck, all);
	console.log(
		ratio(
			`dedupe ${spec.deck}`,
			fresh.length,
			fresh.filter((c) => c.status === "unique").length,
			reasons,
		),
	);
}

async function main() {
	installUsageReporting();
	for (const d of deckArgs(loadDeckSpecs().map((s) => s.deck)))
		await dedupeDeck(deckSpec(d));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
