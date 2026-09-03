// pnpm generate [deck,...] — ask every enabled provider for candidates, one
// request per (deck, tier, provider), sent as one batch per provider.
// Candidates land in data/candidates/{deck}.jsonl; slop is rejected here,
// before anything is paid to judge it.

import {
	appendCandidates,
	type Candidate,
	type CardFields,
	candidateId,
	count,
	headlineOfFields,
	ratio,
	readCandidates,
	reject,
} from "./candidates.ts";
import { headlineOf } from "./common.ts";
import {
	type DeckSpec,
	deckSpec,
	loadDeckSpecs,
	readDeck,
	syncDecks,
	type TierSpec,
} from "./decks.ts";
import {
	BudgetExhaustedError,
	type CallResult,
	callJsonMany,
	installUsageReporting,
} from "./llm.ts";
import {
	asIntensity,
	generateSchema,
	generateSystem,
	generateUser,
	PROMPT_VERSION,
} from "./prompts.ts";
import type { JsonRequest, ProviderName } from "./providers/base.ts";
import { selectedProviderNames } from "./providers/index.ts";
import { deckArgs, GEN_MODEL, str, strList } from "./stage.ts";
import { slopReason } from "./text.ts";

interface Task {
	spec: DeckSpec;
	tier: TierSpec;
	provider: ProviderName;
	n: number;
}

/** Headlines a writer must not repeat: what is published plus what is pending. */
function avoidList(
	spec: DeckSpec,
	tier: number,
	candidates: Candidate[],
): string[] {
	const deck = readDeck(spec);
	const published = deck.cards
		.filter((c) => c.tier === tier)
		.map((c) => headlineOf(deck, c));
	const pending = candidates
		.filter((c) => c.tier === tier && c.status !== "rejected")
		.map((c) => headlineOfFields(spec.kind, c.fields));
	// Newest last, capped: the avoid-list is the variable suffix of the prompt.
	return [...published, ...pending].slice(-150);
}

function fieldsOf(
	kind: DeckSpec["kind"],
	item: Record<string, unknown>,
): CardFields | string {
	switch (kind) {
		case "question": {
			const text = str(item.text);
			return text ? { text } : "text missing";
		}
		case "pair": {
			const a = str(item.a);
			const b = str(item.b);
			return a && b ? { a, b } : "a or b missing";
		}
		case "dilemma": {
			const title = str(item.title);
			const setup = str(item.setup);
			const dilemma = str(item.dilemma);
			if (!title || !setup || !dilemma)
				return "title, setup or dilemma missing";
			return {
				title,
				setup,
				dilemma,
				probes: strList(item.probes),
				origin: str(item.origin),
			};
		}
	}
}

function requestFor({ spec, tier, provider, n }: Task): JsonRequest {
	return {
		model: GEN_MODEL[provider],
		system: generateSystem(spec),
		user: generateUser(
			spec,
			tier,
			n,
			avoidList(spec, tier.level, readCandidates(spec.deck)),
		),
		schema: generateSchema(spec.kind),
		maxOutputTokens: spec.kind === "dilemma" ? 16000 : 8000,
		effort: provider === "anthropic" ? "medium" : "low",
		...(provider === "gemini" ? { temperature: 1.0 } : {}),
	};
}

/** Turns one response into candidates; rejects slop and off-level cards. */
function harvest({ spec, tier, provider }: Task, res: CallResult) {
	const label = `${spec.deck} L${tier.level} ${provider}`;
	const items = (res.json as { items?: unknown[] })?.items;
	if (!Array.isArray(items) || items.length === 0) {
		console.error(`  [${label}] response had no items`);
		return;
	}
	const sequential = spec.play.order === "sequential";
	const batch = `${provider}:${res.model}:${Date.now().toString(36)}`;
	const reasons = new Map<string, number>();
	const fresh: Candidate[] = [];
	const rejectNow = (c: Candidate, why: string) => {
		count(reasons, why.split(":")[0]);
		reject(c, spec.kind, "generate", why);
	};
	items.forEach((raw, position) => {
		const item = (raw ?? {}) as Record<string, unknown>;
		const fields = fieldsOf(spec.kind, item);
		if (typeof fields === "string") {
			count(reasons, fields);
			return;
		}
		const intensity = asIntensity(item.intensity);
		const c: Candidate = {
			cid: candidateId(
				spec.deck,
				provider,
				headlineOfFields(spec.kind, fields),
			),
			deck: spec.deck,
			tier: tier.level,
			provider,
			model: res.model,
			prompt: PROMPT_VERSION.generate,
			at: new Date().toISOString(),
			batch,
			position,
			fields,
			intensity: intensity ?? tier.intensity,
			tags: strList(item.tags)
				.slice(0, 3)
				.map((t) => t.toLowerCase()),
			status: "new",
		};
		if (intensity === null) {
			rejectNow(c, "writer gave no valid intensity");
			return;
		}
		// A writer that lands two levels off the brief did not read the brief.
		if (!sequential && Math.abs(intensity - tier.intensity) > 1) {
			rejectNow(
				c,
				`intensity ${intensity} is ${Math.abs(intensity - tier.intensity)} off the level`,
			);
			return;
		}
		const slop = slopReason(spec.kind, fields);
		if (slop) {
			rejectNow(c, `slop: ${slop}`);
			return;
		}
		fresh.push(c);
	});
	const added = appendCandidates(spec.deck, fresh);
	if (fresh.length - added) count(reasons, "already a candidate");
	console.log(ratio(label, items.length, added, reasons));
}

async function main() {
	installUsageReporting();
	syncDecks();
	const decks = deckArgs(loadDeckSpecs().map((d) => d.deck));
	const providers = selectedProviderNames();
	if (!providers.length) {
		console.warn("no providers enabled — nothing to generate");
		return;
	}
	const perTier = process.env.PER_TIER ? Number(process.env.PER_TIER) : null;
	const tasks: Task[] = decks.flatMap((d) => {
		const spec = deckSpec(d);
		const sequential = spec.play.order === "sequential";
		const n = sequential
			? spec.generation.targetPerTier
			: (perTier ?? spec.generation.candidatesPerTier);
		return spec.tiers.flatMap((tier) =>
			providers.map((provider) => ({ spec, tier, provider, n })),
		);
	});
	console.log(
		`generate: ${tasks.length} requests (${decks.length} decks × providers ${providers.join(",")})`,
	);

	// One batch per provider, the three providers in parallel. Requests are
	// built up front so every avoid-list reflects the same starting state.
	await Promise.all(
		providers.map(async (provider) => {
			const mine = tasks.filter((t) => t.provider === provider);
			// Gemini batches need one model per batch; each provider uses one here.
			try {
				const results = await callJsonMany(mine.map(requestFor), {
					stage: "generate",
					promptVersion: PROMPT_VERSION.generate,
					provider,
				});
				results.forEach((res, i) => {
					const t = mine[i];
					if (res === null)
						console.warn(
							`  [${t.spec.deck} L${t.tier.level} ${provider}] provider unavailable`,
						);
					else if (res instanceof Error)
						console.error(
							`  [${t.spec.deck} L${t.tier.level} ${provider}] failed: ${res.message}`,
						);
					else harvest(t, res);
				});
			} catch (err) {
				if (err instanceof BudgetExhaustedError)
					console.warn(`  ${provider}: ${err.message}`);
				else throw err;
			}
		}),
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
