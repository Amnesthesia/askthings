// decks.yml is the source of truth for every deck: metadata, play settings and
// the generation brief. `pnpm sync` writes the site-facing part into
// content/{deck}.json, preserving cards; the brief and tier guidance are used
// by the prompts only.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import {
	CONTENT_ROOT,
	DECK_KINDS,
	type Deck,
	INTENSITIES,
	type Intensity,
	PLAY_ORDERS,
	type Play,
	PROJECT_ROOT,
	type Tier,
	validateDeck,
} from "./common.ts";
import { type ProviderName, providerOfModel } from "./providers/base.ts";

export interface TierSpec extends Tier {
	/** Where cards written for this tier land on the global 1-4 scale. */
	intensity: Intensity;
	guidance: string;
}

export interface DeckSpec {
	deck: string;
	name: string;
	blurb: string;
	kind: Deck["kind"];
	play: Play;
	generation: {
		brief: string;
		/** Asked per provider per tier per call. */
		candidatesPerTier: number;
		/** Publish keeps the best cards up to this many per tier. */
		targetPerTier: number;
		/** The deck is generated as ONE complete run per provider (21 Questions):
		 * asked at targetPerTier, never deduplicated across runs, rated and
		 * published as a whole. Sequential decks without this (Fast Friends) are
		 * oversampled and the best cards per set are kept. */
		wholeRun?: boolean;
		/** Per-provider generation model for this deck; defaults in src/stage.ts. */
		models?: Partial<Record<ProviderName, string>>;
	};
	tiers: TierSpec[];
}

let cache: DeckSpec[] | null = null;

export function loadDeckSpecs(
	file = join(PROJECT_ROOT, "decks.yml"),
): DeckSpec[] {
	if (cache) return cache;
	const raw = load(readFileSync(file, "utf-8")) as Record<
		string,
		Omit<DeckSpec, "deck">
	>;
	const specs: DeckSpec[] = [];
	for (const [deck, spec] of Object.entries(raw)) {
		const s: DeckSpec = { deck, ...spec };
		const problems: string[] = [];
		if (!DECK_KINDS.includes(s.kind)) problems.push(`kind "${s.kind}"`);
		if (!PLAY_ORDERS.includes(s.play?.order))
			problems.push(`play.order "${s.play?.order}"`);
		if (!s.generation?.brief?.trim()) problems.push("generation.brief missing");
		for (const k of ["candidatesPerTier", "targetPerTier"] as const)
			if (!Number.isInteger(s.generation?.[k]) || s.generation[k] < 1)
				problems.push(`generation.${k}`);
		for (const [provider, model] of Object.entries(
			s.generation?.models ?? {},
		)) {
			try {
				if (providerOfModel(model) !== provider)
					problems.push(
						`generation.models.${provider}: "${model}" belongs to ${providerOfModel(model)}`,
					);
			} catch {
				problems.push(
					`generation.models.${provider}: unknown model "${model}"`,
				);
			}
		}
		for (const t of s.tiers ?? []) {
			if (!(INTENSITIES as readonly number[]).includes(t.intensity))
				problems.push(`tier ${t.level} intensity ${t.intensity}`);
			if (!t.guidance?.trim())
				problems.push(`tier ${t.level} guidance missing`);
		}
		// The rest of the shape is what validateDeck checks on the synced deck.
		const errors = validateDeck(toDeck(s, []));
		if (problems.length || errors.length)
			throw new Error(
				`decks.yml ${deck}: ${[...problems, ...errors].join("; ")}`,
			);
		specs.push(s);
	}
	cache = specs;
	return specs;
}

export function deckSpec(deck: string): DeckSpec {
	const s = loadDeckSpecs().find((d) => d.deck === deck);
	if (!s)
		throw new Error(
			`no deck "${deck}" in decks.yml (have: ${loadDeckSpecs()
				.map((d) => d.deck)
				.join(", ")})`,
		);
	return s;
}

/** The deck tier a judged intensity maps to: nearest declared intensity, lower on ties. */
export function tierForIntensity(spec: DeckSpec, intensity: Intensity): number {
	let best = spec.tiers[0];
	for (const t of spec.tiers) {
		const d = Math.abs(t.intensity - intensity);
		const bd = Math.abs(best.intensity - intensity);
		if (d < bd || (d === bd && t.level < best.level)) best = t;
	}
	return best.level;
}

export function deckFile(deck: string): string {
	return join(CONTENT_ROOT, `${deck}.json`);
}

/** The site-facing deck: spec metadata + play + tiers (without prompt fields) + cards. */
export function toDeck(spec: DeckSpec, cards: Deck["cards"]): Deck {
	return {
		deck: spec.deck,
		name: spec.name,
		blurb: spec.blurb,
		kind: spec.kind,
		play: {
			order: spec.play.order,
			cardsPerTier: spec.play.cardsPerTier ?? null,
			howToPlay: [...spec.play.howToPlay],
		},
		tiers: spec.tiers.map(({ level, name, description }) => ({
			level,
			name,
			description,
		})),
		cards,
	} as Deck;
}

/** content/{deck}.json with metadata refreshed from the spec; cards preserved. */
export function readDeck(spec: DeckSpec): Deck {
	const file = deckFile(spec.deck);
	const existing = existsSync(file)
		? (JSON.parse(readFileSync(file, "utf-8")) as Deck)
		: null;
	if (existing && existing.kind !== spec.kind && existing.cards.length)
		throw new Error(
			`${file}: kind changed from ${existing.kind} to ${spec.kind} with cards present`,
		);
	return toDeck(spec, existing?.cards ?? []);
}

export function writeDeck(deck: Deck): void {
	const errors = validateDeck(deck);
	if (errors.length)
		throw new Error(
			`refusing to write ${deck.deck}:\n  ${errors.join("\n  ")}`,
		);
	writeFileSync(
		deckFile(deck.deck),
		`${JSON.stringify(deck, null, 2)}\n`,
		"utf-8",
	);
}

/** Every deck in decks.yml, synced to disk. Returns what changed. */
export function syncDecks(): string[] {
	const changed: string[] = [];
	for (const spec of loadDeckSpecs()) {
		const file = deckFile(spec.deck);
		const before = existsSync(file) ? readFileSync(file, "utf-8") : "";
		const deck = readDeck(spec);
		const after = `${JSON.stringify(deck, null, 2)}\n`;
		if (after !== before) {
			writeDeck(deck);
			changed.push(spec.deck);
		}
	}
	return changed;
}
