import Anthropic from "@anthropic-ai/sdk";
import {
	BATCH_POLL_MS,
	type JsonRequest,
	type JsonResponse,
	type Provider,
	sleep,
} from "./base.ts";

export class AnthropicProvider implements Provider {
	readonly name = "anthropic" as const;
	private client: Anthropic;

	constructor(apiKey: string) {
		// maxRetries 0: the wrapper owns retries so they are counted and budgeted.
		this.client = new Anthropic({ apiKey, maxRetries: 0 });
	}

	private params(req: JsonRequest): Anthropic.MessageCreateParamsNonStreaming {
		return {
			model: req.model,
			max_tokens: req.maxOutputTokens,
			// The system block is byte-identical across every call of a stage, so
			// it is the cache prefix; the user turn carries everything variable.
			// Caching works inside batches too (best effort).
			system: [
				{
					type: "text",
					text: req.system,
					cache_control: { type: "ephemeral" },
				},
			],
			messages: [{ role: "user", content: req.user }],
			output_config: {
				format: { type: "json_schema", schema: req.schema },
				// No sampling params: temperature is rejected on the 5-family, so
				// effort is the only knob. "none" maps to low — thinking cannot be
				// disabled on Opus 5 without side effects (tool calls leaking into
				// text), and low is cheap enough.
				effort: req.effort === "medium" ? "medium" : "low",
			},
		};
	}

	async generateJson(req: JsonRequest): Promise<JsonResponse> {
		return toResponse(await this.client.messages.create(this.params(req)), 1);
	}

	/** Message Batches API: half price, results within minutes to 24h. */
	async batchJson(reqs: JsonRequest[]): Promise<(JsonResponse | Error)[]> {
		const batch = await this.client.messages.batches.create({
			requests: reqs.map((r, i) => ({
				custom_id: `r${i}`,
				params: this.params(r),
			})),
		});
		let status = batch;
		while (status.processing_status !== "ended") {
			await sleep(BATCH_POLL_MS);
			status = await this.client.messages.batches.retrieve(batch.id);
		}
		const out: (JsonResponse | Error)[] = reqs.map(
			() => new Error("no result returned for this request"),
		);
		for await (const r of await this.client.messages.batches.results(
			batch.id,
		)) {
			const i = Number(r.custom_id.slice(1));
			out[i] =
				r.result.type === "succeeded"
					? toResponse(r.result.message, 0.5)
					: new Error(
							`batch item ${r.result.type}: ${JSON.stringify("error" in r.result ? r.result.error : "")}`,
						);
		}
		return out;
	}
}

function toResponse(r: Anthropic.Message, priceFactor: number): JsonResponse {
	const usage = {
		input: r.usage.input_tokens + (r.usage.cache_creation_input_tokens ?? 0),
		output: r.usage.output_tokens,
		cached: r.usage.cache_read_input_tokens ?? 0,
	};
	// A refusal is an HTTP 200 with no usable content: report it as empty so
	// the wrapper retries once and then records a failure.
	if (r.stop_reason === "refusal") return { text: "", usage, priceFactor };
	if (r.stop_reason === "max_tokens")
		console.warn("  anthropic hit max_tokens; batch may be clipped");
	const text = r.content
		.filter((b): b is Anthropic.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("");
	return { text, usage, priceFactor };
}
