// The ONE door for every model call. Concurrency limiter shared by every
// provider, 429-aware backoff honouring Retry-After, hard per-run budgets in
// calls and dollars (per provider and total), per-stage accounting printed at
// exit — including Ctrl-C — and a content-hash cache so a crashed run never
// pays twice for the same call.
//
// Per-module caps bound nothing, because caps that cannot see each other add
// up; the limit that bites is spend per minute, so one limiter here.
//
// Two modes (LLM_MODE): "batch" (default) sends every uncached request of a
// stage to the provider's async batch or flex tier at half price and waits;
// "live" makes synchronous calls at list price, for smoke tests.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./common.ts";
import { costUsd, type TokenUsage } from "./pricing.ts";
import {
	isTransient,
	type JsonRequest,
	type JsonResponse,
	LLM_MODE,
	type Provider,
	type ProviderName,
	providerOfModel,
	retryAfterMs,
	sleep,
} from "./providers/base.ts";
import { providerFor } from "./providers/index.ts";

export const DATA_ROOT =
	process.env.ASKTHINGS_DATA_ROOT ?? join(PROJECT_ROOT, "data");
const CACHE_DIR = join(DATA_ROOT, "_cache");

const CONCURRENCY = Number(process.env.LLM_CONCURRENCY ?? 4);
// A count backstop behind the dollar caps. Dedupe alone makes ~100 judge calls
// per deck per run (NEAREST pairs per candidate, 30 pairs per call), so 300
// stopped a normal run half way; the dollar caps are the real guard.
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 1000);
// Raised from 12 / 5 on 2026-09-04 when the default run became two generate
// passes (oversupply by more calls, never longer ones): one pass over six
// decks measured $4.89.
const MAX_USD = Number(process.env.MAX_USD ?? 25);
/** No provider may spend more than this in one run. Enforced, not estimated. */
const MAX_USD_PER_PROVIDER = Number(process.env.MAX_USD_PER_PROVIDER ?? 10);
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 5_000;

export class BudgetExhaustedError extends Error {
	constructor(what: string) {
		super(
			`${what}. Progress is saved — rerun the same command to continue, or raise the limit.`,
		);
		this.name = "BudgetExhaustedError";
	}
}

interface StageUsage extends TokenUsage {
	calls: number;
	cacheHits: number;
	usd: number;
	retries: number;
	failures: number;
}
const empty = (): StageUsage => ({
	calls: 0,
	input: 0,
	output: 0,
	cached: 0,
	cacheHits: 0,
	usd: 0,
	retries: 0,
	failures: 0,
});
const byStage = new Map<string, StageUsage>();
const byProvider = new Map<string, StageUsage>();
let totalCalls = 0;
let totalUsd = 0;

function record(
	stage: string,
	provider: ProviderName,
	patch: Partial<StageUsage>,
) {
	for (const [map, key] of [
		[byStage, stage],
		[byProvider, provider],
	] as const) {
		const cur = map.get(key) ?? empty();
		for (const [k, v] of Object.entries(patch))
			cur[k as keyof StageUsage] += v as number;
		map.set(key, cur);
	}
}

// Limiter: a module-level semaphore, one for the whole process.
let inFlight = 0;
const waiters: (() => void)[] = [];
function acquire(): Promise<void> {
	if (inFlight < CONCURRENCY) {
		inFlight++;
		return Promise.resolve();
	}
	return new Promise((r) => waiters.push(r));
}
function release() {
	const next = waiters.shift();
	if (next) next();
	else inFlight--;
}

/** N runners over a shared cursor: batches run concurrently, with a ceiling. */
export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	await Promise.all(
		Array.from(
			{ length: Math.max(1, Math.min(limit, items.length)) },
			async () => {
				while (true) {
					const i = next++;
					if (i >= items.length) return;
					results[i] = await worker(items[i], i);
				}
			},
		),
	);
	return results;
}

function cacheKey(
	provider: ProviderName,
	promptVersion: string,
	req: JsonRequest,
): string {
	return createHash("sha256")
		.update(
			[
				provider,
				req.model,
				promptVersion,
				req.system,
				req.user,
				JSON.stringify(req.schema),
			].join("\n"),
		)
		.digest("hex");
}

export interface CallOptions {
	/** Groups the accounting, e.g. "generate/inquisitives". */
	stage: string;
	/** Bump when a prompt changes; part of the cache key. */
	promptVersion: string;
	provider?: ProviderName;
	/** Called as each request settles (live path and batch path), so callers
	 * can flush incrementally instead of waiting for the whole set. */
	onResult?: (index: number, result: CallResult | Error) => void;
}

export interface CallResult {
	json: unknown;
	provider: ProviderName;
	model: string;
	fromCache: boolean;
}

/** Strips code fences a model may wrap JSON in, then parses. */
export function parseJson(text: string): unknown {
	const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	return JSON.parse(stripped);
}

