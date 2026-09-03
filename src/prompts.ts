// Every prompt in the pipeline. Stable text first (it is the cached prefix),
// variable payload last. Bump the matching PROMPT_VERSION when a prompt or
// its schema changes: the version is part of the cache key.

import type { DeckSpec, TierSpec } from "./decks.ts";
import type { DeckKind, Intensity } from "./shared.ts";
import { INTENSITY_NAMES } from "./shared.ts";

export const PROMPT_VERSION = {
	generate: "generate@2",
	dedupe: "dedupe@1",
	rate: "rate@1",
	safety: "safety@1",
} as const;

const SITE = `askthings.lol is a site of conversation games, conversation starters and thought experiments: things two or more people use to have a better conversation than they otherwise would. Cards are shown one at a time on a phone between two people. Every deck escalates through levels of exposure.`;

const STYLE = `WRITING STYLE — this matters more than anything else.
Cards sound like a curious person talking: the register of Terry Gross or Louis Theroux. Plain words. Specific. One question per card. Invite a story or an admission, not a fact or a list.
Never use: "delve", "journey", "unpack", "tapestry", "navigate", "resonate", "authentic", "worldview", "significantly", "pivotal", "hold space", "boundaries", "self-care", "vulnerability", "What's one thing…", "In what ways…". No stacked clauses. No therapy vocabulary. No two questions joined by "and". At most one em-dash per card, preferably none.
Pairs of a bad card and its good version:
BAD: "What is a belief you hold that has significantly shaped your worldview?" GOOD: "What did you believe for a long time that turned out to be wrong?"
BAD: "What's one thing you wish more people understood about you?" GOOD: "What do people get wrong about you?"
BAD: "How do you navigate difficult conversations with loved ones?" GOOD: "Who do you avoid arguing with, and why them?"
BAD: "What experiences have been most pivotal in your personal growth journey?" GOOD: "When did you last change your mind about something that mattered?"
BAD: "In what ways do you practise self-care?" GOOD: "What do you do when nobody's watching?"
BAD: "What does authenticity mean to you?" GOOD: "When are you most yourself?"
BAD: "What are your thoughts on the nature of happiness?" GOOD: "When were you last happy for no reason?"
BAD: "Describe a moment that resonated deeply with you." GOOD: "What's a small moment you keep coming back to?"`;

const INTENSITY = `LEVELS OF EXPOSURE (the global 1-4 scale; rate every card on it):
1 ${INTENSITY_NAMES[1]} — low stakes. Curiosity-sparking; a near-stranger answers comfortably and still reveals taste, perspective or a small story.
2 ${INTENSITY_NAMES[2]} — personal but unguarded. Opinions, preferences, formative experiences, how they see the world. Wants a real answer, not a fact.
3 ${INTENSITY_NAMES[3]} — vulnerable. Values, fears, regrets, identity, what they are working through. Needs rapport and mutual disclosure.
4 ${INTENSITY_NAMES[4]} — intimate. Mortality, meaning, the things rarely said out loud, how they feel about the person across from them.`;

const OUTPUT = `OUTPUT: return only JSON matching the schema. "index" runs from 0 upward in the order you write the cards. Rate each card's exposure level honestly on the 1-4 scale as "intensity". "tags" are 1-3 lowercase topic words.`;

function cardFields(kind: DeckKind): Record<string, unknown> {
	switch (kind) {
		case "question":
			return { text: { type: "string" } };
		case "pair":
			return { a: { type: "string" }, b: { type: "string" } };
		case "dilemma":
			return {
				title: { type: "string" },
				setup: { type: "string" },
				dilemma: { type: "string" },
				probes: { type: "array", items: { type: "string" } },
				origin: { type: ["string", "null"] },
			};
	}
}

// Plain integers only: Anthropic's structured outputs reject minimum/maximum
// on integers, and the ranges are validated in code regardless (asScore,
// asIntensity). The prompt text states the scale.
function itemsSchema(props: Record<string, unknown>): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			items: {
				type: "array",
				items: {
					type: "object",
					properties: props,
					required: Object.keys(props),
					additionalProperties: false,
				},
			},
		},
		required: ["items"],
		additionalProperties: false,
	};
}

export function generateSchema(kind: DeckKind): Record<string, unknown> {
	return itemsSchema({
		index: { type: "integer" },
		...cardFields(kind),
		intensity: { type: "integer" },
		tags: { type: "array", items: { type: "string" } },
	});
}

export function generateSystem(spec: DeckSpec): string {
	return [
		SITE,
		STYLE,
		INTENSITY,
		`THIS DECK — ${spec.name}\n${spec.generation.brief.trim()}`,
		OUTPUT,
	].join("\n\n");
}

