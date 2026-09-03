import OpenAI from "openai";
import {
	type JsonRequest,
	type JsonResponse,
	LLM_MODE,
	type Provider,
} from "./base.ts";

export class OpenAIProvider implements Provider {
	readonly name = "openai" as const;
	private client: OpenAI;

	constructor(apiKey: string) {
		// Flex requests can sit in a queue for minutes; the default 10-minute
		// timeout is fine but not generous, so give it 15.
		this.client = new OpenAI({
			apiKey,
			maxRetries: 0,
			timeout: 15 * 60 * 1000,
		});
	}

	/**
	 * In batch mode this uses the flex service tier: same request shape, half
	 * price, slower and occasionally 429 "resource unavailable" (which the
	 * wrapper retries). One parameter instead of the file-based Batch API.
	 */
	async generateJson(req: JsonRequest): Promise<JsonResponse> {
		const flex = LLM_MODE === "batch";
		const response = await this.client.responses.create({
			model: req.model,
			instructions: req.system,
			input: req.user,
			max_output_tokens: req.maxOutputTokens,
			text: {
				format: {
					type: "json_schema",
					name: "result",
					schema: req.schema,
					strict: true,
				},
			},
			reasoning: { effort: req.effort === "medium" ? "medium" : "low" },
			// One key per system prompt keeps prefix caching on the same servers.
			prompt_cache_key: `askthings-${hash(req.system)}`,
			...(flex ? { service_tier: "flex" as const } : {}),
		});
		const u = response.usage;
		const cached = u?.input_tokens_details?.cached_tokens ?? 0;
		return {
			text: response.output_text ?? "",
			usage: {
				input: (u?.input_tokens ?? 0) - cached,
				output: u?.output_tokens ?? 0,
				cached,
			},
			priceFactor: response.service_tier === "flex" ? 0.5 : 1,
		};
	}
}

function hash(s: string): string {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}
