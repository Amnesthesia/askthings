// Values shared between the Node pipeline and the browser bundle.
//
// This file must stay free of node: imports. src/common.ts — which the
// pipeline and the Astro build use — reads the filesystem, so importing it
// from app/ code drags node:fs into the Vite bundle and the build fails.
// Import this file with the ".ts" extension everywhere: two specifier forms
// for one module give Vite two module graphs and two copies of React.

export const SITE_URL = "https://askthings.lol";
export const SITE_NAME = "askthings.lol";

/**
 * The global exposure scale every deck's cards are placed on, for filtering
 * across decks. A deck's tiers are deck-local ordinals (a three-set deck has
 * levels 1–3); a card's `intensity` says where it sits on THIS scale.
 */
export const INTENSITIES = [1, 2, 3, 4] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const INTENSITY_NAMES: Record<Intensity, string> = {
	1: "Openers",
	2: "Unguarded",
	3: "Vulnerable",
	4: "Intimate",
};

export const DECK_KINDS = ["question", "pair", "dilemma"] as const;
export type DeckKind = (typeof DECK_KINDS)[number];

/** Slugs a deck may not use because a route already owns them. */
export const RESERVED_SLUGS = ["questions", "about", "404"] as const;

/** 1–5 each, null until `rate` has run. Always present so callers never
 * branch on the object being missing. */
export interface Scores {
	conversation: number | null;
	intellectual: number | null;
	emotional: number | null;
	depth: number | null;
	/** Sounds like a person asked it. The anti-slop score. */
	voice: number | null;
	/** "<provider>/<model>@<prompt-version>" that produced the scores. */
	rated: string | null;
}

export const SCORE_KEYS = [
	"conversation",
	"intellectual",
	"emotional",
	"depth",
	"voice",
] as const satisfies readonly (keyof Scores)[];

export interface Provenance {
	provider: string;
	model: string;
	/** Prompt version tag, e.g. "inquisitives-t2@3". */
	prompt: string;
	/** ISO timestamp. */
	at: string;
}

interface CardBase {
	/** 10 hex chars, assigned once when the card enters content/, never
	 * recomputed — see cardId in common.ts. */
	id: string;
	/** Must match a declared tiers[].level of its deck. */
	tier: number;
	intensity: Intensity;
	tags: string[];
	/** "Philippa Foot, 1967" for a canonical item; null means original. */
	origin: string | null;
	/** null means hand-authored. */
	gen: Provenance | null;
	scores: Scores;
}

export interface QuestionCard extends CardBase {
	text: string;
}

export interface PairCard extends CardBase {
	a: string;
	b: string;
}

export interface DilemmaCard extends CardBase {
	title: string;
	setup: string;
	dilemma: string;
	/** 2–3 follow-ups that push on whichever answer was given. */
	probes: string[];
}

export type Card = QuestionCard | PairCard | DilemmaCard;

export interface Tier {
	level: number;
	/** Prompt-only: the site shows "Level n" and never the name. */
	name: string;
	description: string;
}

export const PLAY_ORDERS = ["sequential", "random", "free"] as const;
/**
 * sequential: play in file order, no shuffle (21 Questions).
 * random: shuffled every time the deck is opened.
 * free: file order, shuffle offered.
 */
export type PlayOrder = (typeof PLAY_ORDERS)[number];

/** How the game flows. Everything game mode needs to run a deck lives here;
 * authored in decks.yml and synced into the deck JSON by `pnpm sync`. */
export interface Play {
	order: PlayOrder;
	/** Deal at most this many cards per level per session; null = all of them. */
	cardsPerTier: number | null;
	/** Shown on the deck page and behind the game's help button. */
	howToPlay: string[];
}

interface DeckBase {
	/** Slug; equals the filename under content/ and the key in decks.yml. */
	deck: string;
	name: string;
	blurb: string;
	play: Play;
	tiers: Tier[];
}

export type Deck =
	| (DeckBase & { kind: "question"; cards: QuestionCard[] })
	| (DeckBase & { kind: "pair"; cards: PairCard[] })
	| (DeckBase & { kind: "dilemma"; cards: DilemmaCard[] });

export const EMPTY_SCORES: Scores = {
	conversation: null,
	intellectual: null,
	emotional: null,
	depth: null,
	voice: null,
	rated: null,
};

/** Lowercase, punctuation stripped, whitespace collapsed. The basis for the
 * identity hash and for dedupe's exact-match pass, so it must not change. */
export function normaliseText(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** The one line that names a card: the question, "A or B?", or the title. */
export function cardHeadline(kind: DeckKind, card: Card): string {
	switch (kind) {
		case "question":
			return (card as QuestionCard).text;
		case "pair": {
			const { a, b } = card as PairCard;
			return `${a} or ${b}?`;
		}
		case "dilemma":
			return (card as DilemmaCard).title;
	}
}

/** og:description for one card. A dilemma leads with its setup because the
 * title alone ("Trolley Problem") tells a recipient nothing. */
export function cardSummary(kind: DeckKind, card: Card): string {
	switch (kind) {
		case "question":
			return (card as QuestionCard).text;
		case "pair": {
			const { a, b } = card as PairCard;
			return `Would you rather ${a} — or — ${b}?`;
		}
		case "dilemma":
			return truncateAtWord((card as DilemmaCard).setup, 200);
	}
}

export function truncateAtWord(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const at = cut.lastIndexOf(" ");
	return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/**
 * Site-root-relative paths, always with the trailing slash: Astro writes
 * `<path>/index.html` and GitHub Pages 301s the slash-less form, so a
 * canonical, og:url or sitemap entry without the slash points at a redirect.
 */
export function deckPath(deck: string): string {
	return `/${deck}/`;
}

export function cardPath(deck: string, id: string): string {
	return `/${deck}/${id}/`;
}

/** Cards grouped by tier level, in declared tier order, file order within. */
export function groupByTier(deck: Deck): Map<Tier, Card[]> {
	const groups = new Map<Tier, Card[]>();
	for (const tier of deck.tiers) groups.set(tier, []);
	for (const card of deck.cards) {
		const tier = deck.tiers.find((t) => t.level === card.tier);
		if (tier) groups.get(tier)?.push(card);
	}
	return groups;
}
