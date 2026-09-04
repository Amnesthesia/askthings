import assert from "node:assert/strict";
import { test } from "node:test";
import { type Deck, EMPTY_SCORES } from "../../src/shared.ts";
import {
	buildOrder,
	dealOrder,
	idFromPath,
	locate,
	promote,
	sampleOrder,
	shuffle,
	shuffleOrder,
	wrap,
} from "./deckNav.ts";

const card = (id: string, tier: number) => ({
	id,
	tier,
	intensity: 1 as const,
	text: id,
	tags: [],
	origin: null,
	gen: null,
	scores: EMPTY_SCORES,
});
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
	cards: [card("a000000000", 1), card("b000000000", 2), card("c000000000", 1)],
};

test("buildOrder groups by tier in file order and keeps empty tiers", () => {
	const order = buildOrder({
		...deck,
		tiers: [...deck.tiers, { level: 3, name: "Three", description: "z" }],
	});
	assert.deepEqual(order.get(1), ["a000000000", "c000000000"]);
	assert.deepEqual(order.get(2), ["b000000000"]);
	assert.deepEqual(order.get(3), []);
});

test("shuffle is a permutation and never mutates its input", () => {
	const input = [1, 2, 3, 4, 5];
	let n = 0;
	const rng = () => {
		n += 0.37;
		return n % 1;
	};
	const out = shuffle(input, rng);
	assert.deepEqual(input, [1, 2, 3, 4, 5]);
	assert.deepEqual([...out].sort(), input);
	// The same rng gives the same order: shuffles are reproducible in tests.
	n = 0;
	assert.deepEqual(shuffle(input, rng), out);
});

test("shuffleOrder keeps every id in its own tier", () => {
	const order = shuffleOrder(buildOrder(deck), () => 0.9);
	assert.deepEqual([...(order.get(1) ?? [])].sort(), [
		"a000000000",
		"c000000000",
	]);
	assert.deepEqual(order.get(2), ["b000000000"]);
});

test("dealOrder caps each tier and null means everything", () => {
	const order = buildOrder(deck);
	assert.deepEqual(dealOrder(order, 1).get(1), ["a000000000"]);
	assert.equal(dealOrder(order, null), order);
});

test("promote moves a card to the front of its own tier only", () => {
	const order = promote(buildOrder(deck), "c000000000");
	assert.deepEqual(order.get(1), ["c000000000", "a000000000"]);
	assert.deepEqual(order.get(2), ["b000000000"]);
});

test("locate finds a card's tier and index, null when absent", () => {
	const order = buildOrder(deck);
	assert.deepEqual(locate(order, "c000000000"), { tier: 1, index: 1 });
	assert.equal(locate(order, "zzzzzzzzzz"), null);
});

test("wrap goes round both ends and survives an empty tier", () => {
	assert.equal(wrap(3, 3), 0);
	assert.equal(wrap(-1, 3), 2);
	assert.equal(wrap(5, 0), 0);
});

test("idFromPath reads only this deck's card pages", () => {
	assert.equal(
		idFromPath("/inquisitives/0123456789/", "inquisitives"),
		"0123456789",
	);
	assert.equal(
		idFromPath("/inquisitives/0123456789", "inquisitives"),
		"0123456789",
	);
	assert.equal(idFromPath("/inquisitives/", "inquisitives"), null);
	assert.equal(idFromPath("/other/0123456789/", "inquisitives"), null);
});

test("sampleOrder deals a random subset in file order and always keeps one card", () => {
	const order = new Map([[1, ["a", "b", "c", "d", "e"]]]);
	let i = 0;
	const rng = () => [0.9, 0.1, 0.5, 0.3, 0.7][i++ % 5];
	const dealt = sampleOrder(order, 3, "e", rng).get(1) ?? [];
	assert.equal(dealt.length, 3);
	assert.ok(dealt.includes("e"));
	const pos = dealt.map((id) => "abcde".indexOf(id));
	assert.deepEqual(
		pos,
		[...pos].sort((x, y) => x - y),
	);
	assert.deepEqual(sampleOrder(order, 5).get(1), ["a", "b", "c", "d", "e"]);
	assert.deepEqual(sampleOrder(order, null).get(1), ["a", "b", "c", "d", "e"]);
});