function checkBudget(provider: ProviderName) {
	if (totalCalls >= MAX_CALLS)
		throw new BudgetExhaustedError(
			`call budget exhausted (MAX_CALLS=${MAX_CALLS})`,
		);
	if (totalUsd >= MAX_USD)
		throw new BudgetExhaustedError(
			`run budget exhausted ($${totalUsd.toFixed(2)} >= MAX_USD=${MAX_USD})`,
		);
	const spent = byProvider.get(provider)?.usd ?? 0;
	if (spent >= MAX_USD_PER_PROVIDER)
		throw new BudgetExhaustedError(
			`${provider} budget exhausted ($${spent.toFixed(2)} >= MAX_USD_PER_PROVIDER=${MAX_USD_PER_PROVIDER})`,
		);
}

/** Books one finished response and returns its parsed JSON, or "" for empty. */
function settle(
	stage: string,
	provider: ProviderName,
	model: string,
	res: JsonResponse,
): unknown | "" {
	const usd = costUsd(model, res.usage) * res.priceFactor;
	totalUsd += usd;
	record(stage, provider, { calls: 1, ...res.usage, usd });
	const text = res.text.trim();
	return text ? parseJson(text) : "";
}

function readCache(file: string): unknown | undefined {
	return existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : undefined;
}
function writeCache(file: string, json: unknown) {
	mkdirSync(CACHE_DIR, { recursive: true });
	writeFileSync(file, JSON.stringify(json), "utf-8");
}

/**
 * One synchronous structured call under the limiter, with retries. Returns
 * parsed JSON, or throws. An empty response is a failure, not an answer: it is
 * retried once and then thrown, never cached. Returns null when the provider
 * is disabled or has no key — the caller degrades to its deterministic path.
 */
export async function callJson(
	req: JsonRequest,
	opts: CallOptions,
): Promise<CallResult | null> {
	const providerName = opts.provider ?? providerOfModel(req.model);
	const provider = providerFor(providerName);
	if (!provider) return null;
	const cacheFile = join(
		CACHE_DIR,
		`${cacheKey(providerName, opts.promptVersion, req)}.json`,
	);
	const cached = readCache(cacheFile);
	if (cached !== undefined) {
		record(opts.stage, providerName, { cacheHits: 1 });
		return {
			json: cached,
			provider: providerName,
			model: req.model,
			fromCache: true,
		};
	}
	const json = await liveCall(provider, req, opts, cacheFile);
	return { json, provider: providerName, model: req.model, fromCache: false };
}

