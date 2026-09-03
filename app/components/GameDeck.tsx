import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	LayoutGrid,
	List,
	Menu,
	Play,
	Share2,
	Shuffle,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Card,
	cardHeadline,
	cardPath,
	type Deck,
	deckPath,
} from "../../src/shared.ts";
import { useShake } from "../hooks/useShake.ts";
import { useSwipe } from "../hooks/useSwipe.ts";
import {
	buildOrder,
	dealOrder,
	idFromPath,
	locate,
	shuffleOrder,
	wrap,
} from "../utils/deckNav.ts";
import CardView from "./CardView.tsx";

export interface DeckLink {
	deck: string;
	name: string;
}

interface Props {
	deck: Deck;
	/** Every playable deck, for the fold-down game bar. */
	decks: DeckLink[];
	/** Card to open on; the first card of the first level when absent. */
	startId?: string;
}

/** Degrees of hue drift across one level: enough to feel movement, small
 * enough that white text stays >= 4.5:1 on every step (app/styles.test.ts). */
const HUE_DRIFT = 28;

type Dir = "left" | "right" | "up" | "down";
/** Must match the slide animation length in styles.css. */
const SLIDE_MS = 240;

/**
 * Game mode: the whole screen is the colour of the level, the card is white
 * and bold, and nothing else is on screen but four chevrons and a menu icon.
 * A presentation layer over the static list already in the page (CSS shows
 * this element only under `html.js`). Horizontal = next/previous card in the
 * level, vertical = change level; arrow keys on desktop do the same. The URL
 * always names the current card, so any position is linkable and back/forward
 * work.
 */
