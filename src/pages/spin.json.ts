// The Spin pool as one static JSON file, built once. Inline on the page it was
// 1.3 MB of HTML-escaped props for 1,300 cards; as a fetched asset it is a
// third of that and gzips to a fraction, and the home page stays light.
import type { APIRoute } from "astro";
import { spinPool } from "../common.ts";

export const GET: APIRoute = () => {
	const { cards, links } = spinPool();
	return new Response(JSON.stringify({ cards, links }), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
};
