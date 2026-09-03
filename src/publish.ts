// pnpm publish-cards [deck,...] ("publish" alone is a pnpm built-in) — move safe candidates into content/{deck}.json.
// Additive: never removes a card. Keeps the best up to targetPerTier per tier;
// a sequential deck takes exactly one whole run, and only while it is empty.

import {
	type Candidate,
	count,
	headlineOfFields,
	ratio,
	readCandidates,
	reject,
	writeCandidates,
} from "./candidates.ts";
import { type Card, cardId, EMPTY_SCORES, normaliseText } from "./common.ts";
import {
	type DeckSpec,
	deckSpec,
	loadDeckSpecs,
	readDeck,
	syncDecks,
	tierForIntensity,
	writeDeck,
} from "./decks.ts";
import { deckArgs } from "./stage.ts";

/** The level a candidate publishes into. */
function tierOf(spec: DeckSpec, c: Candidate): number {
	if (spec.generation.wholeRun || spec.generation.tierFrom === "writer")
		return c.tier;
	return tierForIntensity(spec, c.judgedIntensity ?? c.intensity);
}

function quality(c: Candidate): number {
	const s = c.scores;
	return (s?.conversation ?? 0) + (s?.voice ?? 0) + (s?.depth ?? 0);
}

function toCard(spec: DeckSpec, c: Candidate): Card {
	const intensity = c.judgedIntensity ?? c.intensity;
	return {
		...c.fields,
		id: cardId(spec.deck, headlineOfFields(spec.kind, c.fields)),
		tier: tierOf(spec, c),
		intensity,
		tags: c.tags,
		origin: "origin" in c.fields ? c.fields.origin : null,
		gen: { provider: c.provider, model: c.model, prompt: c.prompt, at: c.at },
		scores: c.scores ?? EMPTY_SCORES,
	} as Card;
}

function publishDeck(spec: DeckSpec) {
	const all = readCandidates(spec.deck);
	const safe = all.filter((c) => c.status === "safe");
	if (!safe.length) return;
	const deck = readDeck(spec);
	const reasons = new Map<string, number>();
	const have = new Set(deck.cards.map((c) => c.id));
	let chosen: Candidate[];

	if (spec.generation.wholeRun) {
		if (deck.cards.length) {
			for (const c of safe) {
				reject(c, spec.kind, "publish", "ordered deck already has its run");
				count(reasons, "deck already has its run");
			}
			chosen = [];
		} else {
			// One whole run: the batch with the best mean quality, in play order.
			const runs = new Map<string, Candidate[]>();
			for (const c of safe)
				runs.set(c.batch, [...(runs.get(c.batch) ?? []), c]);
			const complete = [...runs.values()].filter(
				(r) => r.length === spec.generation.targetPerTier,
			);
			complete.sort(
				(a, b) =>
					b.reduce((n, c) => n + quality(c), 0) -
					a.reduce((n, c) => n + quality(c), 0),
			);
			chosen = (complete[0] ?? []).sort((a, b) => a.position - b.position);
			if (!chosen.length)
				count(reasons, `no complete run of ${spec.generation.targetPerTier}`);
		}
	} else {
		// Best first, then fill each tier up to its target. A canonical thought
		// experiment retold under three titles is one card: the first (best) one
		// per normalised origin is kept, the rest rejected with the reason.
		const originsSeen = new Set(
			deck.cards
				.map((c) => (c.origin ? normaliseText(c.origin) : ""))
				.filter(Boolean),
		);
		const room = new Map(
			spec.tiers.map((t) => [
				t.level,
				spec.generation.targetPerTier -
					deck.cards.filter((c) => c.tier === t.level).length,
			]),
		);
		chosen = [];
		for (const c of [...safe].sort((a, b) => quality(b) - quality(a))) {
			const rawOrigin = "origin" in c.fields ? c.fields.origin : null;
			const origin = rawOrigin ? normaliseText(rawOrigin) : "";
			if (origin) {
				if (originsSeen.has(origin)) {
					reject(
						c,
						spec.kind,
						"publish",
						`another retelling of "${rawOrigin}" scored higher`,
					);
					count(reasons, "duplicate origin");
					continue;
				}
				originsSeen.add(origin);
			}
			const tier = tierOf(spec, c);
			if ((room.get(tier) ?? 0) <= 0) {
				count(reasons, `level ${tier} full (left as safe)`);
				continue;
			}
			room.set(tier, (room.get(tier) ?? 0) - 1);
			chosen.push(c);
		}
	}

	// A sequential deck is played in file order, so within each set the cards
	// climb: lighter first, best of equals first.
	if (spec.play.order === "sequential" && !spec.generation.wholeRun)
		chosen.sort(
			(a, b) =>
				tierOf(spec, a) - tierOf(spec, b) ||
				(a.judgedIntensity ?? a.intensity) -
					(b.judgedIntensity ?? b.intensity) ||
				quality(b) - quality(a),
		);
	const cards = deck.cards as Card[];
	for (const c of chosen) {
		const card = toCard(spec, c);
		if (have.has(card.id)) {
			reject(c, spec.kind, "publish", "a card with this id already exists");
			count(reasons, "duplicate id");
			continue;
		}
		have.add(card.id);
		cards.push(card);
		c.status = "published";
	}
	if (chosen.some((c) => c.status === "published")) writeDeck(deck);
	writeCandidates(spec.deck, all);
	console.log(
		ratio(
			`publish ${spec.deck}`,
			safe.length,
			chosen.filter((c) => c.status === "published").length,
			reasons,
		),
	);
}

syncDecks();
for (const d of deckArgs(loadDeckSpecs().map((s) => s.deck)))
	publishDeck(deckSpec(d));