export function generateUser(
	spec: DeckSpec,
	tier: TierSpec,
	n: number,
	avoid: string[],
): string {
	const lines = [
		`Deck: ${spec.name}. Level ${tier.level} of ${spec.tiers.length} ("${tier.name}": ${tier.description}).`,
		`Guidance for this level: ${tier.guidance}`,
		`Target exposure level: ${tier.intensity} (${INTENSITY_NAMES[tier.intensity]}).`,
		spec.generation.wholeRun
			? `Write the complete run of exactly ${n} cards, in play order.`
			: `Write ${n} cards for this level. Vary topic, form and length; no two cards on the same subject.`,
	];
	if (avoid.length) {
		lines.push(
			`The deck already has these; write nothing that asks the same thing in other words:\n${avoid.map((a) => `- ${a}`).join("\n")}`,
		);
	}
	return lines.join("\n\n");
}

// ── dedupe judge ────────────────────────────────────────────────────────────

export const dedupeSchema = itemsSchema({
	index: { type: "integer" },
	same: { type: "boolean" },
});

export const dedupeSystem = `${SITE}

You judge whether two conversation cards would produce the same conversation. "same" is true when a person who had answered A would have nothing new to say to B: the same question in other words, or a narrower/broader version of the same ask. Different angle on the same topic is NOT the same. Return JSON only; echo each pair's index.`;

export function dedupeUser(pairs: { a: string; b: string }[]): string {
	return pairs.map((p, i) => `[${i}]\nA: ${p.a}\nB: ${p.b}`).join("\n\n");
}

// ── rate ────────────────────────────────────────────────────────────────────

export const rateSchema = itemsSchema({
	index: { type: "integer" },
	conversation: { type: "integer" },
	intellectual: { type: "integer" },
	emotional: { type: "integer" },
	depth: { type: "integer" },
	voice: { type: "integer" },
	intensity: { type: "integer" },
	reason: { type: "string" },
});

export const rateSystem = `${SITE}

${STYLE}

${INTENSITY}

RUBRIC — score each card 1-5 on each axis. Be harsh; 3 is "fine", 5 is rare.
conversation: does it start a real exchange between two people, with follow-ups that suggest themselves? For dilemmas, judge the probes as much as the dilemma. 1 = a yes/no or a fact; 5 = they will still be talking about it later.
intellectual: how much thinking it asks for.
emotional: how much feeling it asks for.
depth: how far below the surface the honest answer goes.
voice: does it sound like a person asked it? 5 = you can hear someone say it; 1 = obviously generated (template phrasing, banned words, stacked clauses).
intensity: the card's exposure level on the 1-4 scale, judged fresh, ignoring what the writer claimed.
reason: one clause, the single most important thing about the card.
Return JSON only; echo each card's index.`;

export function rateUser(kind: DeckKind, items: string[]): string {
	return `Deck kind: ${kind}.\n\n${items.map((t, i) => `[${i}] ${t}`).join("\n\n")}`;
}

// ── safety gate ─────────────────────────────────────────────────────────────

export const SAFETY_CATEGORIES = [
	"none",
	"illegal_disclosure",
	"self_harm",
	"protected_characteristic",
	"sexual_minor",
	"other",
] as const;
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

export const safetySchema = itemsSchema({
	index: { type: "integer" },
	verdict: { type: "string", enum: ["ok", "reject"] },
	category: { type: "string", enum: [...SAFETY_CATEGORIES] },
	reason: { type: "string" },
});

export const safetySystem = `${SITE}

This deck format deliberately escalates intimacy, so this gate is a product requirement. REJECT a card when it:
- illegal_disclosure: pressures someone to disclose a crime or illegal act they committed (drugs beyond the trivial, theft, violence, fraud), or invites bragging about one;
- self_harm: solicits detail about self-harm, suicide, or disordered eating, or could act as a prompt for them;
- protected_characteristic: targets, ranks, mocks or asks someone to judge people by race, ethnicity, religion, disability, sexual orientation, gender identity or similar;
- sexual_minor: is sexual content that involves, or could be read as involving, anyone under 18 (childhood + sexual, school + sexual, "first time" framed young);
- other: something else a reasonable host would not put in front of two people who just met (degradation, coercion, humiliation as the point).
Everything else is "ok", including adult, consensual, spicy or uncomfortable content: discomfort is not a reason. Mark ok cards with category "none". Return JSON only; echo each card's index.`;

export function safetyUser(kind: DeckKind, items: string[]): string {
	return `Deck kind: ${kind}.\n\n${items.map((t, i) => `[${i}] ${t}`).join("\n\n")}`;
}

/** Intensity from a model, validated against the declared scale, else null. */
export function asIntensity(v: unknown): Intensity | null {
	return v === 1 || v === 2 || v === 3 || v === 4 ? v : null;
}

/** 1-5 integer from a model, else null. Never a default. */
export function asScore(v: unknown): number | null {
	return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5
		? (v as number)
		: null;
}
