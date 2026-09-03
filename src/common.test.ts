import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	type Card,
	cardId,
	type Deck,
	EMPTY_SCORES,
	ID_PATTERN,
	loadDecks,
	validateDeck,
} from "./common.ts";

test("cardId output is frozen", () => {
	// DO NOT CHANGE these values. They are the share URLs of the fixture deck;
	// changing the basis or the algorithm re-keys every card at once.
	assert.equal(
		cardId("inquisitives", "What do you like to learn about?"),
		"e50bb24bdb",
	);
	// Case and punctuation do not change identity …
	assert.equal(
		cardId("inquisitives", "what do you like to learn about"),
		"e50bb24bdb",
	);
	// … but the deck does: the same words in two decks are two cards.
	assert.notEqual(
		cardId("fast-friends", "What do you like to learn about?"),
		"e50bb24bdb",
	);
	assert.match(cardId("x", "y"), ID_PATTERN);
});

function deck(overrides: Partial<Deck> = {}): Deck {
	return {
		deck: "sample",
		name: "Sample",
		blurb: "A sample deck.",
		kind: "question",
		play: { order: "free", cardsPerTier: null, howToPlay: [] },
		tiers: [{ level: 1, name: "One", description: "First." }],
		cards: [
			{
				id: "0123456789",
				tier: 1,
				intensity: 1,
				text: "Hi?",
				tags: [],
				origin: null,
				gen: null,
				scores: EMPTY_SCORES,
			},
		],
		...overrides,
	} as Deck;
}

test("a well-formed deck validates", () => {
	assert.deepEqual(validateDeck(deck()), []);
});

test("validateDeck names the problem and the card", () => {
	const bad = deck();
	(bad as { cards: Card[] }).cards.push({
		...bad.cards[0],
		id: "zz",
		tier: 9,
		intensity: 7 as never,
		scores: { ...EMPTY_SCORES, depth: 6 },
	});
	const errors = validateDeck(bad);
	for (const needle of [
		"card[1] zz: id is not 10 hex",
		"tier 9 is not declared",
		"intensity 7",
		"scores.depth",
	])
		assert.ok(
			errors.some((e) => e.includes(needle)),
			`${needle} in ${JSON.stringify(errors)}`,
		);
});

test("reserved slugs and out-of-order tier levels are rejected", () => {
	assert.ok(
		validateDeck(deck({ deck: "questions" })).some((e) =>
			e.includes("reserved"),
		),
	);
	const tiers = [
		{ level: 2, name: "Two", description: "x" },
		{ level: 1, name: "One", description: "y" },
	];
	assert.ok(
		validateDeck(deck({ tiers })).some((e) =>
			e.includes("tier levels must be 1..2"),
		),
	);
});

test("pair and dilemma cards are checked for their own fields", () => {
	const pair = deck({
		kind: "pair",
		cards: [{ ...deck().cards[0], a: "x", b: "" } as never],
	});
	assert.ok(validateDeck(pair).some((e) => e.includes("a and b")));
	const dilemma = deck({
		kind: "dilemma",
		cards: [
			{
				...deck().cards[0],
				title: "T",
				setup: "S",
				dilemma: "D",
				probes: ["only one"],
			} as never,
		],
	});
	assert.ok(
		validateDeck(dilemma).some((e) => e.includes("probes must be 2–3")),
	);
});

test("loadDecks rejects a slug that does not match its filename and ids shared across decks", () => {
	const dir = mkdtempSync(join(tmpdir(), "askthings-"));
	writeFileSync(join(dir, "sample.json"), JSON.stringify(deck()));
	writeFileSync(
		join(dir, "other.json"),
		JSON.stringify(deck({ deck: "other" })),
	);
	assert.throws(
		() => loadDecks(dir),
		/also exists in deck "other"|also exists in deck "sample"/,
	);
	writeFileSync(
		join(dir, "other.json"),
		JSON.stringify(deck({ deck: "mismatch" })),
	);
	assert.throws(() => loadDecks(dir), /does not match filename/);
});
