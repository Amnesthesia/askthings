// Pure navigation state for game mode. No DOM, so it is testable under the
// scripts tsconfig like everything else in app/utils.
import type { Deck } from "../../src/shared.ts";

/** Card ids per tier level, in play order. */
export type Order = Map<number, string[]>;

export interface Position {
	tier: number;
	index: number;
}

export function buildOrder(deck: Deck): Order {
	const order: Order = new Map(deck.tiers.map((t) => [t.level, []]));
	for (const card of deck.cards) order.get(card.tier)?.push(card.id);
	return order;
}

/** Fisher–Yates, injectable rng so the test is deterministic. */
export function shuffle<T>(
	items: readonly T[],
	rng: () => number = Math.random,
): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export function shuffleOrder(
	order: Order,
	rng: () => number = Math.random,
): Order {
	return new Map([...order].map(([tier, ids]) => [tier, shuffle(ids, rng)]));
}

export function locate(order: Order, id: string): Position | null {
	for (const [tier, ids] of order) {
		const index = ids.indexOf(id);
		if (index !== -1) return { tier, index };
	}
	return null;
}

/** Wraps within a tier, so the deck feels endless in the horizontal axis. */
export function wrap(index: number, length: number): number {
	if (length === 0) return 0;
	return ((index % length) + length) % length;
}

/** Card id from a card page path, or null for any other path. */
export function idFromPath(pathname: string, deck: string): string | null {
	const m = pathname.match(new RegExp(`^/${deck}/([0-9a-f]{10})/?$`));
	return m ? m[1] : null;
}
