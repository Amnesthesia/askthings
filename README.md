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
| Fast Friends | question | 3 sets of 24 (Aron's 36 plus new questions in the same register), 12 dealt per set | live |
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

Questions sound like a curious person talking — the register of Anthony Bourdain or Studs
Terkel: blunt, unsentimental, about how people actually live. Plain words, specific, one
question per card. No "delve", "journey", "unpack",
no stacked clauses, no therapy vocabulary, no "What's one thing…" templates. A card
invites a story or an admission, not a fact.

- Bad: *What is a belief you hold that has significantly shaped your worldview?*
- Good: *What did you believe for a long time that turned out to be wrong?*

## Defining a game

`decks.yml` is the source of truth for every deck: name and blurb, `kind` (`question` |
`pair` | `dilemma`), how the game flows (`play`), and how the pipeline grows it
(`generation` brief, counts, per-tier guidance and target intensity). `pnpm sync` writes the
site-facing part into `content/{deck}.json`, preserving cards; a missing file is created
empty and stays off the site until it has cards. Adding a game is a block in `decks.yml`
plus `pnpm sync`, then `pnpm generate <deck>`.

```yaml
play:
  order: free          # sequential (file order, no shuffle) | random (shuffled on open) | free
  cardsPerTier: null   # deal at most this many per level per session; null = all
  howToPlay:           # shown on the deck page and behind the game's menu
    - "Whoever draws the card answers first, then asks it back."
generation:
  candidatesPerTier: 25   # asked per provider per tier per call
  publishPerRun: 12       # each run publishes up to this many of the best-ranked per level; no ceiling
  wholeRun: false         # true = one complete run per provider, kept or dropped whole (21 Questions)
  brief: |                # what a card IS, the mechanic, hard rules, exemplars
  models:                 # optional per-provider model override for this deck
    anthropic: claude-sonnet-5
```

## Content model

One JSON file per deck under `content/`, committed. The slug equals the filename.

```json
{
  "deck": "inquisitives",
  "name": "Inquisitives",
  "blurb": "Questions for skipping small talk. …",
  "kind": "question",
  "play": { "order": "free", "cardsPerTier": null, "howToPlay": ["…"] },
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

- `/` — opens straight into the first game (the decks list is underneath for crawlers).
- `/{deck}/` — the whole deck as plain HTML, grouped by level. This is the SEO surface and
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

## Generation pipeline

```
pnpm sync                      decks.yml -> content/*.json (metadata + play; cards kept)
pnpm generate [deck,...]       12-card calls per (deck, level, provider) until the level holds 3x its target
pnpm deduplicate  [deck,...]   exact + Dice, then each card's nearest neighbours to a judge
pnpm rate     [deck,...]       rubric scores 1-5 + judged intensity; keep conversation>=3 && voice>=4
pnpm safety   [deck,...]       the gate: only a positive "ok" passes
pnpm rank     [deck,...]       comparative order of the survivors within a level; publish sorts by it
pnpm publish-cards [deck,...]  safe candidates -> content/{deck}.json, best-ranked first, publishPerRun per level per run
pnpm calibrate [read|measure]  50-card set for a human keep/cut pass; measure = judge agreement with it
pnpm rerate   [deck,...]       re-judge published cards + live candidates with the current rubric, in place
```

Each rated card carries nine 1–5 scores (conversation, intellectual, emotional, depth, voice,
escapability, specificity, exposure cost, revealed-not-stated) and five categorical facets
(target, time, subjects, relational frame, answer shape), all judged by the rater and all
filterable at `/questions/`; Spin filters on subject, shape and frame.

Run on demand from the `Generate` workflow (`workflow_dispatch`, never scheduled) or
locally with keys in `.env`. Additive: existing cards are never removed. Every rejection is
persisted with its stage and reason in `data/rejected/{deck}.jsonl`; candidates and their
status in `data/candidates/{deck}.jsonl`; per-run spend in `data/runs/`.

Every model call goes through `src/llm.ts`: one concurrency limiter, 429 backoff honouring
`Retry-After`, a response cache keyed by content hash + prompt version (`data/_cache/`,
gitignored), and hard budgets: `MAX_USD_PER_PROVIDER` (default 5), `MAX_USD` (12),
`MAX_CALLS` (300). Spend is printed per stage and provider at exit, including on Ctrl-C.

**Cost.** `LLM_MODE=batch` (the default) sends each stage's requests through the providers'
half-price tiers: Anthropic Message Batches, Gemini Batch API, OpenAI flex. Results take
minutes to (rarely) hours; the run waits. `LLM_MODE=live` makes synchronous calls at list
price for smoke tests. Prompts put the stable system text first so Anthropic
(`cache_control`), OpenAI (`prompt_cache_key`) and Gemini prefix caching all hit.

Models: generation on `claude-opus-5`, `gemini-3.1-pro-preview`, `gpt-5.6-sol` (override
`GEN_MODEL_ANTHROPIC` / `GEN_MODEL_GEMINI` / `GEN_MODEL_OPENAI`); dedupe + rating on
`gemini-3.8-flash` (`RATE_MODEL`); the safety gate on `claude-sonnet-5` (`SAFETY_MODEL`).
Providers: `PROVIDERS=anthropic,gemini` allowlist, `DISABLE_PROVIDERS=openai` denylist; a
named provider without its key is an error, an unnamed one is skipped with a warning.

Smoke test one deck for cents:

```sh
LLM_MODE=live PROVIDERS=anthropic PER_TIER=5 MAX_USD=1 pnpm generate would-you-rather
pnpm deduplicate would-you-rather && pnpm rate would-you-rather && pnpm safety would-you-rather
pnpm publish-cards would-you-rather
```

## Game mode

`/spin/` is a slot machine over every question: filters (decks, exposure range, minimum
scores) set the pool, spin draws one; filters persist in the browser.

The heart on any card stars it. `/favourites/` plays every starred card from every deck as one
game, grouped into levels by exposure. Favourites live in the browser (localStorage); the page
is `noindex`.

With JavaScript, every deck page is a game: the whole screen is the level's colour, the card
is white and bold, chevrons sit at the four edges. Swipe or arrow left/right for the next
card in the level, up/down to change level; the hue drifts slightly with your position in
the level. Shake (or the menu's Shuffle) reshuffles and returns to the start of the level.
The menu icon folds down a bar of the other games plus Share and "Read as list". The URL
always names the current card. Touch events only, drift cancels; reduced motion respected.

## Layout

```
decks.yml             every deck: metadata, play settings, generation brief
src/                  Node pipeline + Astro routes
  shared.ts           types and helpers shared with the browser — no node: imports
  common.ts           pipeline helpers (ids, validation, loading); re-exports shared.ts
  decks.ts, sync.ts   decks.yml -> content JSON
  llm.ts              THE metered model wrapper (limiter, budgets, cache, batch mode)
  providers/          anthropic, gemini, openai adapters + selection
  prompts.ts          every prompt and schema; PROMPT_VERSION per stage
  generate/dedupe/rate/safety/publish.ts   the stages
  validate.ts         pnpm validate
  layouts/Base.astro  the one <head>
  components/         CardBody (one card by kind), DeckMenu (the switcher)
  pages/              /, /[deck]/, /[deck]/[card]/, 404
app/                  React islands (GameDeck), hooks (swipe, shake, theme), styles
content/{deck}.json   the decks — the site's input
data/                 candidates, rejections, run records (committed); _cache (ignored)
public/               CNAME, robots.txt, favicon
.github/workflows/    check, deploy, generate (manual)
```
