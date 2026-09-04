// Every prompt in the pipeline. Stable text first (it is the cached prefix),
// variable payload last. Bump the matching PROMPT_VERSION when a prompt or
// its schema changes: the version is part of the cache key.

import type { DeckSpec, TierSpec } from "./decks.ts";
import type { DeckKind, Facets, Intensity } from "./shared.ts";
import {
	INTENSITY_NAMES,
	RELATIONS,
	SHAPES,
	SUBJECTS,
	TARGETS,
	TIMES,
} from "./shared.ts";

export const PROMPT_VERSION = {
	generate: "generate@5",
	dedupe: "dedupe@2",
	rate: "rate@5",
	safety: "safety@2",
	rank: "rank@1",
} as const;

const SITE = `askthings.lol is a site of conversation games, conversation starters and thought experiments: things two or more people use to have a better conversation than they otherwise would. Cards are shown one at a time on a phone between two people. Every deck escalates through levels of exposure.`;

const STYLE = `WRITING STYLE — this matters more than anything else.
A card is something a curious person says out loud, unprepared, across a table: the register of Anthony Bourdain or Studs Terkel. Blunt, unsentimental, interested in how people actually live: what they do all day, what they eat, who they drink with, what the job did to them, what they got away with. Plain words, the ones people use at a bar or a kitchen table. Short. One blade per card. Ask about the concrete thing, not the feeling about the thing; the feeling comes out in the answer. Invite a story or an admission, not a fact or a list. No reverence, no uplift, no lesson at the end. Say every card aloud before you keep it; if you would not say it that way to a friend, rewrite it.
TELLS that mark a card as generated. None may appear:
- filler intensifiers: quietly, secretly, genuinely, actually, truly, really, completely, deeply, specific, exact, precise, "at all"
- the trailing clause that explains the question: "…that you…", "…who … probably intended", "…without taking stock of…"
- abstract-noun speak: "a version of you", "a part of yourself", "a side of you", "your younger self", "your social circle", "mixed feelings", "feel understood", "feel at ease"
- template openers: "What is a X that…", "What kind of person…", "What's one thing…", "In what ways…", "Name the…", "Give the number…"
- game-manual syntax: "with the reason for last place", "no ties", "rank … by how …"
- thesaurus words: possesses, outstrips, sustained, primarily, consistently, delve, journey, unpack, tapestry, navigate, resonate, authentic, worldview, significantly, pivotal
- therapy vocabulary: hold space, boundaries, self-care, vulnerability, forgive yourself, hide from others, process
- two ideas stapled together with a comma or "and" where one would do; two questions in one card; em-dashes
Pairs of a generated card and its spoken version:
BAD: "What is a belief you hold that has significantly shaped your worldview?" GOOD: "What did you believe for a long time that turned out to be wrong?"
BAD: "What family trait do you recognize in yourself with mixed feelings?" GOOD: "Which of your parents' habits have you caught yourself doing?"
BAD: "Which relationship brings out a version of you that you dislike?" GOOD: "Who makes you worse?"
BAD: "When did you last feel completely understood by someone?" GOOD: "Who was the last person who got you without you having to explain?"
BAD: "Rank your three closest friends by how quickly they exhaust your patience, with the reason for last place." GOOD: "Which of your close friends wears you out fastest?"
BAD: "Which person's happiness have you quietly treated as evidence of your own failure?" GOOD: "Whose good news did you have to fake being pleased about?"
BAD: "How do you navigate difficult conversations with loved ones?" GOOD: "Who do you avoid arguing with, and why them?"
BAD: "What kind of person makes you feel instantly at ease?" GOOD: "Who can you be boring around?"
BAD: "What has your career taught you about resilience?" GOOD: "What did the job do to you?"
BAD: "What is a meaningful ritual you share with loved ones?" GOOD: "Who do you eat with, and what do you talk about?"`;

const INTENSITY = `LEVELS OF EXPOSURE (the global 1-4 scale; rate every card on it):
1 ${INTENSITY_NAMES[1]} — low stakes. Curiosity-sparking; a near-stranger answers comfortably and still reveals taste, perspective or a small story.
2 ${INTENSITY_NAMES[2]} — personal but unguarded. Opinions, preferences, formative experiences, how they see the world. Wants a real answer, not a fact.
3 ${INTENSITY_NAMES[3]} — vulnerable. Values, fears, regrets, identity, what they are working through. Needs rapport and mutual disclosure.
4 ${INTENSITY_NAMES[4]} — intimate. Mortality, meaning, the things rarely said out loud, how they feel about the person across from them.`;

/** Shared by the writer's brief, the rater and the backfill, so all three
 * draw the line in the same place. Not a pronoun test: "What do you like
 * about me?" is a first-evening question. */
