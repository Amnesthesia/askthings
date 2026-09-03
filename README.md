# askthings.lol

Conversational games, conversation starters and thought experiments: things two or more
people use to have a better conversation than they otherwise would. A static site built
from committed JSON decks. The site never calls a model at runtime.

Sibling of [eventyr](../eventyr) (dothings.lol) and mirrors its architecture: generated
content committed as JSON, an Astro static build over it, React only where interaction
demands it, every model call through one metered wrapper.

## Decks

| Deck | Shape | Tiers | Status |
|---|---|---|---|
| Inquisitives | question | 4 — Openers, Unguarded, Vulnerable, Intimate | hand-authored fixture, 40 cards |
| Never Have I Ever | question (statement) | 4 — Harmless → Spicy | planned |
| Fast Friends | question | 3 sets of 12 (the Aron procedure, original questions) | planned |
| 21 Questions | question, ordered | 1 run of 21 | planned |
| Would You Rather | pair `{a, b}` | 3 — Playful, Revealing, Uncomfortable | planned |
| Thought Experiments & Moral Dilemmas | dilemma | 3 — Puzzling, Uncomfortable, Personal | planned |
| Closeness deck | question | 3 — Surface, Current, Depth | planned; name TBD |

The closeness deck is the escalating-intimacy card format with a name of our own and
entirely original questions. Candidate names: **Undercurrent** (recommended), Thin Ice,
Nearer, Say It Anyway, Inner Weather, Deep End. It is never named after, and never copies
questions from, "We're Not Really Strangers": that is a registered trademark of a commercial
card game and its card text is copyrighted. The mechanic is free; the branding and the words
are not.

### Tiers

Every card carries an `intensity` 1–4 on one global scale, so cards can be filtered across
decks. A deck declares its own tiers (3 or 4), each a deck-local `level`. **The site shows
only "Level 1", "Level 2"…** — tier names and descriptions live in the JSON for the
generation prompts and are never rendered; players read the theme of a level themselves.

1. **Openers** — low stakes. Curiosity-sparking questions a near-stranger can answer
   comfortably that reveal taste, perspective or a small story.
2. **Unguarded** — personal but unguarded. Opinions, preferences, light-but-formative
   experiences, how someone sees the world.
3. **Vulnerable** — values, fears, regrets, identity, what someone is working through.
   Needs rapport and mutual disclosure.
4. **Intimate** — mortality, meaning, the rarely-said, and how someone feels about the
   person across from them.

### Voice

Questions sound like a curious person talking — the register of Terry Gross or Louis
Theroux. Plain words, specific, one question per card. No "delve", "journey", "unpack",
no stacked clauses, no therapy vocabulary, no "What's one thing…" templates. A card
invites a story or an admission, not a fact.

- Bad: *What is a belief you hold that has significantly shaped your worldview?*
- Good: *What did you believe for a long time that turned out to be wrong?*

## Content model

One JSON file per deck under `content/`, committed. The slug equals the filename.

```json
{
  "deck": "inquisitives",
  "name": "Inquisitives",
  "blurb": "Questions for skipping small talk. …",
  "kind": "question",
  "ordered": false,
  "tiers": [
    { "level": 1, "name": "Openers", "description": "Easy to answer, hard to answer boringly." }
  ],
  "cards": [
    {
      "id": "e50bb24bdb",
      "tier": 1,
      "intensity": 1,
      "text": "What do you like to learn about?",
      "tags": ["curiosity"],
      "origin": null,
      "gen": null,
      "scores": { "conversation": null, "intellectual": null, "emotional": null,
                  "depth": null, "voice": null, "rated": null }
    }
  ]
}
```

- `kind` is per deck: `question` cards have `text`; `pair` cards have `a` and `b`;
  `dilemma` cards have `title`, `setup`, `dilemma` and 2–3 `probes`.
- `id` is the card's frozen identity: the first 10 hex chars of
  `sha256("<deck>|<normalised headline>")`, assigned once when the card enters `content/`
  and never recomputed, so a typo fix keeps the URL. Pinned by `src/common.test.ts`.
- `origin` names a canonical source ("Philippa Foot, 1967"); `null` means original.
- `gen` is provenance (`provider`, `model`, `prompt` version, `at`); `null` means
  hand-authored.
- `scores` are 1–5 or `null` until the `rate` stage has run; `rated` records what rated them.
- Hand-authored cards may omit `id`, `origin`, `gen` and `scores`; `pnpm validate` fills them.

Types live in `src/shared.ts`; the validator in `src/common.ts`. `src/content.test.ts`
loads every deck, so bad content fails `pnpm check`.

## URLs

All URLs end in a slash: Astro writes `<path>/index.html` and GitHub Pages redirects the
slash-less form.

- `/` — the decks.
- `/{deck}/` — the whole deck as plain HTML, grouped by tier. This is the SEO surface and
  what link-preview crawlers see; game mode is a layer on top of it.
- `/{deck}/{id}/` — one card, with its own `og:title`, `og:description` and
  `Question`/`CreativeWork` JSON-LD, so a shared link previews as that card.
- `/sitemap-index.xml` — generated by `@astrojs/sitemap`.

## Running locally

```sh
pnpm install          # also installs the pre-commit hook (runs pnpm check)
pnpm dev              # http://localhost:4321
pnpm validate         # validate content/*.json, assign ids to new hand-written cards
pnpm check            # both typechecks + biome + tests — what CI runs
pnpm build            # static site into dist/
```

Node 22 (`.tool-versions`), pnpm 9.

## CI and deploy

- `check.yml` runs `pnpm check` on every pull request and push to `main`.
- `deploy.yml` runs `pnpm check`, then builds with `withastro/action` and deploys to
  GitHub Pages (source: GitHub Actions). It also runs after the `Generate` workflow, because
  a push made with `GITHUB_TOKEN` does not fire `push` workflows.
- Custom domain: `public/CNAME` is `askthings.lol`. DNS for the apex must point at GitHub
  Pages (A records 185.199.108.153, .109.153, .110.153, .111.153, or an ALIAS/ANAME to
  `amnesthesia.github.io`).

## Generation pipeline (planned; see CLAUDE.md for the design)

`generate → dedupe → rate → safety → publish`, each a `pnpm <stage>` script, run on demand
from the `Generate` workflow (`workflow_dispatch`, never scheduled). Additive: existing cards
are never removed. Every model call goes through one metered wrapper with a hard budget of
$5 per provider per run. Rejections are persisted with their reason under `data/`.

## Layout

```
src/                  Node pipeline + Astro routes
  shared.ts           types and helpers shared with the browser — no node: imports
  common.ts           pipeline helpers (ids, validation, loading); re-exports shared.ts
  validate.ts         pnpm validate
  layouts/Base.astro  the one <head>
  components/         CardBody (one card by kind), DeckMenu (the switcher)
  pages/              /, /[deck]/, /[deck]/[card]/, 404
app/                  React islands, hooks, styles (styles.css is the token layer)
content/{deck}.json   the decks — the site's input
public/               CNAME, robots.txt, favicon
.github/workflows/    check, deploy
```
