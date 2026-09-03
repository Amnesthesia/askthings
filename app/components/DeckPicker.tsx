import type React from "react";

export interface PickerLink {
	href: string;
	name: string;
	current?: boolean;
}

/** The game picker: one full-height colour column per game, cycling the four
 * level colours. Used by the in-game menu and the empty Favourites screen. */
export default function DeckPicker({ links }: { links: PickerLink[] }) {
	return (
		<nav className="deck-columns" aria-label="Games">
			{links.map((l, i) => (
				<a
					key={l.href}
					href={l.href}
					aria-current={l.current ? "page" : undefined}
					style={
						{ "--game": `var(--game-${(i % 4) + 1})` } as React.CSSProperties
					}
				>
					<span>{l.name}</span>
				</a>
			))}
		</nav>
	);
}
