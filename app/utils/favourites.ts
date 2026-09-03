// Favourites live in localStorage, per browser: the site has no accounts and
// no server. Each favourite stores the whole card plus where it came from, so
// the Favourites game can be built without fetching anything.

import type { Card, Deck, DeckKind } from "../../src/shared.ts";

export type FavouriteCard = Card & {
	kind: DeckKind;
	deck: string;
	deckName: string;
};

const KEY = "askthings:favourites";

export function loadFavourites(): FavouriteCard[] {
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(parsed)
			? (parsed as FavouriteCard[]).filter((c) => c && typeof c.id === "string")
			: [];
	} catch {
		return [];
	}
}

function save(list: FavouriteCard[]) {
	try {
		localStorage.setItem(KEY, JSON.stringify(list));
		window.dispatchEvent(new Event("favourites-changed"));
	} catch {
		// Private mode or storage blocked: the heart just does not stick.
	}
}

export function isFavourite(id: string): boolean {
	return loadFavourites().some((c) => c.id === id);
}

/** Adds or removes; returns the new state. */
export function toggleFavourite(deck: Deck, card: Card): boolean {
	const list = loadFavourites();
	const at = list.findIndex((c) => c.id === card.id);
	if (at !== -1) {
		list.splice(at, 1);
		save(list);
		return false;
	}
	list.push({ ...card, kind: deck.kind, deck: deck.deck, deckName: deck.name });
	save(list);
	return true;
}

/** A synthetic deck of every favourite, grouped into levels by exposure. */
export function favouritesDeck(list: FavouriteCard[]): Deck {
	return {
		deck: "favourites",
		name: "Favourites",
		blurb: "Every card you have starred, from every deck, grouped by level.",
		kind: "question",
		play: {
			order: "free",
			cardsPerTier: null,
			howToPlay: [
				"Star any card in any game to add it here.",
				"Levels follow each card's exposure level, 1 to 4.",
			],
		},
		tiers: [1, 2, 3, 4].map((level) => ({
			level,
			name: `Level ${level}`,
			description: "",
		})),
		cards: list.map((c) => ({ ...c, tier: c.intensity })),
	} as Deck;
}
