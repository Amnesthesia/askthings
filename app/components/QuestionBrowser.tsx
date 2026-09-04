import { useMemo, useState } from "react";
import {
	type Facets,
	INTENSITIES,
	type Intensity,
	RELATIONS,
	SCORE_KEYS,
	type Scores,
	SHAPES,
	SUBJECTS,
	TARGETS,
	TIMES,
} from "../../src/shared.ts";

/** One card flattened for browsing; built at build time in questions/index.astro. */
export interface Row {
	id: string;
	deck: string;
	deckName: string;
	kind: string;
	tier: number;
	intensity: Intensity;
	tags: string[];
	scores: Scores;
	/** Rater's categorical annotations; absent on cards not yet re-rated. */
	facets?: Facets;
	headline: string;
	/** Extra text for dilemmas / pairs, searched and shown small. */
	body: string;
	path: string;
}

interface Props {
	rows: Row[];
}

type Mins = Partial<Record<(typeof SCORE_KEYS)[number], number>>;

const SCORE_LABEL: Record<(typeof SCORE_KEYS)[number], string> = {
	conversation: "Conversation",
	intellectual: "Intellectual",
	emotional: "Emotional",
	depth: "Depth",
	voice: "Voice",
	escapability: "Escapability",
	specificity: "Specificity",
	exposureCost: "Exposure cost",
	revealed: "Revealed, not stated",
};
/** Minimum-score sliders. Voice gets none: the gate keeps only cards that sound
 * like a person, so there is nothing to tune. Escapability is the one axis
 * where LOW is good, so it gets a maximum slider of its own below. */
const SLIDERS = SCORE_KEYS.filter((k) => k !== "voice" && k !== "escapability");
const FACET_LABEL = {
	target: "Target",
	time: "Time",
	relational: "Frame",
	shape: "Answer shape",
} as const;
const FACET_OPTIONS = {
	target: TARGETS,
	time: TIMES,
	relational: RELATIONS,
	shape: SHAPES,
} as const;
type FacetKey = keyof typeof FACET_OPTIONS;

/**
 * The whole database of cards, filterable. Server-rendered with every row so
 * the page is complete without JavaScript; the controls take over on
 * hydration. Filters are plain native inputs.
 */
