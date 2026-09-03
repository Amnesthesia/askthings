// Pipeline-only helpers. Values shared with the browser bundle live in
// shared.ts, which must stay free of node: imports — importing this file from
// app/ code drags node:fs into Vite and fails the build. Re-exported here so
// pipeline modules keep importing everything from common.ts.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type Card,
	cardHeadline,
	DECK_KINDS,
	type Deck,
	type DilemmaCard,
	IMPROV_SLOTS,
	type ImprovCard,
	INTENSITIES,
	normaliseText,
	type PairCard,
	PLAY_ORDERS,
	type QuestionCard,
	RESERVED_SLUGS,
	SCORE_KEYS,
} from "./shared.ts";

export * from "./shared.ts";

// process.cwd(), not import.meta.url: Astro bundles this module into
// dist/.prerender/ at build time, from where a URL-relative path points at
// nothing. Every script and the build run from the repo root.
export const PROJECT_ROOT = resolve(process.cwd());
// Overridable so tests can point at a scratch directory instead of the real
// content dir.
export const CONTENT_ROOT =
	process.env.ASKTHINGS_CONTENT_ROOT ?? join(PROJECT_ROOT, "content");

/**
 * The frozen identity of a card: the basis of its share URL and of any feed
 * id. Assigned ONCE when a card enters content/ and stored in the JSON — a
 * later typo fix keeps the URL. The deck slug is part of the basis on
 * purpose: the same words in two decks are two cards.
 *
 * DO NOT change the basis or the algorithm. src/common.test.ts pins the
 * output against a fixture.
 */
export function cardId(deck: string, headline: string): string {
	return createHash("sha256")
		.update(`${deck}|${normaliseText(headline)}`)
		.digest("hex")
		.slice(0, 10);
}

export const ID_PATTERN = /^[0-9a-f]{10}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * Returns every problem with a deck as a human-readable list; empty means
 * valid. Hand-written rather than a schema library: the shape is small, and
 * the messages name the card so a bad generated batch is diagnosable.
 */
