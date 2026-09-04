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
import { headlineOf, SUBJECTS } from "./common.ts";
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
	/** Cards asked for in this call. */
	n: number;
	/** Which of the level's parallel calls this is; the prompt says so, which
	 * also gives each call its own cache key. */
	call: number;
	calls: number;
}

/** Calls per provider per level per run; `generation.callsPerLevel` overrides. */
const CALLS_PER_LEVEL = 2;

/** Subject and shape steering per call (GEN_STEER=0 turns it off, for A/B
 * runs). The first corpus measured without it: identity 292, friendship 284,
 * faith 10, body 51; verdicts 551 to stories 341; future 109 of 961.
 * A/B on Inquisitives, 400 vs 411 cards, same judge (2026-09-04): steering
 * raised conversation 3.88 -> 4.01 (t 3.1), depth 2.84 -> 3.05 (t 2.8),
 * specificity 3.62 -> 3.76, lowered escapability 2.09 -> 2.00; faith 11 -> 27,
 * sex 6 -> 32, future 22 -> 97; revealed slipped 3.51 -> 3.40. Shape barely
 * moved (verdicts 36% -> 35%): the shape line does little, the subjects do. */
const STEER = process.env.GEN_STEER !== "0";
/** A rotating slice of the subject list, so a level's parallel calls cover it
 * between them: call 1 of 3 gets subjects 1-4, call 2 gets 5-8, and so on. */
function steerSubjects(call: number, calls: number): readonly string[] {
	const per = Math.ceil(SUBJECTS.length / Math.max(1, calls));
	const start = ((call - 1) * per) % SUBJECTS.length;
	return Array.from(
		{ length: per },
		(_, i) => SUBJECTS[(start + i) % SUBJECTS.length],
	);
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
		case "improv": {
			const word = str(item.word);
			const slot =
				item.slot === "mood" || item.slot === "role" ? item.slot : null;
			return word && slot ? { word, slot } : "word or slot missing";
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

function requestFor({
	spec,
	tier,
	provider,
	n,
	call,
	calls,
}: Task): JsonRequest {
	return {
		model: spec.generation.models?.[provider] ?? GEN_MODEL[provider],
		system: generateSystem(spec),
		user: generateUser(
			spec,
			tier,
			n,
			avoidList(spec, tier.level, readCandidates(spec.deck)),
			calls > 1 || STEER
				? { call, calls, subjects: STEER ? steerSubjects(call, calls) : [] }
				: undefined,
		),
		schema: generateSchema(spec.kind),
		// Gemini counts thinking tokens against maxOutputTokens; a Pro response
		// ran out of room mid-JSON at 8000, so it gets double headroom.
		maxOutputTokens:
			(spec.kind === "dilemma" ? 16000 : 8000) *
			(provider === "gemini" ? 2 : 1),
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
	const wholeRun = spec.generation.wholeRun === true;
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
			// The writer's claim; the rater confirms it and its value wins.
			assumesHistory: item.assumesHistory === true,
			status: "new",
		};
		if (intensity === null) {
			rejectNow(c, "writer gave no valid intensity");
			return;
		}
		// A writer that lands two levels off the brief did not read the brief.
		if (!wholeRun && Math.abs(intensity - tier.intensity) > 1) {
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
		if (spec.generation.wholeRun)
			return spec.tiers.flatMap((tier) =>
				providers.map((provider) => ({
					spec,
					tier,
					provider,
					n: spec.generation.publishPerRun,
					call: 1,
					calls: 1,
				})),
			);
		// Small calls, a fixed number of them per run: quality slides with response
		// length (over 5,030 rated cards, positions 20-24 of a 25-card answer scored
		// below positions 0-4 on every axis). There is no target to fill: every run
		// adds to the pool, rank orders it, publish takes the best of it.
		const n = perTier ?? spec.generation.candidatesPerTier;
		const calls = spec.generation.callsPerLevel ?? CALLS_PER_LEVEL;
		return spec.tiers.flatMap((tier) =>
			providers.flatMap((provider) =>
				Array.from({ length: calls }, (_, i) => ({
					spec,
					tier,
					provider,
					n,
					call: i + 1,
					calls,
				})),
			),
		);
	});
	console.log(
		`generate: ${tasks.length} requests (${decks.length} decks × providers ${providers.join(",")})`,
	);

	// One batch per (provider, model), all in parallel. Requests are built up
	// front so every avoid-list reflects the same starting state. Grouped by
	// model too because a Gemini batch must use one model, and decks may
	// override theirs in decks.yml.
	const groups = new Map<string, { provider: ProviderName; tasks: Task[] }>();
	for (const t of tasks) {
		const key = `${t.provider}:${t.spec.generation.models?.[t.provider] ?? GEN_MODEL[t.provider]}`;
		groups.set(key, {
			provider: t.provider,
			tasks: [...(groups.get(key)?.tasks ?? []), t],
		});
	}
	await Promise.all(
		[...groups.values()].map(async ({ provider, tasks: mine }) => {
			try {
				// Harvest as each response lands: a killed run keeps what it proved.
				const results = await callJsonMany(mine.map(requestFor), {
					stage: "generate",
					promptVersion: PROMPT_VERSION.generate,
					provider,
					onResult: (i, res) => {
						const t = mine[i];
						if (res instanceof Error)
							console.error(
								`  [${t.spec.deck} L${t.tier.level} ${provider}] failed: ${res.message}`,
							);
						else harvest(t, res);
					},
				});
				// Cache hits do not pass through onResult; harvest those here.
				results.forEach((res, i) => {
					const t = mine[i];
					if (res === null)
						console.warn(
							`  [${t.spec.deck} L${t.tier.level} ${provider}] provider unavailable`,
						);
					else if (!(res instanceof Error) && res.fromCache) harvest(t, res);
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
