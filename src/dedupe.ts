// pnpm deduplicate [deck,...] ("dedupe" alone is a pnpm built-in) — cross-provider near-duplicate removal. Cheapest test
// first: normalised exact match, then Dice similarity; then the few nearest
// neighbours of every survivor go to a model, because Dice cannot tell "faked a
// phone call to escape a fundraiser" from "pretended my phone rang to get out
// of a conversation" (0.52) and a published deck with the same card three
// times is what that gap looks like. Without a judge the survivors are kept (a
// visible duplicate is recoverable; a wrongly merged card is not).

import {
	type CardFields,
	count,
	dedupeText,
	ratio,
	readCandidates,
	reject,
	writeCandidates,
} from "./candidates.ts";
import { normaliseText } from "./common.ts";
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

/** How many nearest accepted texts each survivor is judged against. */
export const NEAREST = 5;

export interface DedupeVerdicts<T> {
	/** Rejection reason per item, or null when it is unique. */
	reasons: Map<T, string | null>;
	/** Survivors the judge never answered for (kept anyway). */
	unjudged: number;
}

/**
 * Decides, in order, which `items` duplicate `accepted` (which grows as items
 * survive, so later items are also checked against earlier survivors). The
 * stage and the maintenance pass share this so they cannot disagree.
 */
export async function dedupeAgainst<T>(
	accepted: string[],
	items: { item: T; text: string }[],
	stage: string,
): Promise<DedupeVerdicts<T>> {
	const acceptedNorm = new Set(accepted.map(normaliseText));
	const reasons = new Map<T, string | null>();
	const pairs: { item: T; against: string; score: number }[] = [];
	const pending = new Set<T>();

	for (const { item, text } of items) {
		if (acceptedNorm.has(normaliseText(text))) {
			reasons.set(item, "exact duplicate");
			continue;
		}
		const scored = accepted
			.map((against) => ({ against, score: diceSimilarity(text, against) }))
			.sort((a, b) => b.score - a.score);
		const best = scored[0];
		if (best && best.score >= DUPLICATE_AT) {
			reasons.set(
				item,
				`near duplicate (${best.score.toFixed(2)}) of "${best.against}"`,
			);
			continue;
		}
		const near = scored
			.slice(0, NEAREST)
			.filter((s) => s.score >= AMBIGUOUS_FROM);
		if (near.length) {
			pending.add(item);
			for (const n of near) pairs.push({ item, ...n });
			continue;
		}
		reasons.set(item, null);
		accepted.push(text);
		acceptedNorm.add(normaliseText(text));
	}

	let unjudged = 0;
	if (pairs.length) {
		const textOf = new Map(items.map((i) => [i.item, i.text]));
		const groups = batches(pairs, JUDGE_BATCH);
		const results = await callJsonMany(
			groups.map((batch) => ({
				model: RATE_MODEL,
				system: dedupeSystem,
				user: dedupeUser(
					batch.map((p) => ({ a: p.against, b: textOf.get(p.item) ?? "" })),
				),
				schema: dedupeSchema,
				maxOutputTokens: 4000,
				effort: "none" as const,
				temperature: 0,
			})),
			{ stage, promptVersion: PROMPT_VERSION.dedupe },
		);
		const answered = new Set<T>();
		groups.forEach((batch, g) => {
			const res = results[g];
			const byIdx =
				res && !(res instanceof Error)
					? itemsByIndex(res.json, batch.length)
					: null;
			batch.forEach((p, i) => {
				const verdict = byIdx?.get(i)?.same;
				if (verdict === true && !reasons.get(p.item))
					reasons.set(
						p.item,
						`judge: same as "${p.against}" (${p.score.toFixed(2)})`,
					);
				if (verdict === true || verdict === false) answered.add(p.item);
			});
		});
		// ponytail: survivors are judged against what was accepted before the
		// batch, not against each other; two near-identical newcomers in one
		// run both pass. The next run's avoid-list and dedupe catch the pair.
		for (const item of pending) {
			if (reasons.get(item)) continue;
			reasons.set(item, null);
			if (!answered.has(item)) unjudged++;
			const text = textOf.get(item) ?? "";
			accepted.push(text);
			acceptedNorm.add(normaliseText(text));
		}
	}
	return { reasons, unjudged };
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
	const accepted = [
		...deck.cards.map((c) => dedupeText(spec.kind, c as unknown as CardFields)),
		...all
			.filter((c) =>
				["unique", "rated", "safe", "published"].includes(c.status),
			)
			.map((c) => dedupeText(spec.kind, c.fields)),
	];
	const { reasons, unjudged } = await dedupeAgainst(
		accepted,
		fresh.map((c) => ({ item: c, text: dedupeText(spec.kind, c.fields) })),
		`dedupe/${spec.deck}`,
	);
	const counts = new Map<string, number>();
	for (const c of fresh) {
		const why = reasons.get(c) ?? null;
		if (why) {
			reject(c, spec.kind, "dedupe", why);
			count(
				counts,
				why.split(/[ (]/)[0] === "judge:"
					? "judged duplicate"
					: why.split(" (")[0],
			);
		} else c.status = "unique";
	}
	if (unjudged) {
		count(counts, "kept unjudged");
		console.warn(
			`  [${spec.deck}] ${unjudged} survivors kept without a judge verdict`,
		);
	}
	writeCandidates(spec.deck, all);
	console.log(
		ratio(
			`dedupe ${spec.deck}`,
			fresh.length,
			fresh.filter((c) => c.status === "unique").length,
			counts,
		),
	);
}

async function main() {
	installUsageReporting();
	for (const d of deckArgs(loadDeckSpecs().map((s) => s.deck)))
		await dedupeDeck(deckSpec(d));
}

if (process.argv[1]?.endsWith("dedupe.ts"))
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
