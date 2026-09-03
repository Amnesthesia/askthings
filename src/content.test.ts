import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDecks } from "./common.ts";

// Every committed deck must load: this is what stops a bad generated batch or
// a hand edit from reaching the build. loadDecks throws with the file and the
// list of problems.
test("every deck under content/ validates and ids are unique across decks", () => {
	const decks = loadDecks();
	assert.ok(decks.length >= 1, "at least one deck");
	for (const deck of decks) {
		assert.ok(deck.cards.length > 0, `${deck.deck} has cards`);
		for (const tier of deck.tiers)
			assert.ok(
				deck.cards.some((c) => c.tier === tier.level),
				`${deck.deck} tier ${tier.level} has cards`,
			);
	}
});
