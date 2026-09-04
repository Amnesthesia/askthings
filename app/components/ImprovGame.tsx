import {
	ChevronDown,
	ChevronUp,
	Menu,
	Minus,
	Plus,
	RefreshCw,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Deck, ImprovCard } from "../../src/shared.ts";
import { deckPath } from "../../src/shared.ts";
import { useSwipe } from "../hooks/useSwipe.ts";
import { useThemeColor } from "../hooks/useThemeColor.ts";
import DeckPicker from "./DeckPicker.tsx";
import type { DeckLink } from "./GameDeck.tsx";

interface Props {
	deck: Deck;
	decks: DeckLink[];
}

interface Combo {
	mood: string;
	role: string;
}

const PLAYERS_KEY = "askthings:improv-players";
/** Slot-machine spin: how long the words flicker before they settle. */
const SPIN_MS = 900;
const TICK_MS = 70;

const pick = (list: string[], not?: string): string => {
	if (list.length === 0) return "";
	if (list.length === 1) return list[0];
	let w = list[Math.floor(Math.random() * list.length)];
	while (w === not) w = list[Math.floor(Math.random() * list.length)];
	return w;
};

/**
 * The improv slot machine. The screen is split per player: mood on the left,
 * role on the right. Spin (tap, button, swipe sideways) draws a fresh pair for
 * every player from the current level's banks; swipe up for stranger levels.
 */
export default function ImprovGame({ deck, decks }: Props) {
	const cards = deck.cards as ImprovCard[];
	const levels = deck.tiers.map((t) => t.level);
	const [tier, setTier] = useState(levels[0] ?? 1);
	const levelPos = levels.indexOf(tier);
	useThemeColor(tier);
	const [players, setPlayers] = useState(2);
	const [menu, setMenu] = useState(false);
	const [combos, setCombos] = useState<Combo[]>([]);
	const [spinning, setSpinning] = useState(false);

	// Word banks for the level; a level short of one slot borrows from the whole deck.
	const banks = useMemo(() => {
		const at = (slot: ImprovCard["slot"], level: number | null) =>
			cards
				.filter((c) => c.slot === slot && (level === null || c.tier === level))
				.map((c) => c.word);
		const moods = at("mood", tier);
		const roles = at("role", tier);
		return {
			moods: moods.length ? moods : at("mood", null),
			roles: roles.length ? roles : at("role", null),
		};
	}, [cards, tier]);

	useEffect(() => {
		try {
			const saved = Number(localStorage.getItem(PLAYERS_KEY));
			if (saved >= 1 && saved <= 6) setPlayers(saved);
		} catch {}
	}, []);
	const changePlayers = (delta: number) =>
		setPlayers((p) => {
			const next = Math.min(6, Math.max(1, p + delta));
			try {
				localStorage.setItem(PLAYERS_KEY, String(next));
			} catch {}
			return next;
		});

	const timer = useRef<ReturnType<typeof setInterval> | null>(null);
	const spin = useCallback(() => {
		if (timer.current) clearInterval(timer.current);
		const settle = () =>
			setCombos((prev) =>
				Array.from({ length: players }, (_, i) => ({
					mood: pick(banks.moods, prev[i]?.mood),
					role: pick(banks.roles, prev[i]?.role),
				})),
			);
		const reduce = window.matchMedia?.(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (reduce) {
			settle();
			return;
		}
		setSpinning(true);
		const started = Date.now();
		timer.current = setInterval(() => {
			setCombos(
				Array.from({ length: players }, () => ({
					mood: pick(banks.moods),
					role: pick(banks.roles),
				})),
			);
			if (Date.now() - started >= SPIN_MS) {
				if (timer.current) clearInterval(timer.current);
				timer.current = null;
				settle();
				setSpinning(false);
			}
		}, TICK_MS);
	}, [banks, players]);
	useEffect(
		() => () => {
			if (timer.current) clearInterval(timer.current);
		},
		[],
	);

	// First spin on mount and whenever the level or player count changes.
	useEffect(() => {
		spin();
	}, [spin]);

	const stepTier = useCallback(
		(delta: 1 | -1) => {
			const next = levels[levelPos + delta];
			if (next !== undefined) setTier(next);
		},
		[levels, levelPos],
	);
	const stage = useRef<HTMLDivElement>(null);
	useSwipe(stage, { onHorizontal: spin, onVertical: stepTier });

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
			const map: Record<string, () => void> = {
				" ": spin,
				Enter: spin,
				ArrowRight: spin,
				ArrowLeft: spin,
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
	}, [spin, stepTier]);

	useEffect(() => {
		document.documentElement.classList.add("game-open");
		return () => document.documentElement.classList.remove("game-open");
	}, []);

	return (
		<section
			className="game improv"
			data-tier={tier}
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
					<Menu size={24} aria-hidden="true" />
				</button>
				<fieldset className="improv-players" aria-label="Players">
					<button
						type="button"
						className="game-icon"
						aria-label="Fewer players"
						disabled={players <= 1}
						onClick={() => changePlayers(-1)}
					>
						<Minus size={20} aria-hidden="true" />
					</button>
					<span aria-live="polite">
						{players} {players === 1 ? "player" : "players"}
					</span>
					<button
						type="button"
						className="game-icon"
						aria-label="More players"
						disabled={players >= 6}
						onClick={() => changePlayers(1)}
					>
						<Plus size={20} aria-hidden="true" />
					</button>
				</fieldset>
				<span className="game-status">Level {tier}</span>
			</div>

			{menu && (
				<div className="game-menu" role="dialog" aria-label="Pick a game">
					<DeckPicker
						links={[
							...decks.map((d) => ({
								href: deckPath(d.deck),
								name: d.name,
								current: d.deck === deck.deck,
							})),
							{ href: "/favourites/", name: "Favourites" },
							{ href: "/spin/", name: "Spin" },
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

			<div className="game-stage improv-stage" ref={stage}>
				<button
					type="button"
					className={`improv-board${spinning ? " spinning" : ""}`}
					aria-label="Spin"
					aria-live={spinning ? "off" : "polite"}
					onClick={spin}
				>
					{combos.map((c, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional by player
						<div className="improv-row" key={i}>
							{players > 1 && (
								<span className="improv-player">Player {i + 1}</span>
							)}
							<span className="improv-mood">{c.mood}</span>
							<span className="improv-role">{c.role}</span>
						</div>
					))}
				</button>
			</div>

			<div className="game-nav improv-nav">
				<button
					type="button"
					className="game-icon"
					aria-label="Lighter level"
					disabled={levelPos <= 0}
					onClick={() => stepTier(-1)}
				>
					<ChevronUp size={24} aria-hidden="true" />
				</button>
				<button
					type="button"
					className="game-icon improv-spin"
					onClick={spin}
					disabled={spinning}
				>
					<RefreshCw size={22} aria-hidden="true" /> Spin
				</button>
				<button
					type="button"
					className="game-icon"
					aria-label="Stranger level"
					disabled={levelPos >= levels.length - 1}
					onClick={() => stepTier(1)}
				>
					<ChevronDown size={24} aria-hidden="true" />
				</button>
			</div>
		</section>
	);
}
