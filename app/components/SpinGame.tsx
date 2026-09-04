import { Heart, Menu, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Card,
	cardPath,
	type Deck,
	type DeckKind,
	deckPath,
	INTENSITIES,
	type Intensity,
	RELATIONS,
	SHAPES,
	SUBJECTS,
} from "../../src/shared.ts";
import { useSwipe } from "../hooks/useSwipe.ts";
import { isFavourite, toggleFavourite } from "../utils/favourites.ts";
import CardView from "./CardView.tsx";
import DeckPicker from "./DeckPicker.tsx";
import type { DeckLink } from "./GameDeck.tsx";

/** A card from any deck, carrying where it came from. Built in spin/index.astro. */
export type SpinCard = Card & {
	kind: DeckKind;
	deck: string;
	deckName: string;
	/** Only makes sense between two people with a history together ("What do
	 * you blame me for that you chose yourself?"). Present-moment cards about
	 * the other person ("What do you like about me?") are not this. The pool
	 * holds these back unless asked. */
	assumesHistory: boolean;
};

interface Props {
	cards: SpinCard[];
	decks: DeckLink[];
}

interface Filters {
	/** Deck slugs left out of the pool. Thought Experiments is out by default:
	 * a read-aloud scenario is a different evening from a one-line question. */
	excluded: string[];
	range: [Intensity, Intensity];
	/** Minimum scores; a missing key means any. Voice is not offered: the gate
	 * already keeps only cards that sound like a person, so there is nothing
	 * for a player to tune. */
	mins: { conversation?: number; depth?: number };
	/** Include cards that presume a shared history. On by default; untick for
	 * a table of near-strangers. */
	assumesHistory: boolean;
	/** Rater's facets: subjects (any match; empty = all), answer shape, frame. */
	subjects: string[];
	shape: string | null;
	relational: string | null;
}

const FILTERS_KEY = "askthings:spin-filters";
const DEFAULT_EXCLUDED = ["thought-experiments"];
const DEFAULT: Filters = {
	excluded: DEFAULT_EXCLUDED,
	range: [1, 4],
	mins: {},
	assumesHistory: true,
	subjects: [],
	shape: null,
	relational: null,
};
/** Same slot-machine timing as Improv; slide matches GameDeck's SLIDE_MS. */
const SPIN_MS = 900;
const SLIDE_MS = 240;
const TICK_MS = 70;
const SCORES = ["conversation", "depth"] as const;
const SCORE_LABEL = {
	conversation: "Conversation",
	depth: "Depth",
};

const pick = <T,>(list: T[], not?: T): T | undefined => {
	if (list.length === 0) return undefined;
	if (list.length === 1) return list[0];
	let c = list[Math.floor(Math.random() * list.length)];
	while (c === not) c = list[Math.floor(Math.random() * list.length)];
	return c;
};

/**
 * A slot machine over every question on the site. Spin draws one card at
 * random from the pool; the pool is whatever the filters allow (decks,
 * exposure range, minimum scores). Filters persist per browser.
 */
