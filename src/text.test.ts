import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AMBIGUOUS_FROM,
	DUPLICATE_AT,
	diceSimilarity,
	slopReason,
} from "./text.ts";

test("slop filter names the reason and passes plain questions", () => {
	assert.equal(
		slopReason("question", {
			text: "What did you believe for a long time that turned out to be wrong?",
		}),
		null,
	);
	assert.match(
		slopReason("question", {
			text: "What's one thing you wish people understood?",
		}) ?? "",
		/banned phrase/,
	);
	assert.match(
		slopReason("question", {
			text: "How do you navigate hard conversations?",
		}) ?? "",
		/banned/,
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
	// … two distinct fixture questions below the ambiguous band …
	const distinct = diceSimilarity(
		"What do you like to learn about?",
		"What have you been avoiding?",
	);
	assert.ok(distinct < AMBIGUOUS_FROM, `distinct ${distinct.toFixed(2)}`);
	// … and a same-topic different-angle pair sits in the band, for the judge.
	const angle = diceSimilarity(
		"What do you envy in other people?",
		"Who do you envy, and for what?",
	);
	assert.ok(angle < DUPLICATE_AT, `angle ${angle.toFixed(2)}`);
	assert.equal(diceSimilarity("Same words.", "same words"), 1);
});
