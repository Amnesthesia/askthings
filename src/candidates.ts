// On-disk state between stages: one JSONL of candidates per deck, plus one
// JSONL of rejections per deck. Both committed, so a run can stop anywhere
// and a bad yield can be diagnosed without re-running paid calls.

import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "./llm.ts";
import type { ProviderName } from "./providers/base.ts";
import {
	type Card,
	cardHeadline,
	type DeckKind,
	type Intensity,
	type Scores,
} from "./shared.ts";

export type Status =
	| "new"
	| "unique"
	| "rated"
	| "safe"
	| "published"
	| "rejected";

export type CardFields =
	| { text: string }
	| { a: string; b: string }
	| {
			title: string;
			setup: string;
			dilemma: string;
			probes: string[];
			origin: string | null;
	  };

export interface Candidate {
	/** Candidate id: sha256(deck|provider|headline), 10 hex. Not the card id. */
	cid: string;
	deck: string;
	/** Tier the card was asked for. */
	tier: number;
	provider: ProviderName;
	model: string;
	prompt: string;
	at: string;
	/** The generation call this came from; ordered decks are kept or dropped per batch. */
	batch: string;
	/** Position within the batch, 0-based. Play order for ordered decks. */
	position: number;
	fields: CardFields;
	/** Writer's self-rating. */
	intensity: Intensity;
	tags: string[];
	status: Status;
	/** From `rate`. */
	scores?: Scores;
	judgedIntensity?: Intensity;
	reason?: string;
}

export interface Rejection {
	cid: string;
	deck: string;
	stage: string;
	provider: ProviderName;
	headline: string;
	reason: string;
	at: string;
}

const candidatesDir = () => join(DATA_ROOT, "candidates");
const rejectedDir = () => join(DATA_ROOT, "rejected");

export function candidateId(
	deck: string,
	provider: string,
	headline: string,
): string {
	return createHash("sha256")
		.update(`${deck}|${provider}|${headline}`)
		.digest("hex")
		.slice(0, 10);
}

export function headlineOfFields(kind: DeckKind, fields: CardFields): string {
	return cardHeadline(kind, fields as unknown as Card);
}

export function readCandidates(deck: string): Candidate[] {
	const file = join(candidatesDir(), `${deck}.jsonl`);
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf-8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Candidate);
}

/** Rewrites the whole file: stages mutate status in place, and the files are
 * small (hundreds of lines). */
export function writeCandidates(deck: string, list: Candidate[]): void {
	mkdirSync(candidatesDir(), { recursive: true });
	writeFileSync(
		join(candidatesDir(), `${deck}.jsonl`),
		list.map((c) => JSON.stringify(c)).join("\n") + (list.length ? "\n" : ""),
	);
}

/** Appends, skipping candidates whose cid is already present. Returns how many landed. */
export function appendCandidates(deck: string, fresh: Candidate[]): number {
	const have = new Set(readCandidates(deck).map((c) => c.cid));
	const add = fresh.filter((c) => !have.has(c.cid));
	mkdirSync(candidatesDir(), { recursive: true });
	if (add.length)
		appendFileSync(
			join(candidatesDir(), `${deck}.jsonl`),
			`${add.map((c) => JSON.stringify(c)).join("\n")}\n`,
		);
	return add.length;
}

export function reject(
	c: Candidate,
	kind: DeckKind,
	stage: string,
	reason: string,
): void {
	c.status = "rejected";
	c.reason = reason;
	mkdirSync(rejectedDir(), { recursive: true });
	const r: Rejection = {
		cid: c.cid,
		deck: c.deck,
		stage,
		provider: c.provider,
		headline: headlineOfFields(kind, c.fields),
		reason,
		at: new Date().toISOString(),
	};
	appendFileSync(
		join(rejectedDir(), `${c.deck}.jsonl`),
		`${JSON.stringify(r)}\n`,
	);
}

/** "generated -> kept" style line with the reasons for the gap. */
export function ratio(
	label: string,
	before: number,
	after: number,
	reasons: Map<string, number>,
): string {
	const why = [...reasons]
		.sort((a, b) => b[1] - a[1])
		.map(([r, n]) => `${n} ${r}`);
	return `  ${label}: ${before} -> ${after}${why.length ? ` (${why.join(", ")})` : ""}`;
}

export function count(map: Map<string, number>, key: string): void {
	map.set(key, (map.get(key) ?? 0) + 1);
}

/** Text a judge sees for one candidate: the headline, plus the body for dilemmas. */
export function judgeText(kind: DeckKind, fields: CardFields): string {
	if (kind === "dilemma" && "setup" in fields)
		return `${fields.title}\n${fields.setup}\n${fields.dilemma}\nProbes: ${fields.probes.join(" | ")}`;
	if (kind === "pair" && "a" in fields)
		return `Would you rather ${fields.a} — or — ${fields.b}?`;
	return headlineOfFields(kind, fields);
}
