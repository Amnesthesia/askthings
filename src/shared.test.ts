import assert from "node:assert/strict";
import { test } from "node:test";
import {
	cardHeadline,
	cardPath,
	cardSummary,
	type Deck,
	type DilemmaCard,
	deckPath,
	EMPTY_SCORES,
	groupByTier,
	normaliseText,
	type PairCard,
	type QuestionCard,
	truncateAtWord,
} from "./shared.ts";

const base = {
	id: "0000000000",
	tier: 1,
	intensity: 1 as const,
	tags: [],
	origin: null,
	gen: null,
	scores: EMPTY_SCORES,
};

test("normaliseText is case-, punctuation- and whitespace-insensitive", () => {
	assert.equal(
		normaliseText("  What's  YOUR favourite   café? "),
		"what s your favourite cafe",
	);
	assert.equal(normaliseText("Never have I ever…"), "never have i ever");
});

test("headline and summary per card kind", () => {
	const q: QuestionCard = { ...base, text: "What do you like to learn about?" };
	const p: PairCard = {
		...base,
		a: "never be late again",
		b: "never be tired again",
	};
	const d: DilemmaCard = {
		...base,
		title: "Trolley Problem",
		setup:
			"A runaway trolley will kill five people. You can pull a lever and divert it, killing one.",
		dilemma: "Do you pull it?",
		probes: [
			"Would you push someone instead?",
			"Does it matter who the one is?",
		],
	};
	assert.equal(cardHeadline("question", q), q.text);
	assert.equal(
		cardHeadline("pair", p),
		"never be late again or never be tired again?",
	);
	assert.equal(cardHeadline("dilemma", d), "Trolley Problem");
	assert.equal(
		cardSummary("pair", p),
		"Would you rather never be late again — or — never be tired again?",
	);
	assert.equal(cardSummary("dilemma", d), d.setup);
});

test("paths end in a slash — GitHub Pages 301s the slash-less form", () => {
	assert.equal(deckPath("inquisitives"), "/inquisitives/");
	assert.equal(
		cardPath("inquisitives", "3f9a1c2b7e"),
		"/inquisitives/3f9a1c2b7e/",
	);
});

test("truncateAtWord cuts on a word boundary and marks the cut", () => {
	assert.equal(truncateAtWord("short", 200), "short");
	const long = "one two three four five six seven eight nine ten";
	const out = truncateAtWord(long, 20);
	assert.ok(out.length <= 21, out);
	assert.ok(out.endsWith("…"));
	assert.equal(out, "one two three four…");
});

test("groupByTier keeps declared tier order and file order within a tier", () => {
	const deck: Deck = {
		deck: "d",
		name: "D",
		blurb: "b",
		kind: "question",
		play: { order: "free", cardsPerTier: null, howToPlay: [] },
		tiers: [
			{ level: 1, name: "One", description: "x" },
			{ level: 2, name: "Two", description: "y" },
		],
		cards: [
			{ ...base, id: "a000000000", tier: 2, text: "second tier first in file" },
			{ ...base, id: "b000000000", tier: 1, text: "first" },
			{ ...base, id: "c000000000", tier: 1, text: "second" },
		],
	};
	const groups = [...groupByTier(deck).entries()];
	assert.deepEqual(
		groups.map(([t]) => t.level),
		[1, 2],
	);
	assert.deepEqual(
		groups[0][1].map((c) => c.id),
		["b000000000", "c000000000"],
	);
	assert.deepEqual(
		groups[1][1].map((c) => c.id),
		["a000000000"],
	);
});