export default function QuestionBrowser({ rows }: Props) {
	const [deck, setDeck] = useState("");
	const [kind, setKind] = useState("");
	const [range, setRange] = useState<[number, number]>([1, 4]);
	const [mins, setMins] = useState<Mins>({});
	const [tags, setTags] = useState<Set<string>>(new Set());
	const [q, setQ] = useState("");
	/** Escapability: low is good, so the control is a ceiling. */
	const [maxEscape, setMaxEscape] = useState<number | undefined>();
	const [facet, setFacet] = useState<Partial<Record<FacetKey, string>>>({});
	const [subjects, setSubjects] = useState<Set<string>>(new Set());

	const decks = useMemo(
		() =>
			[...new Map(rows.map((r) => [r.deck, r.deckName]))].sort((a, b) =>
				a[1].localeCompare(b[1]),
			),
		[rows],
	);
	const kinds = useMemo(
		() => [...new Set(rows.map((r) => r.kind))].sort(),
		[rows],
	);
	const tagCounts = useMemo(() => {
		const n = new Map<string, number>();
		for (const r of rows) for (const t of r.tags) n.set(t, (n.get(t) ?? 0) + 1);
		return [...n].sort((a, b) => b[1] - a[1]).slice(0, 40);
	}, [rows]);
	const rated = rows.some((r) => r.scores.conversation !== null);

	const needle = q.trim().toLowerCase();
	const shown = rows.filter((r) => {
		if (deck && r.deck !== deck) return false;
		if (kind && r.kind !== kind) return false;
		if (r.intensity < range[0] || r.intensity > range[1]) return false;
		if (tags.size && !r.tags.some((t) => tags.has(t))) return false;
		for (const k of SCORE_KEYS) {
			const min = mins[k];
			if (min && (r.scores[k] ?? 0) < min) return false;
		}
		// Unrated on an axis or facet fails any filter set on it: absence is
		// not evidence.
		if (maxEscape !== undefined && (r.scores.escapability ?? 6) > maxEscape)
			return false;
		for (const k of Object.keys(facet) as FacetKey[]) {
			const want = facet[k];
			if (want && r.facets?.[k] !== want) return false;
		}
		if (subjects.size && !r.facets?.subjects.some((s) => subjects.has(s)))
			return false;
		if (
			needle &&
			!`${r.headline} ${r.body} ${r.tags.join(" ")}`
				.toLowerCase()
				.includes(needle)
		)
			return false;
		return true;
	});

	const toggleTag = (t: string) =>
		setTags((prev) => {
			const next = new Set(prev);
			if (next.has(t)) next.delete(t);
			else next.add(t);
			return next;
		});
	// Two native range inputs on one track; they may not cross.
	const setLo = (v: number) => setRange(([, hi]) => [Math.min(v, hi), hi]);
	const setHi = (v: number) => setRange(([lo]) => [lo, Math.max(v, lo)]);
	const reset = () => {
		setDeck("");
		setKind("");
		setRange([1, 4]);
		setMins({});
		setTags(new Set());
		setQ("");
		setMaxEscape(undefined);
		setFacet({});
		setSubjects(new Set());
	};
	const toggleSubject = (s: string) =>
		setSubjects((prev) => {
			const next = new Set(prev);
			if (next.has(s)) next.delete(s);
			else next.add(s);
			return next;
		});
	const subjectCounts = useMemo(() => {
		const n = new Map<string, number>();
		for (const r of rows)
			for (const s of r.facets?.subjects ?? []) n.set(s, (n.get(s) ?? 0) + 1);
		return SUBJECTS.map((s) => [s, n.get(s) ?? 0] as const);
	}, [rows]);
	const faceted = rows.some((r) => r.facets);

	return (
		<div className="browser">
			<form
				className="browser-filters"
				onSubmit={(e) => e.preventDefault()}
				aria-label="Filter questions"
			>
				<div className="browser-filters-head">
					<h2>Filter</h2>
					<span className="browser-count" aria-live="polite">
						{shown.length} of {rows.length} questions
					</span>
					<button type="button" className="secondary" onClick={reset}>
						Reset
					</button>
				</div>
				<fieldset className="filter-group filter-find">
					<legend>Find</legend>
					<label>
						Search
						<input
							type="search"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="any word"
						/>
					</label>
					<label>
						Deck
						<select value={deck} onChange={(e) => setDeck(e.target.value)}>
							<option value="">All decks</option>
							{decks.map(([slug, name]) => (
								<option key={slug} value={slug}>
									{name}
								</option>
							))}
						</select>
					</label>
					{kinds.length > 1 && (
						<label>
							Card type
							<select value={kind} onChange={(e) => setKind(e.target.value)}>
								<option value="">Any</option>
								{kinds.map((k) => (
									<option key={k} value={k}>
										{k}
									</option>
								))}
							</select>
						</label>
					)}
				</fieldset>
				<fieldset className="filter-group range-field">
					<legend>
						Exposure level:{" "}
						{range[0] === range[1] ? range[0] : `${range[0]} to ${range[1]}`}
					</legend>
					<div className="double-range">
						<input
							type="range"
							min={1}
							max={4}
							step={1}
							value={range[0]}
							aria-label="Lowest exposure level"
							onChange={(e) => setLo(Number(e.target.value))}
						/>
						<input
							type="range"
							min={1}
							max={4}
							step={1}
							value={range[1]}
							aria-label="Highest exposure level"
							onChange={(e) => setHi(Number(e.target.value))}
						/>
					</div>
					<div className="range-ticks" aria-hidden="true">
						{INTENSITIES.map((l) => (
							<span key={l}>{l}</span>
						))}
					</div>
				</fieldset>
				{faceted && (
					<fieldset className="filter-group tag-field">
						<legend>
							Subject
							{subjects.size ? ` (${subjects.size} selected, any match)` : ""}
						</legend>
						<div className="tag-chips">
							{subjectCounts.map(([s, n]) => (
								<button
									type="button"
									key={s}
									className="tag-chip"
									aria-pressed={subjects.has(s)}
									onClick={() => toggleSubject(s)}
								>
									{s} <small>{n}</small>
								</button>
							))}
						</div>
					</fieldset>
				)}
				{faceted && (
					<fieldset className="filter-group facet-field">
						<legend>What kind of question</legend>
						{(Object.keys(FACET_OPTIONS) as FacetKey[]).map((k) => (
							<fieldset className="facet-radios" key={k}>
								<legend>{FACET_LABEL[k]}</legend>
								{["", ...FACET_OPTIONS[k]].map((v) => (
									<label key={v || "any"}>
										<input
											type="radio"
											name={`facet-${k}`}
											value={v}
											checked={(facet[k] ?? "") === v}
											onChange={() =>
												setFacet((f) => ({ ...f, [k]: v || undefined }))
											}
										/>
										{v || "any"}
									</label>
								))}
							</fieldset>
						))}
					</fieldset>
				)}
				{rated && (
					<fieldset className="filter-group score-field">
						<legend>Scores</legend>
						<p className="filter-help">
							Minimums, 1 to 5. <em>Conversation</em> is how well the card
							starts a real exchange; <em>depth</em> how far below the surface
							the honest answer goes; <em>escapability</em> how easy a polite
							non-answer is, so that one is a ceiling.
						</p>
						<label>
							Escapability at most
							<input
								type="range"
								min={1}
								max={5}
								step={1}
								value={maxEscape ?? 5}
								aria-valuetext={
									maxEscape !== undefined ? `at most ${maxEscape}` : "any"
								}
								onChange={(e) =>
									setMaxEscape(
										Number(e.target.value) < 5
											? Number(e.target.value)
											: undefined,
									)
								}
							/>
							<span className="range-value">
								{maxEscape !== undefined ? `≤ ${maxEscape}` : "any"}
							</span>
						</label>
						{SLIDERS.map((k) => (
							<label key={k}>
								{SCORE_LABEL[k]}
								<input
									type="range"
									min={1}
									max={5}
									step={1}
									value={mins[k] ?? 1}
									aria-valuetext={
										(mins[k] ?? 1) > 1 ? `at least ${mins[k]}` : "any"
									}
									onChange={(e) =>
										setMins((m) => ({
											...m,
											[k]:
												Number(e.target.value) > 1
													? Number(e.target.value)
													: undefined,
										}))
									}
								/>
								<span className="range-value">
									{(mins[k] ?? 1) > 1 ? `≥ ${mins[k]}` : "any"}
								</span>
							</label>
						))}
					</fieldset>
				)}
				<fieldset className="filter-group tag-field">
					<legend>
						Tags{tags.size ? ` (${tags.size} selected, any match)` : ""}
					</legend>
					<div className="tag-chips tag-chips-small">
						{tagCounts.map(([t, n]) => (
							<button
								type="button"
								key={t}
								className="tag-chip"
								aria-pressed={tags.has(t)}
								onClick={() => toggleTag(t)}
							>
								{t} <small>{n}</small>
							</button>
						))}
					</div>
				</fieldset>
			</form>

			<ol className="browser-list">
				{shown.map((r) => (
					<li key={r.id} data-tier={r.tier}>
						<a href={r.path}>{r.headline}</a>
						{r.body && <small className="browser-body">{r.body}</small>}
						<small className="browser-meta">
							{r.deckName} · Level {r.tier} · exposure {r.intensity}
							{r.scores.conversation !== null && (
								<>
									{" "}
									· conv {r.scores.conversation} · int {r.scores.intellectual} ·
									emo {r.scores.emotional} · depth {r.scores.depth} · voice{" "}
									{r.scores.voice}
									{r.scores.escapability != null &&
										` · escape ${r.scores.escapability} · specific ${r.scores.specificity} · exposes ${r.scores.exposureCost} · revealed ${r.scores.revealed}`}
								</>
							)}
							{r.facets &&
								` · ${[r.facets.target, r.facets.time, r.facets.relational, r.facets.shape].filter(Boolean).join(" · ")}${r.facets.subjects.length ? ` · ${r.facets.subjects.join(", ")}` : ""}`}
							{r.tags.length > 0 && ` · ${r.tags.join(", ")}`}
						</small>
					</li>
				))}
			</ol>
		</div>
	);
}