export default function GameDeck({ deck, decks, startId }: Props) {
	const cards = useMemo(
		() => new Map(deck.cards.map((c) => [c.id, c])),
		[deck],
	);
	// play.order decides the opening state: random decks open shuffled,
	// sequential ones never shuffle, free ones offer it.
	const canShuffle = deck.play.order !== "sequential";
	const [order, setOrder] = useState(() => {
		const base = buildOrder(deck);
		const dealt = deck.play.order === "random" ? shuffleOrder(base) : base;
		return dealOrder(dealt, deck.play.cardsPerTier);
	});
	const start = startId ? locate(order, startId) : null;
	const [tier, setTier] = useState(start?.tier ?? deck.tiers[0]?.level ?? 1);
	const [indexByTier, setIndexByTier] = useState<Record<number, number>>(() =>
		start ? { [start.tier]: start.index } : {},
	);
	const [open, setOpen] = useState(true);
	const [menu, setMenu] = useState(false);
	const [grid, setGrid] = useState(false);
	// Slide transitions: the card that just left, and which way things moved.
	const dir = useRef<Dir | null>(null);
	const [leaving, setLeaving] = useState<{ card: Card; dir: Dir } | null>(null);

	const ids = order.get(tier) ?? [];
	const index = wrap(indexByTier[tier] ?? 0, ids.length);
	const id = ids[index];
	const card: Card | undefined = id ? cards.get(id) : undefined;
	const levels = deck.tiers.map((t) => t.level);
	const levelPos = levels.indexOf(tier);
	// Position within the level as a hue offset, centred on the level's colour.
	const drift =
		ids.length > 1 ? ((index / (ids.length - 1)) * 2 - 1) * (HUE_DRIFT / 2) : 0;

	const goTo = useCallback((pos: { tier: number; index: number }) => {
		setTier(pos.tier);
		setIndexByTier((prev) => ({ ...prev, [pos.tier]: pos.index }));
	}, []);
	// Past the last card of a level, the next swipe opens the next level at its
	// first card; before the first card, the previous level at its last. The
	// deck never wraps within a level: the levels are the progression.
	const stepCard = useCallback(
		(delta: 1 | -1) => {
			const target = index + delta;
			if (target >= 0 && target < ids.length) {
				dir.current = delta > 0 ? "left" : "right";
				setIndexByTier((prev) => ({ ...prev, [tier]: target }));
				return;
			}
			const nextTier = levels[levelPos + delta];
			if (nextTier === undefined) return;
			dir.current = delta > 0 ? "left" : "right";
			const nextLen = order.get(nextTier)?.length ?? 0;
			setIndexByTier((prev) => ({
				...prev,
				[nextTier]: delta > 0 ? 0 : Math.max(0, nextLen - 1),
			}));
			setTier(nextTier);
		},
		[index, ids.length, tier, levels, levelPos, order],
	);
	const stepTier = useCallback(
		(delta: 1 | -1) => {
			const next = levels[levelPos + delta];
			if (next === undefined) return;
			// Deeper: out through the top, in from the bottom (the scroll metaphor).
			dir.current = delta > 0 ? "up" : "down";
			setTier(next);
		},
		[levels, levelPos],
	);

	// When the card changes after a directional move, keep the old one around
	// for one animation so it can slide out while the new one slides in.
	const prevCard = useRef<Card | undefined>(card);
	useEffect(() => {
		const prev = prevCard.current;
		prevCard.current = card;
		const d = dir.current;
		dir.current = null;
		if (!prev || !card || prev === card || !d) return;
		setLeaving({ card: prev, dir: d });
		const t = setTimeout(() => setLeaving(null), SLIDE_MS);
		return () => clearTimeout(t);
	}, [card]);
	// Shuffle reshuffles every level and puts you at the start of this one.
	const doShuffle = useCallback(() => {
		if (!canShuffle) return;
		setOrder(dealOrder(shuffleOrder(buildOrder(deck)), deck.play.cardsPerTier));
		setIndexByTier({});
		setMenu(false);
	}, [canShuffle, deck]);

	// URL <-> state. The first render replaces (the deck or home URL becomes the
	// card URL without adding a history entry); every later change pushes.
	const first = useRef(true);
	useEffect(() => {
		if (!id) return;
		const path = cardPath(deck.deck, id);
		if (window.location.pathname === path) return;
		if (first.current) window.history.replaceState({ id }, "", path);
		else window.history.pushState({ id }, "", path);
		first.current = false;
	}, [id, deck.deck]);
	useEffect(() => {
		first.current = false;
	}, []);
	useEffect(() => {
		const onPop = () => {
			const target = idFromPath(window.location.pathname, deck.deck);
			const pos = target ? locate(order, target) : null;
			if (pos) goTo(pos);
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, [order, deck.deck, goTo]);

	// Keyboard, only while the game is showing and nothing is focused for typing.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
			const map: Record<string, () => void> = {
				ArrowRight: () => stepCard(1),
				ArrowLeft: () => stepCard(-1),
				// Down = deeper, like scrolling further down a page.
				ArrowDown: () => stepTier(1),
				ArrowUp: () => stepTier(-1),
				Escape: () => setMenu(false),
			};
			const fn = map[e.key];
			if (fn) {
				e.preventDefault();
				fn();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, stepCard, stepTier]);

	// Swipe up = deeper, same scroll metaphor as ArrowDown.
	const stage = useRef<HTMLDivElement>(null);
	useSwipe(stage, { onHorizontal: stepCard, onVertical: stepTier });
	const armShake = useShake(doShuffle, open && canShuffle);

	// The page under the overlay must not scroll while the game is open.
	useEffect(() => {
		document.documentElement.classList.toggle("game-open", open);
		return () => document.documentElement.classList.remove("game-open");
	}, [open]);

	const share = async () => {
		const url = window.location.href;
		const title = card ? cardHeadline(deck.kind, card) : deck.name;
		if (navigator.share)
			await navigator.share({ title, url }).catch(() => undefined);
		else await navigator.clipboard?.writeText(url);
		setMenu(false);
	};

	if (!open) {
		return (
			<button
				type="button"
				className="game-resume"
				onClick={() => setOpen(true)}
			>
				<Play size={18} aria-hidden="true" /> Play
			</button>
		);
	}

	const edge = (
		label: string,
		Icon: typeof ChevronLeft,
		onClick: () => void,
		disabled: boolean,
		cls: string,
	) => (
		<button
			type="button"
			className={`game-edge ${cls}`}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
		>
			<Icon size={32} strokeWidth={2.5} aria-hidden="true" />
		</button>
	);

	return (
		<section
			className="game"
			data-tier={tier}
			style={{ "--drift": `${drift.toFixed(1)}deg` } as React.CSSProperties}
			aria-label={`${deck.name}, game mode`}
		>
			<div className="game-top">
				<button
					type="button"
					className="game-icon"
					aria-label={menu ? "Close menu" : "Menu"}
					aria-expanded={menu}
					onClick={() => setMenu((m) => !m)}
				>
					{menu ? (
						<Menu size={24} aria-hidden="true" />
					) : (
						<Menu size={24} aria-hidden="true" />
					)}
				</button>
				<span className="game-status" aria-live="polite">
					Level {tier}
					<span className="game-pos">
						{ids.length ? ` · ${index + 1} / ${ids.length}` : ""}
					</span>
				</span>
			</div>

			{menu && (
				<div className="game-menu" role="dialog" aria-label="Games and actions">
					<nav className="game-bar" aria-label="Games">
						{decks.map((d) => (
							<a
								key={d.deck}
								href={deckPath(d.deck)}
								aria-current={d.deck === deck.deck ? "page" : undefined}
							>
								{d.name}
							</a>
						))}
						<a href="/questions/">All questions</a>
					</nav>
					<div className="game-actions">
						<button
							type="button"
							className="game-icon"
							aria-label="Shuffle"
							title={
								canShuffle
									? "Shuffle (or shake your phone)"
									: "This deck is played in order"
							}
							disabled={!canShuffle}
							onClick={() => {
								armShake();
								doShuffle();
							}}
						>
							<Shuffle size={20} aria-hidden="true" /> <span>Shuffle</span>
						</button>
						<button
							type="button"
							className="game-icon"
							aria-label="Share this card"
							onClick={share}
						>
							<Share2 size={20} aria-hidden="true" /> <span>Share</span>
						</button>
						<button
							type="button"
							className="game-icon wide-only"
							aria-pressed={grid}
							aria-label="Show one card from every level"
							onClick={() => {
								setGrid((g) => !g);
								setMenu(false);
							}}
						>
							<LayoutGrid size={20} aria-hidden="true" />{" "}
							<span>All levels</span>
						</button>
						<button
							type="button"
							className="game-icon"
							aria-label="Read the whole deck as a list"
							onClick={() => setOpen(false)}
						>
							<List size={20} aria-hidden="true" /> <span>Read as list</span>
						</button>
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

			{grid ? (
				<div className="game-grid">
					{deck.tiers.map((t) => {
						const tIds = order.get(t.level) ?? [];
						const tCard = cards.get(
							tIds[wrap(indexByTier[t.level] ?? 0, tIds.length)] ?? "",
						);
						return (
							<button
								type="button"
								key={t.level}
								className="game-grid-card"
								data-tier={t.level}
								aria-current={t.level === tier ? "true" : undefined}
								onClick={() => {
									setTier(t.level);
									setGrid(false);
								}}
							>
								<span className="game-status">Level {t.level}</span>
								{tCard && <CardView kind={deck.kind} card={tCard} />}
							</button>
						);
					})}
				</div>
			) : (
				<div className="game-stage" ref={stage}>
					<div className="game-track">
						{leaving && (
							<article
								key={`leaving-${leaving.card.id}`}
								className={`game-card leave-${leaving.dir}`}
								aria-hidden="true"
							>
								<CardView kind={deck.kind} card={leaving.card} />
							</article>
						)}
						{card ? (
							<article
								key={id}
								className={`game-card ${leaving ? `enter-${leaving.dir}` : ""}`}
							>
								<CardView kind={deck.kind} card={card} />
							</article>
						) : (
							<p className="game-card">No cards at this level yet.</p>
						)}
					</div>
				</div>
			)}

			{!grid &&
				edge(
					"Previous card",
					ChevronLeft,
					() => stepCard(-1),
					index === 0 && levelPos <= 0,
					"game-edge-left",
				)}
			{!grid &&
				edge(
					"Next card",
					ChevronRight,
					() => stepCard(1),
					index >= ids.length - 1 && levelPos >= levels.length - 1,
					"game-edge-right",
				)}
			{!grid &&
				edge(
					"Lighter level",
					ChevronUp,
					() => stepTier(-1),
					levelPos <= 0,
					"game-edge-up",
				)}
			{!grid &&
				edge(
					"Deeper level",
					ChevronDown,
					() => stepTier(1),
					levelPos >= levels.length - 1,
					"game-edge-down",
				)}
		</section>
	);
}