export default function SpinGame({ cards, decks }: Props) {
	const [filters, setFilters] = useState<Filters>(DEFAULT);
	const [menu, setMenu] = useState(false);
	const [panel, setPanel] = useState(false);
	const [card, setCard] = useState<SpinCard | null>(null);
	const [spinning, setSpinning] = useState(false);
	/** The card on its way out, so the new one can slide in over it. */
	const [leaving, setLeaving] = useState<SpinCard | null>(null);
	const current = useRef<SpinCard | null>(null);
	useEffect(() => {
		current.current = card;
	}, [card]);
	const [starred, setStarred] = useState(false);

	// Filters are read after mount: the server has no localStorage.
	useEffect(() => {
		try {
			const raw = localStorage.getItem(FILTERS_KEY);
			if (raw) setFilters({ ...DEFAULT, ...(JSON.parse(raw) as Filters) });
		} catch {}
	}, []);
	const update = (patch: Partial<Filters>) =>
		setFilters((f) => {
			const next = { ...f, ...patch };
			try {
				localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
			} catch {}
			return next;
		});

	const pool = useMemo(
		() =>
			cards.filter((c) => {
				if (c.assumesHistory && !filters.assumesHistory) return false;
				// A facet filter set on an unrated card fails it: absence is not evidence.
				if (
					filters.subjects.length &&
					!c.facets?.subjects.some((s) => filters.subjects.includes(s))
				)
					return false;
				if (filters.shape && c.facets?.shape !== filters.shape) return false;
				if (filters.relational && c.facets?.relational !== filters.relational)
					return false;
				if (filters.excluded.includes(c.deck)) return false;
				if (c.intensity < filters.range[0] || c.intensity > filters.range[1])
					return false;
				for (const k of SCORES) {
					const min = filters.mins[k];
					if (min && (c.scores[k] ?? 0) < min) return false;
				}
				return true;
			}),
		[cards, filters],
	);

	const timer = useRef<ReturnType<typeof setInterval> | null>(null);
	const spin = useCallback(() => {
		if (timer.current) clearInterval(timer.current);
		const settle = () => {
			setCard((prev) => pick(pool, prev ?? undefined) ?? null);
			setSpinning(false);
		};
		const reduce = window.matchMedia?.(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (reduce || pool.length < 2) {
			settle();
			return;
		}
		// Slide the old card out to the left while the new one flickers in.
		if (current.current) {
			setLeaving(current.current);
			window.setTimeout(() => setLeaving(null), SLIDE_MS);
		}
		setSpinning(true);
		const started = Date.now();
		timer.current = setInterval(() => {
			setCard(pick(pool) ?? null);
			if (Date.now() - started >= SPIN_MS) {
				if (timer.current) clearInterval(timer.current);
				timer.current = null;
				settle();
			}
		}, TICK_MS);
	}, [pool]);
	useEffect(
		() => () => {
			if (timer.current) clearInterval(timer.current);
		},
		[],
	);
	// First draw on mount and whenever the pool changes.
	useEffect(() => {
		spin();
	}, [spin]);
	useEffect(() => {
		setStarred(card ? isFavourite(card.id) : false);
	}, [card]);

	const stage = useRef<HTMLDivElement>(null);
	useSwipe(stage, { onHorizontal: spin, onVertical: () => {} });

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
			const map: Record<string, () => void> = {
				" ": spin,
				Enter: spin,
				ArrowRight: spin,
				ArrowLeft: spin,
				Escape: () => {
					setMenu(false);
					setPanel(false);
				},
			};
			const fn = map[e.key];
			if (fn) {
				e.preventDefault();
				fn();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [spin]);

	useEffect(() => {
		document.documentElement.classList.add("game-open");
		return () => document.documentElement.classList.remove("game-open");
	}, []);

	const star = () => {
		if (!card) return;
		const deck = {
			kind: card.kind,
			deck: card.deck,
			name: card.deckName,
		} as Deck;
		setStarred(toggleFavourite(deck, card));
	};
	const toggleDeck = (slug: string) =>
		update({
			excluded: filters.excluded.includes(slug)
				? filters.excluded.filter((d) => d !== slug)
				: [...filters.excluded, slug],
		});
	const setLo = (v: number) =>
		update({
			range: [Math.min(v, filters.range[1]) as Intensity, filters.range[1]],
		});
	const setHi = (v: number) =>
		update({
			range: [filters.range[0], Math.max(v, filters.range[0]) as Intensity],
		});
	const active =
		[...filters.excluded].sort().join() !==
			[...DEFAULT_EXCLUDED].sort().join() ||
		filters.range[0] !== 1 ||
		filters.range[1] !== 4 ||
		!filters.assumesHistory ||
		filters.subjects.length > 0 ||
		filters.shape !== null ||
		filters.relational !== null ||
		SCORES.some((k) => filters.mins[k]);
	const toggleSubject = (s: string) =>
		update({
			subjects: filters.subjects.includes(s)
				? filters.subjects.filter((x) => x !== s)
				: [...filters.subjects, s],
		});
	const assumesHistoryCount = cards.filter((c) => c.assumesHistory).length;

	return (
		<section
			className="game spin"
			data-tier={card?.intensity ?? 1}
			aria-label="Spin, game mode"
		>
			<div className="game-top">
				<button
					type="button"
					className="game-icon"
					aria-label={menu ? "Close menu" : "Menu"}
					aria-expanded={menu}
					onClick={() => {
						setPanel(false);
						setMenu((m) => !m);
					}}
				>
					<Menu size={24} aria-hidden="true" />
				</button>
				<span className="game-status" aria-live="polite">
					{pool.length} of {cards.length} in the pool
				</span>
				<button
					type="button"
					className="game-icon spin-filter-toggle"
					aria-label={panel ? "Close filters" : "Filters"}
					aria-expanded={panel}
					aria-pressed={active}
					onClick={() => {
						setMenu(false);
						setPanel((p) => !p);
					}}
				>
					<SlidersHorizontal size={22} aria-hidden="true" />
					{active && <span className="spin-filter-dot" aria-hidden="true" />}
				</button>
				<button
					type="button"
					className="game-icon game-star"
					aria-label={starred ? "Remove from favourites" : "Add to favourites"}
					aria-pressed={starred}
					disabled={!card}
					onClick={star}
				>
					<Heart
						size={22}
						aria-hidden="true"
						fill={starred ? "currentColor" : "none"}
					/>
				</button>
			</div>

			{menu && (
				<div className="game-menu" role="dialog" aria-label="Pick a game">
					<DeckPicker
						links={[
							...decks.map((d) => ({ href: deckPath(d.deck), name: d.name })),
							{ href: "/spin/", name: "Spin", current: true },
							{ href: "/favourites/", name: "Favourites" },
							{ href: "/questions/", name: "All questions" },
						]}
					/>
					<div className="game-actions">
						<button
							type="button"
							className="game-icon"
							aria-label="Close menu"
							onClick={() => setMenu(false)}
						>
							<X size={20} aria-hidden="true" />
						</button>
					</div>
				</div>
			)}

			{panel && (
				<form
					className="spin-filters"
					aria-label="Filter the pool"
					onSubmit={(e) => {
						e.preventDefault();
						setPanel(false);
					}}
				>
					<div className="spin-filters-head">
						<h2>Filter the pool</h2>
						<span className="spin-pool" aria-live="polite">
							{pool.length} of {cards.length} cards
						</span>
					</div>
					<fieldset className="tag-field">
						<legend>
							Decks ({decks.length - filters.excluded.length} of {decks.length})
						</legend>
						<div className="tag-chips">
							{decks.map((d) => (
								<button
									type="button"
									key={d.deck}
									className="tag-chip"
									aria-pressed={!filters.excluded.includes(d.deck)}
									onClick={() => toggleDeck(d.deck)}
								>
									{d.name}
								</button>
							))}
						</div>
					</fieldset>
					<fieldset className="tag-field">
						<legend>
							Subject
							{filters.subjects.length
								? ` (${filters.subjects.length}, any match)`
								: " (all)"}
						</legend>
						<div className="tag-chips">
							{SUBJECTS.map((s) => (
								<button
									type="button"
									key={s}
									className="tag-chip"
									aria-pressed={filters.subjects.includes(s)}
									onClick={() => toggleSubject(s)}
								>
									{s}
								</button>
							))}
						</div>
					</fieldset>
					<fieldset className="facet-field">
						<legend>What kind of question</legend>
						<label>
							Answer shape
							<select
								value={filters.shape ?? ""}
								onChange={(e) => update({ shape: e.target.value || null })}
							>
								<option value="">Any</option>
								{SHAPES.map((v) => (
									<option key={v} value={v}>
										{v}
									</option>
								))}
							</select>
						</label>
						<label>
							Frame
							<select
								value={filters.relational ?? ""}
								onChange={(e) => update({ relational: e.target.value || null })}
							>
								<option value="">Any</option>
								{RELATIONS.map((v) => (
									<option key={v} value={v}>
										{v}
									</option>
								))}
							</select>
						</label>
					</fieldset>
					<fieldset className="range-field">
						<legend>
							Exposure level:{" "}
							{filters.range[0] === filters.range[1]
								? filters.range[0]
								: `${filters.range[0]} to ${filters.range[1]}`}
						</legend>
						<div className="double-range">
							<input
								type="range"
								min={1}
								max={4}
								step={1}
								value={filters.range[0]}
								aria-label="Lowest exposure level"
								onChange={(e) => setLo(Number(e.target.value))}
							/>
							<input
								type="range"
								min={1}
								max={4}
								step={1}
								value={filters.range[1]}
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
					<fieldset>
						<legend>Minimum score (1–5)</legend>
						{SCORES.map((k) => (
							<label key={k}>
								{SCORE_LABEL[k]}
								<input
									type="range"
									min={1}
									max={5}
									step={1}
									value={filters.mins[k] ?? 1}
									aria-valuetext={
										(filters.mins[k] ?? 1) > 1
											? `at least ${filters.mins[k]}`
											: "any"
									}
									onChange={(e) =>
										update({
											mins: {
												...filters.mins,
												[k]:
													Number(e.target.value) > 1
														? Number(e.target.value)
														: undefined,
											},
										})
									}
								/>
								<span className="range-value">
									{(filters.mins[k] ?? 1) > 1 ? `≥ ${filters.mins[k]}` : "any"}
								</span>
							</label>
						))}
					</fieldset>
					<label className="spin-about-us">
						<input
							type="checkbox"
							checked={filters.assumesHistory}
							onChange={(e) => update({ assumesHistory: e.target.checked })}
						/>
						Include shared history questions ({assumesHistoryCount})
					</label>
					<div className="spin-filter-actions">
						<button
							type="button"
							className="secondary"
							onClick={() => update(DEFAULT)}
						>
							Reset
						</button>
						<button type="submit">Done</button>
					</div>
				</form>
			)}

			<div className="game-stage" ref={stage}>
				<div className="game-track">
					{leaving && (
						<article
							className="game-card leave-left"
							aria-hidden="true"
							key={`leaving-${leaving.id}`}
						>
							<CardView kind={leaving.kind} card={leaving} />
						</article>
					)}
					{card ? (
						<article
							className={`game-card${spinning ? " spinning" : ""}${leaving ? " enter-left" : ""}`}
							aria-live={spinning ? "off" : "polite"}
						>
							<CardView kind={card.kind} card={card} />
							<small className="spin-meta">
								<a href={cardPath(card.deck, card.id)}>{card.deckName}</a> ·
								Level {card.tier}
							</small>
						</article>
					) : (
						<p className="game-card">
							No cards match these filters. Loosen them a little.
						</p>
					)}
				</div>
			</div>

			<div className="game-nav improv-nav">
				<button
					type="button"
					className="game-icon improv-spin"
					onClick={spin}
					disabled={spinning || pool.length === 0}
				>
					<RefreshCw size={22} aria-hidden="true" /> Spin
				</button>
			</div>
		</section>
	);
}
