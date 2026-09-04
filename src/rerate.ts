// pnpm rerate [deck,...] — re-judge every PUBLISHED card (and every live
// candidate) with the current rubric, in place. For when the rubric grows an
// axis or a facet: the corpus gets the new annotations from the same judge
// that will score new cards, so filters mean one thing across the site.
// Never changes status, ids or membership: publish and prune decide those.

import {
	type CardFields,
	judgeText,
	readCandidates,
	writeCandidates,
} from "./candidates.ts";
import {
	type DeckSpec,
	deckSpec,
	loadDeckSpecs,
	readDeck,
	writeDeck,
} from "./decks.ts";
import { callJsonMany, installUsageReporting } from "./llm.ts";
import {
	asFacets,
	asIntensity,
	asScore,
	PROMPT_VERSION,
	rateSchema,
	rateSystem,
	rateUser,
} from "./prompts.ts";
import { type Card, SCORE_KEYS, type Scores } from "./shared.ts";
import {
	batches,
	deckArgs,
	itemsByIndex,
	JUDGE_BATCH,
	RATE_MODEL,
} from "./stage.ts";

type Judged = {
	scores: Scores;
	intensity: number;
	assumesHistory?: boolean;
	facets: ReturnType<typeof asFacets>;
};

async function judge(
	spec: DeckSpec,
	fields: CardFields[],
): Promise<(Judged | null)[]> {
	const groups = batches(fields, JUDGE_BATCH);
	const results = await callJsonMany(
		groups.map((batch) => ({
			model: RATE_MODEL,
			system: rateSystem,
			user: rateUser(
				spec.kind,
				batch.map((f) => judgeText(spec.kind, f)),
				spec.generation.rateNote,
			),
			schema: rateSchema,
			maxOutputTokens: 8000,
			effort: "none" as const,
			temperature: 0,
		})),
		{ stage: `rerate/${spec.deck}`, promptVersion: PROMPT_VERSION.rate },
	);
	const out: (Judged | null)[] = [];
	groups.forEach((batch, g) => {
		const res = results[g];
		const byIdx =
			res && !(res instanceof Error)
				? itemsByIndex(res.json, batch.length)
				: null;
		for (let i = 0; i < batch.length; i++) {
			const item = byIdx?.get(i);
			if (!item) {
				out.push(null);
				continue;
			}
			const scores = Object.fromEntries(
				SCORE_KEYS.map((k) => [k, asScore(item[k])]),
			) as Record<(typeof SCORE_KEYS)[number], number | null>;
			const intensity = asIntensity(item.intensity);
			if (Object.values(scores).some((v) => v === null) || intensity === null) {
				out.push(null);
				continue;
			}
			out.push({
				scores: { ...scores, rated: `${RATE_MODEL}@${PROMPT_VERSION.rate}` },
				intensity,
				assumesHistory:
					typeof item.assumesHistory === "boolean"
						? item.assumesHistory
						: undefined,
				facets: asFacets(item),
			});
		}
	});
	return out;
}

async function rerateDeck(spec: DeckSpec) {
	if (spec.generation.rate === false) return;
	const deck = readDeck(spec);
	const cards = deck.cards as Card[];
	const judged = await judge(
		spec,
		cards.map((c) => c as unknown as CardFields),
	);
	let done = 0;
	cards.forEach((c, i) => {
		const j = judged[i];
		if (!j) return;
		c.scores = j.scores;
		// The published level is not touched (tierFrom decided it); intensity is.
		c.intensity = j.intensity as Card["intensity"];
		if (j.assumesHistory !== undefined) c.assumesHistory = j.assumesHistory;
		c.facets = j.facets;
		done++;
	});
	if (done) writeDeck(deck);

	const all = readCandidates(spec.deck);
	const live = all.filter(
		(c) => !["rejected", "published", "new"].includes(c.status),
	);
	const cj = await judge(
		spec,
		live.map((c) => c.fields),
	);
	let cdone = 0;
	live.forEach((c, i) => {
		const j = cj[i];
		if (!j) return;
		c.scores = j.scores;
		c.judgedIntensity = j.intensity as Card["intensity"];
		if (j.assumesHistory !== undefined) c.assumesHistory = j.assumesHistory;
		c.facets = j.facets;
		cdone++;
	});
	if (cdone) writeCandidates(spec.deck, all);
	console.log(
		`  rerate ${spec.deck}: ${done}/${cards.length} published, ${cdone}/${live.length} live candidates re-judged`,
	);
}

async function main() {
	installUsageReporting();
	for (const d of deckArgs(loadDeckSpecs().map((s) => s.deck)))
		await rerateDeck(deckSpec(d));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
