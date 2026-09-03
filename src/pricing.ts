// $ per 1M tokens, from each provider's pricing page, verified 2026-09-03.
// The wrapper uses this to enforce the dollar budget, so an unknown model is
// priced at the most expensive row — fail safe, never silent.

export interface Price {
	input: number;
	output: number;
	/** Cached / cache-read input. */
	cached: number;
}

export const PRICES: Record<string, Price> = {
	"claude-opus-5": { input: 5, output: 25, cached: 0.5 },
	"claude-sonnet-5": { input: 2, output: 10, cached: 0.2 },
	"claude-haiku-4-5": { input: 1, output: 5, cached: 0.1 },
	"gemini-3.1-pro-preview": { input: 2, output: 12, cached: 0.2 },
	"gemini-3.8-flash": { input: 0.75, output: 3.75, cached: 0.075 },
	"gemini-3.5-flash": { input: 1.5, output: 9, cached: 0.15 },
	"gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cached: 0.025 },
	"gpt-5.6-sol": { input: 4, output: 20, cached: 0.4 },
	"gpt-5.6-terra": { input: 2, output: 12, cached: 0.2 },
	"gpt-5.6-luna": { input: 0.2, output: 1.2, cached: 0.02 },
};

const MOST_EXPENSIVE = Object.values(PRICES).reduce((a, b) =>
	b.output > a.output ? b : a,
);
const warned = new Set<string>();

export function priceFor(model: string): Price {
	const p = PRICES[model];
	if (p) return p;
	if (!warned.has(model)) {
		warned.add(model);
		console.warn(
			`  ⚠ no price for model "${model}" — budgeting it at the most expensive known rate`,
		);
	}
	return MOST_EXPENSIVE;
}

export interface TokenUsage {
	input: number;
	output: number;
	cached: number;
}

/** Dollars for one call. `input` is the uncached part. */
export function costUsd(model: string, u: TokenUsage): number {
	const p = priceFor(model);
	return (
		(u.input * p.input + u.output * p.output + u.cached * p.cached) / 1_000_000
	);
}
