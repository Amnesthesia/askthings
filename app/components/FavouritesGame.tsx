import { useEffect, useState } from "react";
import {
	type FavouriteCard,
	favouritesDeck,
	loadFavourites,
} from "../utils/favourites.ts";
import DeckPicker from "./DeckPicker.tsx";
import GameDeck, { type DeckLink } from "./GameDeck.tsx";

/** The Favourites game: reads localStorage after mount (nothing to render on
 * the server), rebuilds the deck whenever a star is toggled. */
export default function FavouritesGame({ decks }: { decks: DeckLink[] }) {
	const [list, setList] = useState<FavouriteCard[] | null>(null);
	useEffect(() => {
		const refresh = () => setList(loadFavourites());
		refresh();
		window.addEventListener("favourites-changed", refresh);
		return () => window.removeEventListener("favourites-changed", refresh);
	}, []);
	if (list === null) return null;
	if (list.length === 0) {
		// Nothing starred yet: the screen becomes the deck picker, one colour
		// column per game (cycling the four level colours), tap to play.
		return (
			<section
				className="game game-empty-state"
				data-tier={1}
				aria-label="Favourites"
			>
				<p className="game-empty-note">
					No favourites yet. Star a card in any game and it will show up here,
					grouped by level.
				</p>
				<DeckPicker
					links={decks.map((d) => ({ href: `/${d.deck}/`, name: d.name }))}
				/>
			</section>
		);
	}
	// Remount on every change so GameDeck's initial order reflects the new set.
	return (
		<GameDeck
			key={list.map((c) => c.id).join(",")}
			deck={favouritesDeck(list)}
			decks={decks}
			linkable={false}
		/>
	);
}