async function liveCall(
	provider: Provider,
	req: JsonRequest,
	opts: CallOptions,
	cacheFile: string,
): Promise<unknown> {
	checkBudget(provider.name);
	await acquire();
	try {
		let lastErr: unknown = new Error("no attempts made");
		let emptyRetried = false;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			checkBudget(provider.name);
			totalCalls++;
			try {
				const json = settle(
					opts.stage,
					provider.name,
					req.model,
					await provider.generateJson(req),
				);
				if (json === "") {
					if (!emptyRetried) {
						emptyRetried = true;
						record(opts.stage, provider.name, { retries: 1 });
						console.warn(
							`  [${opts.stage}] ${provider.name} returned nothing - retrying once`,
						);
						continue;
					}
					throw new Error(`${provider.name} returned an empty response twice`);
				}
				writeCache(cacheFile, json);
				return json;
			} catch (err) {
				lastErr = err;
				if (err instanceof BudgetExhaustedError) throw err;
				if (!isTransient(err) || attempt === MAX_RETRIES) break;
				const base = BASE_BACKOFF_MS * 2 ** attempt;
				const delay =
					retryAfterMs(err) ?? base + Math.floor(Math.random() * base * 0.3);
				record(opts.stage, provider.name, { retries: 1 });
				console.warn(
					`  [${opts.stage}] ${provider.name} rate limited - waiting ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
				);
				await sleep(delay);
			}
		}
		record(opts.stage, provider.name, { failures: 1 });
		throw lastErr;
	} finally {
		release();
	}
}

/**
 * Many requests to ONE provider. Cache first; then, in batch mode, every
 * uncached request goes out as one async batch at half price (Anthropic and
 * Gemini batch APIs; OpenAI's flex tier is per request, so it runs through
 * the live path with the flex flag). Otherwise concurrent live calls. Each
 * slot is a result, an Error for that request, or null when the provider is
 * unavailable (then every slot is null).
 */
export async function callJsonMany(
	reqs: JsonRequest[],
	opts: CallOptions,
): Promise<(CallResult | Error | null)[]> {
	if (!reqs.length) return [];
	const providerName = opts.provider ?? providerOfModel(reqs[0].model);
	const provider = providerFor(providerName);
	if (!provider) return reqs.map(() => null);

	const out: (CallResult | Error | null)[] = new Array(reqs.length).fill(null);
	const files = reqs.map((r) =>
		join(CACHE_DIR, `${cacheKey(providerName, opts.promptVersion, r)}.json`),
	);
	const pending: number[] = [];
	reqs.forEach((r, i) => {
		const cached = readCache(files[i]);
		if (cached !== undefined) {
			record(opts.stage, providerName, { cacheHits: 1 });
			out[i] = {
				json: cached,
				provider: providerName,
				model: r.model,
				fromCache: true,
			};
		} else pending.push(i);
	});
	if (!pending.length) return out;

	const live = async (i: number) => {
		try {
			out[i] = {
				json: await liveCall(provider, reqs[i], opts, files[i]),
				provider: providerName,
				model: reqs[i].model,
				fromCache: false,
			};
		} catch (err) {
			if (err instanceof BudgetExhaustedError) throw err;
			out[i] = err instanceof Error ? err : new Error(String(err));
		}
		const r = out[i];
		if (r) opts.onResult?.(i, r);
	};

	if (LLM_MODE === "batch" && provider.batchJson) {
		checkBudget(providerName);
		console.log(
			`  [${opts.stage}] ${providerName}: submitting batch of ${pending.length} (polling until it ends)`,
		);
		totalCalls += pending.length;
		const results = await provider.batchJson(pending.map((i) => reqs[i]));
		const retry: number[] = [];
		results.forEach((res, k) => {
			const i = pending[k];
			if (res instanceof Error) {
				record(opts.stage, providerName, { failures: 1 });
				out[i] = res;
				opts.onResult?.(i, res);
				return;
			}
			const json = settle(opts.stage, providerName, reqs[i].model, res);
			if (json === "") retry.push(i);
			else {
				writeCache(files[i], json);
				out[i] = {
					json,
					provider: providerName,
					model: reqs[i].model,
					fromCache: false,
				};
				opts.onResult?.(i, out[i] as CallResult);
			}
		});
		// Empty results are failures: one live retry each, then recorded as such.
		if (retry.length) {
			console.warn(
				`  [${opts.stage}] ${providerName}: ${retry.length} empty batch results - retrying live`,
			);
			await mapWithConcurrency(retry, CONCURRENCY, live);
		}
		return out;
	}

	await mapWithConcurrency(pending, CONCURRENCY, live);
	return out;
}

let reported = false;

/** What the run actually spent, per stage and per provider. Idempotent: the
 * exit hook and an explicit call must not print it twice. */
export function reportUsage(): void {
	if (reported || byStage.size === 0) return;
	reported = true;
	const fmt = (n: number) => n.toLocaleString("en");
	const row = (name: string, u: StageUsage) =>
		`  ${name.slice(0, 28).padEnd(28)} ${String(u.calls).padStart(5)} ${String(u.cacheHits).padStart(5)} ${fmt(u.input).padStart(9)} ${fmt(u.output).padStart(8)} ${fmt(u.cached).padStart(8)} ${`$${u.usd.toFixed(3)}`.padStart(8)}`;
	console.log(`\nModel usage (${LLM_MODE} mode)`);
	console.log(
		`  ${"stage".padEnd(28)} ${"calls".padStart(5)} ${"cache".padStart(5)} ${"in".padStart(9)} ${"out".padStart(8)} ${"cached".padStart(8)} ${"usd".padStart(8)}`,
	);
	for (const [stage, u] of [...byStage].sort((a, b) => b[1].usd - a[1].usd))
		console.log(row(stage, u));
	console.log("  by provider");
	const totals = empty();
	for (const [p, u] of byProvider) {
		console.log(row(`  ${p}`, u));
		for (const k of Object.keys(totals) as (keyof StageUsage)[])
			totals[k] += u[k];
	}
	console.log(row("TOTAL", totals));
	if (totals.retries || totals.failures)
		console.log(
			`  (${totals.retries} retries, ${totals.failures} calls failed outright)`,
		);
	try {
		const dir = join(DATA_ROOT, "runs");
		mkdirSync(dir, { recursive: true });
		const rec = {
			at: new Date().toISOString(),
			mode: LLM_MODE,
			argv: process.argv.slice(2),
			stages: Object.fromEntries(byStage),
			providers: Object.fromEntries(byProvider),
		};
		writeFileSync(
			join(dir, `${rec.at.replace(/[:.]/g, "-")}.json`),
			`${JSON.stringify(rec, null, 2)}\n`,
		);
	} catch (err) {
		console.warn(
			`  could not write run record: ${err instanceof Error ? err.message : err}`,
		);
	}
}

/** Print the summary however the process ends: that is when it matters most. */
export function installUsageReporting(): void {
	process.on("exit", reportUsage);
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => {
			reportUsage();
			process.exit(130);
		});
	}
}
