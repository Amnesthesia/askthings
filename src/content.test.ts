import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDecks } from "./common.ts";

// Every committed deck must load: this is what stops a bad generated batch or
// a hand edit from reaching the build. loadDecks throws with the file and the
// list of problems.
test("every deck under content/ validates and ids are unique across decks", () => {
	const decks = loadDecks();
	assert.ok(decks.length >= 1, "at least one deck");
	// A deck synced from decks.yml may be empty until the pipeline runs; the
	// site skips it. At least one deck must have cards or there is no site.
	assert.ok(
		decks.some((d) => d.cards.length > 0),
		"at least one deck has cards",
	);
});
