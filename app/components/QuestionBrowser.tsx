import { useMemo, useState } from "react";
import {
	INTENSITIES,
	type Intensity,
	SCORE_KEYS,
	type Scores,
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
};

/**
 * The whole database of cards, filterable. Server-rendered with every row so
 * the page is complete without JavaScript; the controls take over on
 * hydration. Filters are plain native inputs.
 */
export default function QuestionBrowser({ rows }: Props) {
	const [deck, setDeck] = useState("");
	const [kind, setKind] = useState("");
	const [levels, setLevels] = useState<Set<Intensity>>(new Set());
	const [mins, setMins] = useState<Mins>({});
	const [tag, setTag] = useState("");
	const [q, setQ] = useState("");

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
	const tags = useMemo(() => {
		const n = new Map<string, number>();
		for (const r of rows) for (const t of r.tags) n.set(t, (n.get(t) ?? 0) + 1);
		return [...n].sort((a, b) => b[1] - a[1]).slice(0, 40);
	}, [rows]);
	const rated = rows.some((r) => r.scores.conversation !== null);

	const needle = q.trim().toLowerCase();
	const shown = rows.filter((r) => {
		if (deck && r.deck !== deck) return false;
		if (kind && r.kind !== kind) return false;
		if (levels.size && !levels.has(r.intensity)) return false;
		if (tag && !r.tags.includes(tag)) return false;
		for (const k of SCORE_KEYS) {
			const min = mins[k];
			if (min && (r.scores[k] ?? 0) < min) return false;
		}
		if (
			needle &&
			!`${r.headline} ${r.body} ${r.tags.join(" ")}`
				.toLowerCase()
				.includes(needle)
		)
			return false;
		return true;
	});

	const toggleLevel = (l: Intensity) =>
		setLevels((prev) => {
			const next = new Set(prev);
			if (next.has(l)) next.delete(l);
			else next.add(l);
			return next;
		});
	const reset = () => {
		setDeck("");
		setKind("");
		setLevels(new Set());
		setMins({});
		setTag("");
		setQ("");
	};

	return (
		<div className="browser">
			<form
				className="browser-filters"
				onSubmit={(e) => e.preventDefault()}
				aria-label="Filter questions"
			>
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
						Shape
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
				<fieldset>
					<legend>Exposure level</legend>
					{INTENSITIES.map((l) => (
						<label key={l} className="check">
							<input
								type="checkbox"
								checked={levels.has(l)}
								onChange={() => toggleLevel(l)}
							/>{" "}
							{l}
						</label>
					))}
				</fieldset>
				{rated && (
					<fieldset>
						<legend>Minimum score (1–5)</legend>
						{SCORE_KEYS.map((k) => (
							<label key={k}>
								{SCORE_LABEL[k]}
								<select
									value={mins[k] ?? ""}
									onChange={(e) =>
										setMins((m) => ({
											...m,
											[k]: e.target.value ? Number(e.target.value) : undefined,
										}))
									}
								>
									<option value="">any</option>
									{[2, 3, 4, 5].map((n) => (
										<option key={n} value={n}>
											≥ {n}
										</option>
									))}
								</select>
							</label>
						))}
					</fieldset>
				)}
				<label>
					Tag
					<select value={tag} onChange={(e) => setTag(e.target.value)}>
						<option value="">Any</option>
						{tags.map(([t, n]) => (
							<option key={t} value={t}>
								{t} ({n})
							</option>
						))}
					</select>
				</label>
				<button type="button" className="secondary" onClick={reset}>
					Reset
				</button>
			</form>

			<p className="browser-count" aria-live="polite">
				{shown.length} of {rows.length} questions
			</p>

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
								</>
							)}
							{r.tags.length > 0 && ` · ${r.tags.join(", ")}`}
						</small>
					</li>
				))}
			</ol>
		</div>
	);
}