export function validateDeck(deck: Deck): string[] {
	const errors: string[] = [];
	if (!SLUG_PATTERN.test(deck.deck))
		errors.push(`deck slug "${deck.deck}" is not kebab-case`);
	if ((RESERVED_SLUGS as readonly string[]).includes(deck.deck))
		errors.push(`deck slug "${deck.deck}" is reserved by a route`);
	if (!nonEmpty(deck.name)) errors.push("name is empty");
	if (!nonEmpty(deck.blurb)) errors.push("blurb is empty");
	if (!DECK_KINDS.includes(deck.kind))
		errors.push(`kind "${deck.kind}" is not one of ${DECK_KINDS.join(", ")}`);
	if (!deck.play || typeof deck.play !== "object")
		errors.push("play settings missing");
	else {
		if (!PLAY_ORDERS.includes(deck.play.order))
			errors.push(
				`play.order "${deck.play.order}" not one of ${PLAY_ORDERS.join(", ")}`,
			);
		const n = deck.play.cardsPerTier;
		if (n !== null && !(Number.isInteger(n) && n > 0))
			errors.push("play.cardsPerTier must be a positive integer or null");
		if (
			!Array.isArray(deck.play.howToPlay) ||
			!deck.play.howToPlay.every(nonEmpty)
		)
			errors.push("play.howToPlay must be a list of strings");
	}
	if (!Array.isArray(deck.tiers) || deck.tiers.length === 0) {
		errors.push("tiers is empty");
	} else {
		const levels = deck.tiers.map((t) => t.level);
		const expected = deck.tiers.map((_, i) => i + 1);
		if (levels.join() !== expected.join())
			errors.push(
				`tier levels must be 1..${deck.tiers.length} in order, got ${levels.join(",")}`,
			);
		for (const tier of deck.tiers) {
			if (!nonEmpty(tier.name)) errors.push(`tier ${tier.level} has no name`);
			if (!nonEmpty(tier.description))
				errors.push(`tier ${tier.level} has no description`);
		}
	}

	if (!Array.isArray(deck.cards)) {
		errors.push("cards is not an array");
		return errors;
	}
	const levels = new Set(deck.tiers?.map((t) => t.level) ?? []);
	const seen = new Set<string>();
	deck.cards.forEach((card: Card, i) => {
		const label = `card[${i}]${card.id ? ` ${card.id}` : ""}`;
		if (!ID_PATTERN.test(card.id ?? ""))
			errors.push(`${label}: id is not 10 hex chars`);
		else if (seen.has(card.id)) errors.push(`${label}: duplicate id`);
		seen.add(card.id);
		if (!levels.has(card.tier))
			errors.push(`${label}: tier ${card.tier} is not declared`);
		if (!(INTENSITIES as readonly number[]).includes(card.intensity))
			errors.push(
				`${label}: intensity ${card.intensity} not in ${INTENSITIES.join(",")}`,
			);
		if (!Array.isArray(card.tags) || !card.tags.every(nonEmpty))
			errors.push(`${label}: tags must be strings`);
		if (card.origin !== null && !nonEmpty(card.origin))
			errors.push(`${label}: origin must be a string or null`);
		if (
			card.gen !== null &&
			(typeof card.gen !== "object" || !nonEmpty(card.gen.provider))
		)
			errors.push(`${label}: gen must be a provenance object or null`);
		if (!card.scores || typeof card.scores !== "object") {
			errors.push(`${label}: scores missing`);
		} else {
			for (const key of SCORE_KEYS) {
				const v = card.scores[key];
				if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 5))
					errors.push(`${label}: scores.${key} must be 1–5 or null`);
			}
			if (card.scores.rated !== null && !nonEmpty(card.scores.rated))
				errors.push(`${label}: scores.rated must be a string or null`);
		}
		switch (deck.kind) {
			case "question":
				if (!nonEmpty((card as QuestionCard).text))
					errors.push(`${label}: text is empty`);
				break;
			case "pair": {
				const { a, b } = card as PairCard;
				if (!nonEmpty(a) || !nonEmpty(b))
					errors.push(`${label}: a and b must both be set`);
				break;
			}
			case "improv": {
				const w = card as ImprovCard;
				if (!nonEmpty(w.word)) errors.push(`${label}: word is empty`);
				if (!IMPROV_SLOTS.includes(w.slot))
					errors.push(
						`${label}: slot must be one of ${IMPROV_SLOTS.join(", ")}`,
					);
				break;
			}
			case "dilemma": {
				const d = card as DilemmaCard;
				for (const key of ["title", "setup", "dilemma"] as const)
					if (!nonEmpty(d[key])) errors.push(`${label}: ${key} is empty`);
				if (
					!Array.isArray(d.probes) ||
					d.probes.length < 2 ||
					d.probes.length > 3 ||
					!d.probes.every(nonEmpty)
				)
					errors.push(`${label}: probes must be 2–3 strings`);
				break;
			}
		}
	});
	return errors;
}

export function deckFiles(root = CONTENT_ROOT): string[] {
	return readdirSync(root)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => join(root, f));
}

/**
 * Every deck under content/, validated, with ids unique across all decks.
 * Throws with the file path: a bad deck must fail the build, not ship half.
 */
export function loadDecks(root = CONTENT_ROOT): Deck[] {
	const decks: Deck[] = [];
	const owners = new Map<string, string>();
	for (const file of deckFiles(root)) {
		const deck = JSON.parse(readFileSync(file, "utf-8")) as Deck;
		const errors = validateDeck(deck);
		const expectedSlug = file
			.split("/")
			.pop()
			?.replace(/\.json$/, "");
		if (deck.deck !== expectedSlug)
			errors.push(`deck slug "${deck.deck}" does not match filename`);
		for (const card of deck.cards) {
			const owner = owners.get(card.id);
			if (owner && owner !== deck.deck)
				errors.push(`card ${card.id} also exists in deck "${owner}"`);
			owners.set(card.id, deck.deck);
		}
		if (errors.length) throw new Error(`${file}:\n  ${errors.join("\n  ")}`);
		decks.push(deck);
	}
	return decks;
}

/** Decks the site renders: a deck synced from decks.yml but not yet
 * generated has no cards and no page. */
export function publishedDecks(root = CONTENT_ROOT): Deck[] {
	return loadDecks(root).filter((d) => d.cards.length > 0);
}

/** Headline of a card given its deck — the id basis. */
export function headlineOf(deck: Deck, card: Card): string {
	return cardHeadline(deck.kind, card);
}
