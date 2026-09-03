import {
	type GenerateContentConfig,
	type GenerateContentResponse,
	GoogleGenAI,
	JobState,
} from "@google/genai";
import {
	BATCH_POLL_MS,
	type JsonRequest,
	type JsonResponse,
	type Provider,
	sleep,
} from "./base.ts";

export class GeminiProvider implements Provider {
	readonly name = "gemini" as const;
	private ai: GoogleGenAI;

	constructor(apiKey: string) {
		this.ai = new GoogleGenAI({ apiKey });
	}

	private config(req: JsonRequest): GenerateContentConfig {
		return {
			systemInstruction: req.system,
			responseMimeType: "application/json",
			responseJsonSchema: req.schema,
			maxOutputTokens: req.maxOutputTokens,
			...(req.temperature !== undefined
				? { temperature: req.temperature }
				: {}),
			// Flash judges run with thinking off: a rubric needs no deliberation
			// and thoughts are billed as output. Pro models keep the default.
			...(req.effort === "none"
				? { thinkingConfig: { thinkingBudget: 0 } }
				: {}),
		};
	}

	async generateJson(req: JsonRequest): Promise<JsonResponse> {
		const response = await this.ai.models.generateContent({
			model: req.model,
			contents: req.user,
			config: this.config(req),
		});
		return toResponse(response, 1);
	}

	/** Batch API with inline requests: half price, results usually within the hour. */
	async batchJson(reqs: JsonRequest[]): Promise<(JsonResponse | Error)[]> {
		const models = new Set(reqs.map((r) => r.model));
		if (models.size !== 1)
			throw new Error(
				`one Gemini batch must use one model, got ${[...models].join(", ")}`,
			);
		const model = reqs[0].model;
		let job = await this.ai.batches.create({
			model,
			src: {
				inlinedRequests: reqs.map((r, i) => ({
					model,
					contents: r.user,
					config: this.config(r),
					metadata: { i: String(i) },
				})),
			},
			config: { displayName: `askthings-${Date.now()}` },
		});
		const done = new Set([
			JobState.JOB_STATE_SUCCEEDED,
			JobState.JOB_STATE_FAILED,
			JobState.JOB_STATE_CANCELLED,
			JobState.JOB_STATE_EXPIRED,
		]);
		while (!job.state || !done.has(job.state)) {
			await sleep(BATCH_POLL_MS);
			if (!job.name) throw new Error("Gemini batch job has no name");
			job = await this.ai.batches.get({ name: job.name });
		}
		if (job.state !== JobState.JOB_STATE_SUCCEEDED)
			throw new Error(`Gemini batch ${job.state}: ${job.error?.message ?? ""}`);
		const out: (JsonResponse | Error)[] = reqs.map(
			() => new Error("no result returned for this request"),
		);
		(job.dest?.inlinedResponses ?? []).forEach((r, pos) => {
			const i = Number(r.metadata?.i ?? pos);
			if (r.response) out[i] = toResponse(r.response, 0.5);
			else
				out[i] = new Error(
					`batch item failed: ${JSON.stringify(r.error ?? "")}`,
				);
		});
		return out;
	}
}

function toResponse(
	response: GenerateContentResponse,
	priceFactor: number,
): JsonResponse {
	const meta = response.usageMetadata;
	return {
		text: response.text ?? "",
		usage: {
			input:
				(meta?.promptTokenCount ?? 0) - (meta?.cachedContentTokenCount ?? 0),
			output:
				(meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
			cached: meta?.cachedContentTokenCount ?? 0,
		},
		priceFactor,
	};
}
