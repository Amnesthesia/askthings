// pnpm sync — decks.yml -> content/{deck}.json (metadata and play settings;
// cards preserved, missing files created empty).
import { syncDecks } from "./decks.ts";

const changed = syncDecks();
console.log(
	changed.length
		? `synced: ${changed.join(", ")}`
		: "content already matches decks.yml",
);
