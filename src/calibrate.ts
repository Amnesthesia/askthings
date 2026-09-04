// pnpm calibrate [read|measure] — Victor's taste as the yardstick for the judge.
//
//   pnpm calibrate          writes data/calibration/set.md (50 published cards,
//                           stratified by deck and by judge score) and set.json.
//                           Delete the lines you do not like; or prefix a line
//                           with "cut:" and a few words of reason.
//   pnpm calibrate read     diffs set.md against set.json -> verdicts.json.
//   pnpm calibrate measure  re-judges the 50 in a fresh roll and prints how far
//                           the gate agrees with the verdicts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CardFields, judgeText } from "./candidates.ts";
import { cardHeadline, type Deck, publishedDecks } from "./common.ts";
import { callJsonMany, DATA_ROOT, installUsageReporting } from "./llm.ts";
import { asScore, rateSchema, rateSystem, rateUser } from "./prompts.ts";
import { itemsByIndex, RATE_MODEL } from "./stage.ts";

const DIR = join(DATA_ROOT, "calibration");
const SET_MD = join(DIR, "set.md");
const SET_JSON = join(DIR, "set.json");
const VERDICTS = join(DIR, "verdicts.json");
const SIZE = 50;

interface Item {
	id: string;
	deck: string;
	kind: Deck["kind"];
	tier: number;
	headline: string;
	/** What the judge sees: headline, or the whole dilemma. */
	judge: string;
	voice: number | null;
	conversation: number | null;
}

interface Verdict extends Item {
	keep: boolean;
	reason?: string;
}

const GATE = { conversation: 3, voice: 4 };

