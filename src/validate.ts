// pnpm validate — validates every deck under content/, assigns ids to cards
// that lack one (hand-authored cards are written without ids), and writes the
// files back. Exit 1 on any error so CI catches bad content.

import { readFileSync, writeFileSync } from "node:fs";
import {
	cardId,
	type Deck,
	deckFiles,
	EMPTY_SCORES,
	headlineOf,
	loadDecks,
	validateDeck,
} from "./common.ts";

let cards = 0;
let assigned = 0;
const problems: string[] = [];

for (const file of deckFiles()) {
	const deck = JSON.parse(readFileSync(file, "utf-8")) as Deck;
	for (const card of deck.cards) {
		cards++;
		// Hand-authored cards are written without the bookkeeping fields. Only
		// an ABSENT field is filled — an explicit null is a statement and stays.
		if (card.id === undefined) {
			card.id = cardId(deck.deck, headlineOf(deck, card));
			assigned++;
		}
		card.origin ??= null;
		card.gen ??= null;
		card.scores ??= { ...EMPTY_SCORES };
	}
	const errors = validateDeck(deck);
	if (errors.length) problems.push(`${file}:\n  ${errors.join("\n  ")}`);
	else writeFileSync(file, `${JSON.stringify(deck, null, 2)}\n`, "utf-8");
}

if (problems.length === 0) {
	// Cross-deck uniqueness lives in loadDecks; run it so the two agree.
	try {
		loadDecks();
	} catch (err) {
		problems.push(String(err instanceof Error ? err.message : err));
	}
}

console.log(
	`cards: ${cards}, ids assigned: ${assigned}, errors: ${problems.length}`,
);
for (const p of problems) console.error(p);
process.exit(problems.length ? 1 : 0);
