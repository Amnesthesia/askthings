import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	LayoutGrid,
	List,
	Play,
	Share2,
	Shuffle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Card,
	cardHeadline,
	cardPath,
	type Deck,
} from "../../src/shared.ts";
import { useShake } from "../hooks/useShake.ts";
import { useSwipe } from "../hooks/useSwipe.ts";
import {
	buildOrder,
	idFromPath,
	locate,
	shuffleOrder,
	wrap,
} from "../utils/deckNav.ts";
import CardView from "./CardView.tsx";

interface Props {
	deck: Deck;
	/** Card to open on; the first card of the first level when absent. */
	startId?: string;
}

/**
 * Game mode: one card, the whole screen. A presentation layer over the static
 * list that is already in the page — the list stays in the HTML for crawlers
 * and for anyone with JavaScript off (CSS shows this element only under
 * `html.js`). Horizontal = next/previous card in the level, vertical = change
 * level; arrow keys on desktop do the same. The URL always names the current
 * card, so any position is linkable and back/forward work.
 */
export default function GameDeck({ deck, startId }: Props) {
	const cards = useMemo(
		() => new Map(deck.cards.map((c) => [c.id, c])),
		[deck],
	);
	const [order, setOrder] = useState(() => buildOrder(deck));
	const start = startId ? locate(order, startId) : null;
	const [tier, setTier] = useState(start?.tier ?? deck.tiers[0]?.level ?? 1);
	const [indexByTier, setIndexByTier] = useState<Record<number, number>>(() =>
		start ? { [start.tier]: start.index } : {},
	);
	const [open, setOpen] = useState(true);
	const [grid, setGrid] = useState(false);

	const ids = order.get(tier) ?? [];
	const index = wrap(indexByTier[tier] ?? 0, ids.length);
	const id = ids[index];
	const card: Card | undefined = id ? cards.get(id) : undefined;
	const levels = deck.tiers.map((t) => t.level);
	const levelPos = levels.indexOf(tier);

	const goTo = useCallback((pos: { tier: number; index: number }) => {
		setTier(pos.tier);
		setIndexByTier((prev) => ({ ...prev, [pos.tier]: pos.index }));
	}, []);
	const stepCard = useCallback(
		(delta: 1 | -1) =>
			setIndexByTier((prev) => ({
				...prev,
				[tier]: wrap((prev[tier] ?? 0) + delta, ids.length),
			})),
		[tier, ids.length],
	);
	const stepTier = useCallback(
		(delta: 1 | -1) => {
			const next = levels[levelPos + delta];
			if (next !== undefined) setTier(next);
		},
		[levels, levelPos],
	);
	const doShuffle = useCallback(() => {
		if (deck.ordered) return;
		setOrder((prev) => shuffleOrder(prev));
		setIndexByTier({});
	}, [deck.ordered]);

	// URL ↔ state. The first render replaces (the deck URL becomes the card URL
	// without adding a history entry); every later change pushes.
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
	const armShake = useShake(doShuffle, open && !deck.ordered);

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

	return (
		<section
			className="game"
			data-tier={tier}
			aria-label={`${deck.name}, game mode`}
		>
			<div className="game-bar">
				<span className="game-level">Level {tier}</span>
				<span className="game-pos" aria-live="polite">
					{ids.length ? `${index + 1} / ${ids.length}` : "—"}
				</span>
				<div className="game-actions">
					<button
						type="button"
						className="icon-button wide-only"
						aria-pressed={grid}
						aria-label="Show one card from every level"
						title="All levels"
						onClick={() => setGrid((g) => !g)}
					>
						<LayoutGrid size={18} aria-hidden="true" />
					</button>
					<button
						type="button"
						className="icon-button"
						aria-label="Shuffle"
						title={
							deck.ordered
								? "This deck is played in order"
								: "Shuffle (or shake your phone)"
						}
						disabled={deck.ordered}
						onClick={() => {
							armShake();
							doShuffle();
						}}
					>
						<Shuffle size={18} aria-hidden="true" />
					</button>
					<button
						type="button"
						className="icon-button"
						aria-label="Share this card"
						title="Share"
						onClick={share}
					>
						<Share2 size={18} aria-hidden="true" />
					</button>
					<button
						type="button"
						className="icon-button"
						aria-label="Show the whole deck as a list"
						title="List"
						onClick={() => setOpen(false)}
					>
						<List size={18} aria-hidden="true" />
					</button>
				</div>
			</div>

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
								className="game-card"
								data-tier={t.level}
								aria-current={t.level === tier ? "true" : undefined}
								onClick={() => {
									setTier(t.level);
									setGrid(false);
								}}
							>
								<span className="game-level">Level {t.level}</span>
								{tCard && <CardView kind={deck.kind} card={tCard} />}
							</button>
						);
					})}
				</div>
			) : (
				<div className="game-stage" ref={stage}>
					{card ? (
						<article key={id} className="game-card">
							<CardView kind={deck.kind} card={card} />
						</article>
					) : (
						<p className="game-empty">No cards at this level yet.</p>
					)}
				</div>
			)}

			<nav className="game-nav" aria-label="Move through the deck">
				<button
					type="button"
					className="icon-button"
					aria-label="Previous card"
					onClick={() => stepCard(-1)}
				>
					<ChevronLeft size={22} aria-hidden="true" />
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label="Lighter level"
					disabled={levelPos <= 0}
					onClick={() => stepTier(-1)}
				>
					<ChevronUp size={22} aria-hidden="true" />
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label="Deeper level"
					disabled={levelPos >= levels.length - 1}
					onClick={() => stepTier(1)}
				>
					<ChevronDown size={22} aria-hidden="true" />
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label="Next card"
					onClick={() => stepCard(1)}
				>
					<ChevronRight size={22} aria-hidden="true" />
				</button>
			</nav>
		</section>
	);
}