/** Deterministic so a rerun rebuilds the same set. */
function rng(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

function buildSet(): Item[] {
	const rand = rng(2026_09_04);
	const decks = publishedDecks().filter((d) => d.kind !== "improv");
	const per = Math.ceil(SIZE / decks.length);
	const out: Item[] = [];
	for (const deck of decks) {
		const cards = deck.cards.filter((c) => c.gen);
		// Spread across the judge's scores so the set is not all 5s: sort by
		// voice+conversation and take evenly spaced picks.
		const sorted = [...cards].sort(
			(a, b) =>
				(a.scores.voice ?? 0) +
					(a.scores.conversation ?? 0) -
					((b.scores.voice ?? 0) + (b.scores.conversation ?? 0)) ||
				rand() - 0.5,
		);
		const n = Math.min(per, sorted.length);
		for (let i = 0; i < n; i++) {
			const c = sorted[Math.floor(((i + 0.5) / n) * sorted.length)];
			out.push({
				id: c.id,
				deck: deck.deck,
				kind: deck.kind,
				tier: c.tier,
				headline: cardHeadline(deck.kind, c),
				judge: judgeText(deck.kind, c as unknown as CardFields),
				voice: c.scores.voice,
				conversation: c.scores.conversation,
			});
		}
	}
	// Trim to SIZE, dropping evenly so every deck keeps roughly its share.
	while (out.length > SIZE) out.splice(Math.floor(rand() * out.length), 1);
	return out;
}

function writeSet() {
	const items = buildSet();
	mkdirSync(DIR, { recursive: true });
	writeFileSync(SET_JSON, `${JSON.stringify(items, null, 2)}\n`);
	const lines = [
		"# Calibration set",
		"",
		"Delete every card you would not want in the deck. Or, instead of deleting, prefix the",
		'line with `cut:` and a few words on why ("cut: sounds like a survey"). Leave the rest.',
		"Then run `pnpm calibrate read`.",
		"",
		...items.map(
			(i) =>
				`- ${i.id} ${i.deck} L${i.tier} — ${i.headline}${i.kind === "dilemma" ? ` (${i.judge.split("\n")[2] ?? ""})` : ""}`,
		),
		"",
	];
	writeFileSync(SET_MD, lines.join("\n"));
	console.log(`wrote ${items.length} cards to ${SET_MD}`);
}

function readSet(): Verdict[] {
	const items = JSON.parse(readFileSync(SET_JSON, "utf-8")) as Item[];
	const marked = readFileSync(SET_MD, "utf-8").split("\n");
	const verdicts: Verdict[] = items.map((item) => {
		const line = marked.find((l) => l.includes(` ${item.id} `));
		if (!line) return { ...item, keep: false, reason: "deleted" };
		const cut = /^\s*(?:-\s*)?cut:\s*(.*?)\s*$/i.exec(line);
		if (cut) {
			const reason = cut[1].split(` ${item.id} `)[0].trim();
			return { ...item, keep: false, reason: reason || undefined };
		}
		return { ...item, keep: true };
	});
	writeFileSync(VERDICTS, `${JSON.stringify(verdicts, null, 2)}\n`);
	const kept = verdicts.filter((v) => v.keep).length;
	console.log(
		`${kept} kept, ${verdicts.length - kept} cut, of ${verdicts.length} -> ${VERDICTS}`,
	);
	return verdicts;
}

async function measure() {
	if (!existsSync(VERDICTS)) {
		console.error("no verdicts yet: mark set.md, then `pnpm calibrate read`");
		process.exit(1);
	}
	installUsageReporting();
	const verdicts = JSON.parse(readFileSync(VERDICTS, "utf-8")) as Verdict[];
	// One deck kind per call keeps rateUser honest; question decks share one.
	const byKind = new Map<Deck["kind"], Verdict[]>();
	for (const v of verdicts)
		byKind.set(v.kind, [...(byKind.get(v.kind) ?? []), v]);
	const kinds = [...byKind.keys()];
	const tag = process.env.TAG ?? `calibrate@${Date.now().toString(36)}`;
	const results = await callJsonMany(
		kinds.map((kind) => ({
			model: RATE_MODEL,
			system: rateSystem,
			user: rateUser(
				kind,
				(byKind.get(kind) ?? []).map((v) => v.judge),
			),
			schema: rateSchema,
			maxOutputTokens: 8000,
			effort: "none" as const,
			temperature: 0,
		})),
		{ stage: "calibrate", promptVersion: tag },
	);
	const rows: { v: Verdict; voice: number; conversation: number }[] = [];
	kinds.forEach((kind, k) => {
		const res = results[k];
		if (!res || res instanceof Error) return;
		const byIdx = itemsByIndex(res.json, byKind.get(kind)?.length ?? 0);
		(byKind.get(kind) ?? []).forEach((v, i) => {
			const it = byIdx.get(i);
			const voice = asScore(it?.voice);
			const conversation = asScore(it?.conversation);
			if (voice && conversation) rows.push({ v, voice, conversation });
		});
	});
	const pass = (r: { voice: number; conversation: number }) =>
		r.voice >= GATE.voice && r.conversation >= GATE.conversation;
	const agree = rows.filter((r) => pass(r) === r.v.keep).length;
	const kept = rows.filter((r) => r.v.keep);
	const cut = rows.filter((r) => !r.v.keep);
	const mean = (xs: number[]) =>
		xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-";
	console.log(
		`judge ${RATE_MODEL} vs verdicts: agrees on ${agree}/${rows.length} (${Math.round((100 * agree) / rows.length)}%)`,
	);
	console.log(
		`  kept (${kept.length}): voice ${mean(kept.map((r) => r.voice))}, conversation ${mean(kept.map((r) => r.conversation))}, gate passes ${kept.filter(pass).length}`,
	);
	console.log(
		`  cut  (${cut.length}): voice ${mean(cut.map((r) => r.voice))}, conversation ${mean(cut.map((r) => r.conversation))}, gate passes ${cut.filter(pass).length}`,
	);
	for (const r of rows.filter((r) => pass(r) !== r.v.keep))
		console.log(
			`  disagree: ${r.v.keep ? "KEPT" : "CUT "} v${r.voice} c${r.conversation} ${r.v.headline}${r.v.reason ? ` -- ${r.v.reason}` : ""}`,
		);
}

const mode = process.argv[2] ?? "write";
if (mode === "write") writeSet();
else if (mode === "read") readSet();
else if (mode === "measure")
	measure().catch((err) => {
		console.error(err);
		process.exit(1);
	});
else {
	console.error(`unknown mode "${mode}" (write | read | measure)`);
	process.exit(1);
}
