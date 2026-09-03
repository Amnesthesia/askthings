// pnpm safety [deck,...] — the gate. Every rated candidate is checked; a card
// publishes only with a positive "ok". No judge means nothing passes: absence
// of failure is not evidence.

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
	PROMPT_VERSION,
	SAFETY_CATEGORIES,
	safetySchema,
	safetySystem,
	safetyUser,
} from "./prompts.ts";
import {
	batches,
	deckArgs,
	itemsByIndex,
	JUDGE_BATCH,
	SAFETY_MODEL,
	str,
} from "./stage.ts";

async function gateDeck(spec: DeckSpec) {
	const all = readCandidates(spec.deck);
	const todo = all.filter((c) => c.status === "rated");
	if (!todo.length) return;
	const reasons = new Map<string, number>();
	const groups = batches(todo, JUDGE_BATCH);
	const results = await callJsonMany(
		groups.map((batch) => ({
			model: SAFETY_MODEL,
			system: safetySystem,
			user: safetyUser(
				spec.kind,
				batch.map((c) => judgeText(spec.kind, c.fields)),
				spec.generation.safetyNote,
			),
			schema: safetySchema,
			maxOutputTokens: 6000,
			effort: "low" as const,
		})),
		{ stage: `safety/${spec.deck}`, promptVersion: PROMPT_VERSION.safety },
	);
	if (results.some((r) => r === null)) {
		console.warn(
			`  [${spec.deck}] safety model unavailable — nothing passes the gate`,
		);
		return;
	}
	groups.forEach((batch, g) => {
		const res = results[g];
		if (res instanceof Error || res === null) {
			// Whole batch failed: stays rated, retried next run. Nothing passes unjudged.
			count(
				reasons,
				`batch failed (${res instanceof Error ? res.message.slice(0, 40) : "no result"})`,
			);
			return;
		}
		const byIdx = itemsByIndex(res.json, batch.length);
		batch.forEach((c, i) => {
			const item = byIdx.get(i);
			const verdict = item?.verdict;
			const category = str(item?.category);
			if (verdict === "ok" && category === "none") {
				c.status = "safe";
				return;
			}
			// Anything short of a clean "ok" — including a missing or malformed
			// verdict — is a rejection. The gate errs closed.
			const cat =
				category && (SAFETY_CATEGORIES as readonly string[]).includes(category)
					? category
					: "unreadable verdict";
			reject(
				c,
				spec.kind,
				"safety",
				`${cat}: ${str(item?.reason) ?? "no reason given"}`,
			);
			count(reasons, cat);
		});
	});
	writeCandidates(spec.deck, all);
	console.log(
		ratio(
			`safety ${spec.deck}`,
			todo.length,
			todo.filter((c) => c.status === "safe").length,
			reasons,
		),
	);
}

async function main() {
	installUsageReporting();
	for (const d of deckArgs(loadDeckSpecs().map((s) => s.deck)))
		await gateDeck(deckSpec(d));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