export const ASSUMES_HISTORY = `"assumesHistory" is true only when the card presumes the two players already have a history together (a relationship, years, things done to each other): "What do you blame me for that you chose yourself?", "How much of your loyalty to me is not wanting to start over?". It is false when two people who met tonight could ask it, even if it says "me": anything about this moment, this evening or first impressions ("What do you like about me?", "What did you notice about me first?", "Guess what I was like at fifteen.").`;

const OUTPUT = `OUTPUT: return only JSON matching the schema. "index" runs from 0 upward in the order you write the cards. Rate each card's exposure level honestly on the 1-4 scale as "intensity". "tags" are 1-3 lowercase topic words. ${ASSUMES_HISTORY}`;

function cardFields(kind: DeckKind): Record<string, unknown> {
	switch (kind) {
		case "question":
			return { text: { type: "string" } };
		case "pair":
			return { a: { type: "string" }, b: { type: "string" } };
		case "improv":
			return {
				word: { type: "string" },
				slot: { type: "string", enum: ["mood", "role"] },
			};
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
		assumesHistory: { type: "boolean" },
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
	/** Which of several parallel calls for this level this one is. The line
	 * asks for spread and gives each call its own cache key. */
	batch?: {
		call: number;
		calls: number;
		/** Subjects this call is steered towards; a rotating slice so a level's
		 * calls between them cover the whole list. Empty = no steer. */
		subjects?: readonly string[];
	},
): string {
	const lines = [
		`Deck: ${spec.name}. Level ${tier.level} of ${spec.tiers.length} ("${tier.name}": ${tier.description}).`,
		`Guidance for this level: ${tier.guidance}`,
		`Target exposure level: ${tier.intensity} (${INTENSITY_NAMES[tier.intensity]}).`,
		spec.generation.wholeRun
			? `Write the complete run of exactly ${n} cards, in play order.`
			: `Write ${n} cards for this level. Vary topic, form and length; no two cards on the same subject.`,
	];
	if (batch)
		lines.push(
			`This is call ${batch.call} of ${batch.calls} for this level, written in parallel by writers who cannot see each other: pick subjects an obvious first draft would not.`,
		);
	if (batch?.subjects?.length)
		lines.push(
			`MIX. Most of this call's cards should sit in these subjects: ${batch.subjects.join(", ")} (the other calls cover the rest). Shape: at most a third of the cards may ask for a verdict or a ranking; at least a third must ask for a story (what happened, when, who). Send at least two into the future (what they will do, expect, dread) and at least two at the person alone rather than in relation to someone else.`,
		);
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

You judge whether two conversation cards would produce the same conversation. "same" is true when a person who had answered A would have nothing new to say to B: the same question in other words; the same act, scenario or choice with a detail added or removed ("faked a phone call to escape a fundraiser" and "pretended my phone rang to get out of a conversation" are the same); a narrower or broader version of one ask. A different angle on the same topic is NOT the same ("who do you envy" and "whose success did you fake being pleased about" are two cards). Return JSON only; echo each pair's index.`;

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
	escapability: { type: "integer" },
	specificity: { type: "integer" },
	exposureCost: { type: "integer" },
	revealed: { type: "integer" },
	intensity: { type: "integer" },
	assumesHistory: { type: "boolean" },
	target: { type: "string", enum: [...TARGETS] },
	time: { type: "string", enum: [...TIMES] },
	subjects: { type: "array", items: { type: "string", enum: [...SUBJECTS] } },
	relational: { type: "string", enum: [...RELATIONS] },
	shape: { type: "string", enum: [...SHAPES] },
	reason: { type: "string" },
});

