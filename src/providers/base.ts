import type { TokenUsage } from "../pricing.ts";

export type ProviderName = "anthropic" | "gemini" | "openai";

/**
 * live: synchronous calls, full price. batch: the provider's async batch (or
 * flex) tier at half price, minutes to hours of latency — the default, because
 * generation is on demand and nobody is waiting at a keyboard for it.
 */
export type LlmMode = "live" | "batch";
export const LLM_MODE: LlmMode =
	process.env.LLM_MODE === "live" ? "live" : "batch";
/** How often to ask a provider whether a batch has finished. */
export const BATCH_POLL_MS = Number(process.env.BATCH_POLL_MS ?? 20_000);

export interface JsonRequest {
	model: string;
	/** Stable text first: this is the cached prefix. */
	system: string;
	/** Variable payload. */
	user: string;
	/** JSON Schema for the response object (root must be an object). */
	schema: Record<string, unknown>;
	maxOutputTokens: number;
	/** Reasoning depth where the provider has a knob; "none" turns it off. */
	effort: "none" | "low" | "medium";
	temperature?: number;
}

export interface JsonResponse {
	/** Raw JSON text, or "" when the model returned nothing usable. */
	text: string;
	usage: TokenUsage;
	/** Multiplier on list price: 0.5 for batch / flex tiers. */
	priceFactor: number;
}

export interface Provider {
	readonly name: ProviderName;
	generateJson(req: JsonRequest): Promise<JsonResponse>;
	/** Async batch at half price; resolves when the whole batch has ended.
	 * Each slot is a response or the error for that one request. */
	batchJson?(reqs: JsonRequest[]): Promise<(JsonResponse | Error)[]>;
}

/** Which provider a model id belongs to, so a judge model picks its own client. */
export function providerOfModel(model: string): ProviderName {
	if (model.startsWith("claude-")) return "anthropic";
	if (model.startsWith("gemini-")) return "gemini";
	if (model.startsWith("gpt-") || model.startsWith("o")) return "openai";
	throw new Error(`cannot tell which provider serves model "${model}"`);
}

/**
 * Retry-After from an SDK error, in ms. Anthropic and OpenAI errors carry the
 * response headers; Gemini only has the message, so the regex is the fallback.
 */
export function retryAfterMs(err: unknown): number | null {
	const e = err as {
		headers?: Headers | Record<string, string>;
		message?: string;
	};
	const h = e?.headers;
	let raw: string | null | undefined;
	if (h instanceof Headers) raw = h.get("retry-after");
	else if (h && typeof h === "object")
		raw = h["retry-after"] ?? h["Retry-After"];
	if (raw && /^\d+$/.test(raw)) return Number(raw) * 1000;
	const m = /retry(?:-|\s)?after["':\s]+(\d+)/i.exec(e?.message ?? "");
	return m ? Number(m[1]) * 1000 : null;
}

export function isTransient(err: unknown): boolean {
	const e = err as { status?: number; message?: string };
	if (
		e?.status === 429 ||
		e?.status === 503 ||
		e?.status === 529 ||
		(e?.status ?? 0) >= 500
	)
		return true;
	return /\b429\b|\b503\b|\b529\b|rate limit|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand|resource unavailable|ECONNRESET|ETIMEDOUT/i.test(
		e?.message ?? "",
	);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
