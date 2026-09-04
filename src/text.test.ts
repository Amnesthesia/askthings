import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeText } from "./candidates.ts";
import {
	AMBIGUOUS_FROM,
	DUPLICATE_AT,
	diceSimilarity,
	slopReason,
} from "./text.ts";

test("slop filter checks shape only and names the reason", () => {
	assert.equal(
		slopReason("question", {
			text: "What did you believe for a long time that turned out to be wrong?",
		}),
		null,
	);
	// Wording is the judge's call, not a regex's.
	assert.equal(
		slopReason("question", {
			text: "What's one thing you wish people understood?",
		}),
		null,
	);
	assert.match(
		slopReason("question", {
			text: "Who — of everyone — would you call first — and why?",
		}) ?? "",
		/em-dash/,
	);
	assert.match(
		slopReason("question", {
			text: "When you think back across all of the many different experiences that have gone into making the person you have slowly become over all of these years, which single one stands out most?",
		}) ?? "",
		/words/,
	);
	assert.match(
		slopReason("question", { text: "What do you want" }) ?? "",
		/punctuation/,
	);
});

test("slop filter checks pair and dilemma shapes", () => {
	assert.equal(
		slopReason("pair", {
			a: "know how you will die",
			b: "know when you will die",
		}),
		null,
	);
	assert.match(
		slopReason("pair", { a: "would you rather fly", b: "swim" }) ?? "",
		/repeats/,
	);
	assert.match(
		slopReason("dilemma", {
			title: "T",
			setup: "S",
			dilemma: "Do it",
			probes: ["a", "b"],
		}) ?? "",
		/not a question/,
	);
	assert.match(
		slopReason("dilemma", {
			title: "T",
			setup: "S",
			dilemma: "Do it?",
			probes: ["a"],
		}) ?? "",
		/probes/,
	);
});

test("dice similarity separates rewordings from different questions", () => {
	// A reworded duplicate must land above the auto-reject line …
	const reworded = diceSimilarity(
		"What did you believe for a long time that turned out to be wrong?",
		"What did you believe for a long time that turned out to be untrue?",
	);
	assert.ok(reworded >= DUPLICATE_AT, `reworded ${reworded.toFixed(2)}`);
	// … and a same-topic different-angle pair stays below it, for the judge.
	const angle = diceSimilarity(
		"What do you envy in other people?",
		"Who do you envy, and for what?",
	);
	assert.ok(angle < DUPLICATE_AT, `angle ${angle.toFixed(2)}`);
	assert.equal(diceSimilarity("Same words.", "same words"), 1);
});

test("dedupe compares the dilemma, not its title, and drops a fixed opener", () => {
	assert.equal(
		dedupeText("dilemma", {
			title: "The Dent",
			setup: "You scrape a parked car.",
			dilemma: "Do you leave a note?",
			probes: [],
			origin: null,
		}),
		"Do you leave a note? You scrape a parked car.",
	);
	assert.equal(
		dedupeText("question", { text: "Never have I ever cried at an advert." }),
		"cried at an advert.",
	);
	// The published near-duplicates the old 0.60 floor let through must now
	// reach the judge.
	const missed = diceSimilarity(
		dedupeText("question", {
			text: "Never have I ever pretended my phone rang to get out of a conversation.",
		}),
		dedupeText("question", {
			text: "Never have I ever faked a phone call to escape a charity fundraiser on the street.",
		}),
	);
	assert.ok(missed >= AMBIGUOUS_FROM, `missed ${missed.toFixed(2)}`);
});
