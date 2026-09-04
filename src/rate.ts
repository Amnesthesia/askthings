// pnpm rate [deck,...] — score every unique candidate on the rubric and judge
// its intensity fresh. The model proposes; code validates every number and
// keeps only conversation >= 3 && voice >= 3. An invalid or missing score is a
// rejection with a reason, never a default.

import {
	count,
	judgeText,
	ratio,
	readCandidates,
	reject,
	writeCandidates,
} from "./candidates.ts";
import { type DeckSpec, deckSpec, loadDeckSpecs } from "./decks.ts";
import { callJsonMany, installUsageReporting } from "./llm.ts";
import {
	asFacets,
	asIntensity,
	asScore,
	PROMPT_VERSION,
	rateSchema,
	rateSystem,
	rateUser,
} from "./prompts.ts";
import { SCORE_KEYS } from "./shared.ts";
import {
	batches,
	deckArgs,
	itemsByIndex,
	JUDGE_BATCH,
	RATE_MODEL,
	str,
} from "./stage.ts";

// voice 4: on a 30-card calibration set (15 generated-sounding, 15 spoken) the
// rate@2 rubric passed 1/15 of the generated at >= 4 and all 15 spoken; at
// >= 3 it passed 3/15 of the generated.
const KEEP = { conversation: 3, voice: 4 };

async function rateDeck(spec: DeckSpec) {
	const all = readCandidates(spec.deck);
	const todo = all.filter((c) => c.status === "unique");
	if (!todo.length) return;
	if (spec.generation.rate === false) {
		for (const c of todo) c.status = "rated";
		writeCandidates(spec.deck, all);
		console.log(
			`  rate ${spec.deck}: ${todo.length} -> ${todo.length} (rubric skipped for this deck)`,
		);
		return;
	}
	const reasons = new Map<string, number>();
	const groups = batches(todo, JUDGE_BATCH);
	const results = await callJsonMany(
		groups.map((batch) => ({
			model: RATE_MODEL,
			system: rateSystem,
			user: rateUser(
				spec.kind,
				batch.map((c) => judgeText(spec.kind, c.fields)),
				spec.generation.rateNote,
			),
			schema: rateSchema,
			maxOutputTokens: 8000,
			effort: "none" as const,
			temperature: 0,
		})),
		{ stage: `rate/${spec.deck}`, promptVersion: PROMPT_VERSION.rate },
	);
	if (results.some((r) => r === null)) {
		console.warn(
			`  [${spec.deck}] rating model unavailable — candidates stay unrated`,
		);
		return;
	}
	groups.forEach((batch, g) => {
		const res = results[g];
		if (res instanceof Error || res === null) {
			// The whole batch failed: leave these unique so the next run retries.
			count(
				reasons,
				`batch failed (${res instanceof Error ? res.message.slice(0, 40) : "no result"})`,
			);
			return;
		}
		const byIdx = itemsByIndex(res.json, batch.length);
		batch.forEach((c, i) => {
			const item = byIdx.get(i);
			if (!item) {
				reject(c, spec.kind, "rate", "judge returned no rating for this index");
				count(reasons, "no rating");
				return;
			}
			const scores = Object.fromEntries(
				SCORE_KEYS.map((k) => [k, asScore(item[k])]),
			) as Record<(typeof SCORE_KEYS)[number], number | null>;
			const intensity = asIntensity(item.intensity);
			if (Object.values(scores).some((v) => v === null) || intensity === null) {
				reject(c, spec.kind, "rate", "judge returned an out-of-range score");
				count(reasons, "invalid score");
				return;
			}
			c.scores = { ...scores, rated: `${RATE_MODEL}@${PROMPT_VERSION.rate}` };
			c.judgedIntensity = intensity;
			c.reason = str(item.reason) ?? undefined;
			// The judge's verdict replaces the writer's claim; a missing or
			// malformed value leaves the writer's claim standing.
			if (typeof item.assumesHistory === "boolean")
				c.assumesHistory = item.assumesHistory;
			c.facets = asFacets(item);
			if (
				(scores.conversation ?? 0) < KEEP.conversation ||
				(scores.voice ?? 0) < KEEP.voice
			) {
				reject(
					c,
					spec.kind,
					"rate",
					`conversation ${scores.conversation}, voice ${scores.voice}: ${c.reason ?? ""}`.trim(),
				);
				count(
					reasons,
					(scores.voice ?? 0) < KEEP.voice ? "weak voice" : "weak conversation",
				);
				return;
			}
			c.status = "rated";
		});
	});

	writeCandidates(spec.deck, all);
	console.log(
		ratio(
			`rate ${spec.deck}`,
			todo.length,
			todo.filter((c) => c.status === "rated").length,
			reasons,
		),
	);
}

async function main() {
	installUsageReporting();
	for (const d of deckArgs(loadDeckSpecs().map((s) => s.deck)))
		await rateDeck(deckSpec(d));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