export const rateSystem = `${SITE}

${STYLE}

${INTENSITY}

RUBRIC — you are the last line against generated-sounding cards. Score each card 1-5 on each axis and use the whole scale: across a batch of thirty, expect roughly a quarter at 1-2, half at 3, a quarter at 4-5.
conversation: does it start a real exchange between two people, with follow-ups that suggest themselves? For dilemmas, judge the probes as much as the dilemma. 1 = a yes/no or a fact; 5 = they will still be talking about it later.
intellectual: how much thinking it asks for.
emotional: how much feeling it asks for.
depth: how far below the surface the honest answer goes.
voice: could a person have said this out loud, unprepared, to someone across a table? Anchors:
  5 = you can hear it. Short, plain, one blade. "Which of your parents is the bigger coward?" "What did knowing me cost you?"
  4 = a person might say it; one small written-not-spoken tell.
  3 = a good idea in written prose. Two tells, or one heavy one.
  2 = template phrasing; the idea is fine but nobody talks like this.
  1 = obviously generated.
  Every TELL from the style guide above costs at least a point. A card with no tells that still reads like a caption under a stock photo is a 3, not a 4.
escapability: how easy a socially acceptable non-answer is. 1 = there is no polite way out, the question corners; 5 = anyone can deflect with a shrug or a platitude. LOW is what a good card has; this is the axis that catches questions that sound profound and produce nothing.
specificity: is there a concrete anchor (a named kind of person, a place, a time, a thing, a number) or an abstract category? 1 = pure abstraction ("What does friendship mean to you?"); 5 = one concrete referent ("Which friend do you lie to most?").
exposureCost: how much the honest answer reveals about the person, independent of depth. 1 = nothing a stranger would mind sharing; 5 = something most people have told nobody. This is the filter for stranger vs friend vs partner.
revealed: does the value come out of a choice or an action, or is the person asked to self-report it? 1 = self-report ("What do you value most?"); 5 = the value is forced out of behaviour ("What did you say yes to that you should have refused?"). Self-report is where the flattering, pre-chewed answers live.
intensity: the card's exposure level on the 1-4 scale, judged fresh, ignoring what the writer claimed.
${ASSUMES_HISTORY} Judge it fresh, ignoring what the writer claimed.
CATEGORIES (no ordering; pick the closest):
target: what the question aims at. experience = something that happened; position = an opinion or belief; priority = what they rank or would choose; process = how they do or decide something; affect = how they feel.
time: past, present or future, by where the answer lives.
subjects: every subject the question sits in, from ${SUBJECTS.join(", ")}; usually one or two. A question can carry several.
relational: solo = the person alone; relational = the person in relation to someone else.
shape: what kind of answer it produces: story, verdict, fact or feeling.
reason: one clause naming the tell that cost most, or what makes it a 5.
Return JSON only; echo each card's index.`;

export function rateUser(
	kind: DeckKind,
	items: string[],
	note?: string,
): string {
	const head = note
		? `Deck kind: ${kind}. Deck format: ${note}`
		: `Deck kind: ${kind}.`;
	return `${head}\n\n${items.map((t, i) => `[${i}] ${t}`).join("\n\n")}`;
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
- other: ONLY degradation, coercion or humiliation of a person as the point of the card, or a slur.
Everything else is "ok": adult, consensual, spicy, cruel, confrontational or uncomfortable content, questions that force someone to rank the people they love, questions about death wishes, envy, contempt, money or leaving. Discomfort, cruelty toward the answerer, or "not appropriate for a casual game" are NOT reasons: the decks choose their own register and the players choose their deck. Be consistent: if your reason says the card is acceptable, the verdict is "ok" and the category "none". Return JSON only; echo each card's index.`;

export function safetyUser(
	kind: DeckKind,
	items: string[],
	note?: string,
): string {
	const head = note
		? `Deck kind: ${kind}. Deck note: ${note}`
		: `Deck kind: ${kind}.`;
	return `${head}\n\n${items.map((t, i) => `[${i}] ${t}`).join("\n\n")}`;
}

// ── rank ────────────────────────────────────────────────────────────────────
// Absolute scores decide the gate; everything that passes sits at voice 4-5,
// so a comparative pass decides which of the survivors get published.

export const rankSchema = itemsSchema({
	index: { type: "integer" },
	place: { type: "integer" },
});

export const rankSystem = `${SITE}

${STYLE}

Every card below has already passed the quality gate. Put them in order of which you would rather be asked, across a table, by someone you are getting to know: "place" 1 is the card you would most want to answer and hear answered, the last place is the one you would skip. Judge the whole card: does it start a conversation that keeps going, does it ask for something the answerer has to work out rather than recite, does it sound like a person said it. Every index gets exactly one place; no ties. Return JSON only.`;

export function rankUser(kind: DeckKind, items: string[]): string {
	return `Deck kind: ${kind}. ${items.length} cards; place them 1 to ${items.length}.\n\n${items.map((t, i) => `[${i}] ${t}`).join("\n\n")}`;
}

/** Categorical facets from a model: each value checked against its declared
 * list, else null; unknown subjects dropped. A model proposes, code decides. */
export function asFacets(item: Record<string, unknown>): Facets {
	const one = <T extends readonly string[]>(v: unknown, list: T) =>
		list.includes(v as string) ? (v as T[number]) : null;
	return {
		target: one(item.target, TARGETS),
		time: one(item.time, TIMES),
		subjects: Array.isArray(item.subjects)
			? [
					...new Set(
						item.subjects.filter((s): s is Facets["subjects"][number] =>
							(SUBJECTS as readonly string[]).includes(s as string),
						),
					),
				]
			: [],
		relational: one(item.relational, RELATIONS),
		shape: one(item.shape, SHAPES),
	};
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
