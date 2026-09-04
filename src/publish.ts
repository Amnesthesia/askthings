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
import { DUPLICATE_AT, diceSimilarity } from "./text.ts";

/** The level a candidate publishes into. */
function tierOf(spec: DeckSpec, c: Candidate): number {
	if (spec.generation.wholeRun || spec.generation.tierFrom === "writer")
		return c.tier;
	return tierForIntensity(spec, c.judgedIntensity ?? c.intensity);
}

/** 0..1. The comparative rank when the rank stage has run; otherwise the
 * rubric sum, which cannot tell the survivors apart (all voice 4-5). */
function quality(c: Candidate): number {
	if (c.rank !== undefined) return c.rank;
	const s = c.scores;
	return ((s?.conversation ?? 0) + (s?.voice ?? 0) + (s?.depth ?? 0)) / 15;
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
		...(c.assumesHistory !== undefined
			? { assumesHistory: c.assumesHistory }
			: {}),
		...(c.facets ? { facets: c.facets } : {}),
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
			// One run assembled by position: the arc lives in the positions (1-5
			// warm … 21 the closer), so the best passing card at each position from
			// any provider's run keeps the arc. Nine whole runs in a row were sunk
			// by one weak card each, so runs are no longer kept or dropped whole.
			const n = spec.generation.targetPerTier;
			const picked: Candidate[] = [];
			for (let pos = 0; pos < n; pos++) {
				const options = safe
					.filter((c) => c.position === pos)
					.sort((a, b) => quality(b) - quality(a));
				// ponytail: same-position picks from different runs can still ask
				// the same thing in other words; Dice catches the close ones only.
				const pick = options.find((c) =>
					picked.every(
						(p) =>
							diceSimilarity(
								headlineOfFields(spec.kind, c.fields),
								headlineOfFields(spec.kind, p.fields),
							) < DUPLICATE_AT,
					),
				);
				if (pick) picked.push(pick);
			}
			chosen = picked.length === n ? picked : [];
			if (!chosen.length)
				count(
					reasons,
					`no card passed at ${n - picked.length} of ${n} positions`,
				);
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
