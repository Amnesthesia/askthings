# askthings.lol

Static site of conversational games, conversation starters and thought experiments. Sibling
of `../eventyr` (dothings.lol): same architecture — generated content committed as JSON, an
Astro 6 static build over it, React 18 islands only where interaction demands, every model
call through ONE metered wrapper. The unit is the deck (a game); there is no city concept.

Read README.md for the content model, URLs and how to run. This file holds the rules and the
design decisions that must survive into later sessions.

## Build order

1. ✅ Skeleton: Astro + React + tokens, `pnpm check` green in CI, deploy to Pages.
2. ✅ `content/` schema, Inquisitives hand-authored (10 cards per tier), no-JS list rendering,
   per-card pages, sitemap.
3. ✅ Game mode over the list (see below).
4. ✅ Generation pipeline, all three providers, batch mode.
5. ✅ Dedupe, rating, safety gate.
6. The remaining decks: run the `Generate` workflow (or the stages locally) per deck and
   review what lands.

## Stack (deliberate — do not swap)

pnpm · Astro 6 `output: "static"` · @astrojs/react · React 18 · @astrojs/sitemap ·
@picocss/pico via SCSS (`app/pico.scss`) plus our own CSS custom-property token layer
(`app/styles.css`) · lucide-react · TypeScript · Biome · tsx · Node's built-in test runner
(no jest/vitest) · @google/genai, @anthropic-ai/sdk, openai (added at step 4) · js-yaml
(step 4). Deliberately NOT used: got-scraping, robots-parser, chrono-node, he — those exist
in eventyr only because it scrapes HTML and parses human dates.

Two tsconfigs, and the split is load-bearing: `tsconfig.json` is the browser side (`app/`,
`src/pages`, `src/layouts`); `tsconfig.scripts.json` is the Node pipeline (`src/`).
`pnpm check` = both typechecks + `biome check` + `pnpm test`. CI runs exactly that; nothing
merges red. The pre-commit hook runs it too.

## Content model

`decks.yml` is the source of truth (metadata, `play` settings, `generation` brief and per-tier
guidance/intensity); `pnpm sync` writes the site-facing part into `content/{deck}.json`, cards
preserved. Edit the yml, never the JSON metadata. See README. Key points: flat `cards[]` with a `tier` field (not nested under tiers); deck-level
`kind` discriminator (`question` | `pair` | `dilemma`); every card has `intensity` 1–4 on the
global scale, `tags`, `origin` (canonical source or null), `gen` (provenance or null for
hand-authored), `scores` (always present, nulls until rated). Types in `src/shared.ts`,
validator in `src/common.ts`, `pnpm validate` assigns ids and fills bookkeeping fields for
hand-written cards. Reserved slugs: `questions`, `about`, `404`. `play.order` is
`sequential` | `random` | `free`; `play.cardsPerTier` deals a subset per session. A deck with
no cards is skipped by the site (`publishedDecks()`).

### Tiers

Global intensity scale, shared by every deck: 1 Openers, 2 Unguarded, 3 Vulnerable,
4 Intimate (definitions in README). A deck declares its own tiers with deck-local `level`s;
a card's `intensity` is per card and may differ from its tier's position (Fast Friends set 2
holds intensity-2 and intensity-3 cards). Fast Friends is the one deck that carries a
published list verbatim, by decision (2026-09-04): Aron's 36 are a research instrument. Tier colour comes from `level` via CSS, never from
JSON. Colour is never the only carrier: "Level n" is always written out.

**The UI never names a level.** Players see "Level 1", "Level 2"… and nothing else — no
"Intimate", no description. The theme of a level is theirs to read, and it differs between
decks. Tier `name` and `description` exist in the JSON for the generation prompts only.

### Voice (applies to hand-written cards AND every generation prompt)

Plain, curious, specific — Anthony Bourdain / Studs Terkel (changed from Terry Gross / Louis
Theroux on 2026-09-04): blunt, unsentimental, about how people actually live, no uplift. One
question per card. Banned:
"delve", "journey", "unpack", "tapestry", "What's one thing…", "in what ways", stacked
clauses, therapy vocabulary, questions that ask for a fact instead of a story or an
admission. Bad: "What is a belief you hold that has significantly shaped your worldview?"
Good: "What did you believe for a long time that turned out to be wrong?"

### The closeness deck

Escalating-intimacy card format, three levels (working name **Undercurrent**: Surface /
Current / Depth), a name of our own and 100 % original questions. Never name it after, or
copy questions from, "We're Not Really Strangers": registered trademark of a commercial card
game, copyrighted card text. The mechanic is free; the branding and the words are not. Put
this sentence in that deck's generation brief.

## Game mode

The whole screen is the level's colour (`--game-1..4`, white text >= 4.5:1 across the
±14° hue drift, tested), the card is white and bold, four edge chevrons, a menu icon that
folds down a bar of the other games. `/` opens straight into the first published deck.
Cards are thrown out in the direction of travel, tipping as they go, and the next lands from the other side (320ms, `SLIDE_MS`). Shake to shuffle; shuffle
returns to the start of the level. Past the last card of a level the next swipe opens the
next level. A heart stars the card into localStorage; `/favourites/` is a synthetic mixed
deck (`FavouritesGame`, `linkable={false}`, cards carry their own `kind`). Horizontal swipe = next/previous card in the tier;
vertical swipe = jump tiers. Desktop: arrow keys on the same axes, visible level indicator
("Level 2", never the name) and position ("7 / 12"), and an option to show all tiers at once, one card each. The URL reflects
the current card (`/{deck}/{id}/`) so any position is linkable and back/forward work.
`prefers-reduced-motion` respected. Touch targets ≥ 44px. The gesture must not fire on a
scroll — cancel on drift, and don't bind mouse events at all.

`/spin/` (`SpinGame`) is a slot machine over every deck except improv (word banks) and Never
Have I Ever (statements that only work as that game; `EXCLUDED` in `spin/index.astro`):
filters (decks as an exclusion list, Thought Experiments out by default because a read-aloud
scenario is a different evening from a one-line question; exposure range; minimum
conversation/depth; subject, answer shape, frame) set the pool and persist in localStorage;
spin draws one card. `/spin/` is a reserved slug.

**`assumesHistory`** (card field, optional): true when a card only makes sense between two
people with a history together ("What do you blame me for that you chose yourself?"); false
for anything two people who met tonight could ask, even if it says "me" ("What do you like
about me?", first impressions, this evening). Declared by the writer (generate schema),
judged fresh by the rater (its verdict wins), written by publish; the pre-existing corpus was
backfilled by the same judge. Never inferred from the text with a pattern: a pronoun test
flags exactly the first-evening cards that are fine. Spin includes them by default with a
checkbox to drop them for a table of near-strangers; inside their own deck (Unaskable L4,
Undercurrent) they are the point.
The definition is one string, `ASSUMES_HISTORY` in `prompts.ts`, shared by every prompt.

The deck switcher is `src/components/DeckMenu.astro`, a native `<details>`: on a phone it is
the ONLY persistent chrome, a corner button that opens the deck list as an overlay. Switching
game never leaves the full-screen card or adds a nav bar. Reuse that element; do not add a
second menu.

**The whole deck exists in the static HTML.** Game mode is a presentation layer over the
list in `src/pages/[deck]/index.astro`, which is the entire SEO surface and what unfurl
crawlers (no JavaScript) see. Enhance the list; never replace it. Every card also has its own
pre-rendered page with its own `og:title`/`og:description` and JSON-LD.

## Generation pipeline design (steps 4–5)

`generate → dedupe → rate → safety → rank → publish` (`pnpm generate | deduplicate | rate | safety | rank | publish-cards`; "dedupe" and "publish" alone are pnpm built-ins), run ON DEMAND from
`.github/workflows/generate.yml` (`workflow_dispatch`; never a `schedule`). Additive: the
pipeline never deletes committed cards. Every stage is resumable; every rejection is persisted
with its reason. Absolute scores (`rate`) decide the gate; the comparative `rank` pass decides
which survivors publish, because everything that passes sits at voice 4–5.

**Oversupply by many small calls, never longer ones.** Over 5,030 rated cards, positions 20–24
of a 25-card response scored below positions 0–4 on every axis (voice 4.19 → 4.11,
conversation 3.75 → 3.60, gate failures 21% → 25%). So `candidatesPerTier` is the size of ONE
call (12 for question decks) and `generate` issues as many calls per (deck, level, provider)
as it takes for the level to hold `oversupply` × `targetPerTier` (default 3) unrejected
candidates; each call's prompt names its call number, which spreads subjects and gives it its
own cache key. A level already over its oversupply asks for nothing.

### Batch mode

`LLM_MODE=batch` is the default: every uncached request of a stage goes out as one
Anthropic Message Batch / Gemini Batch job (half price, polled until it ends) and OpenAI
requests use `service_tier: "flex"` (half price). Prompt caching is on for all three
(`cache_control` on the system block, `prompt_cache_key`, Gemini implicit). `LLM_MODE=live`
for smoke tests. Stages call `callJsonMany`, never one call per card.

### Hard cost rule

**No provider may spend more than $10 in one run.** Enforced by the wrapper from a per-model
price table (`src/pricing.ts`, prices verified 2026-09-03), accumulated per provider:
`MAX_USD_PER_PROVIDER` (default 10) stops that provider, `MAX_USD` (default 25) stops the run,
`MAX_CALLS` (default 1000) is the count backstop. Raised from 5 / 12 on 2026-09-04 when
oversupply became the default (one 25-per-level pass over six decks measured $4.89). Rerunning `generate` after a killed run is a fresh spend, not a cache hit: the avoid-list moved with the candidates the first run flushed, so every prompt differs. A full run of every deck is estimated at
≈ $5 total (Anthropic ≈ 2.3, Google ≈ 1.3, OpenAI ≈ 1.4); the run report prints measured $
per provider so the estimate is corrected by data.

### Models ($/1M in/out)

Generation, one flagship per provider (voice variety is the product):
`claude-opus-5` 5/25 (`output_config.effort: "medium"`, adaptive thinking, no `temperature`
— sampling params are rejected on the 5-family); `gemini-3.1-pro-preview` 2/12
(`responseJsonSchema`); `gpt-5.6-sol` 4/20 (structured outputs, strict). Cheaper fallbacks via
`GEN_MODEL_<PROVIDER>`: `claude-sonnet-5`, `gemini-3.8-flash`, `gpt-5.6-terra`.

Judging, one model per stage so scores are comparable: dedupe tiebreak + `rate` on
`gemini-3.8-flash` (0.75/3.75, thinking off; `RATE_MODEL`); `safety` on `claude-sonnet-5`
(2/10, effort low; `SAFETY_MODEL`) — the gate gets the stronger reader.

### Token cost reduction, in priority order

1. Cacheable prefix: `[system]` = site purpose + tier definitions + style guide with 8
   good/bad pairs + kind schema (byte-identical per stage; Anthropic `cache_control` on it),
   then `[user]` = deck brief, tier, avoid-list, N.
2. Deterministic shape checks before any paid judging: > 30 words, more than two questions
   in one card, ≥ 2 em-dashes, missing terminal punctuation, per-kind shape. No phrase list:
   word bans were tried and removed (2026-09-04) as too blunt; wording is the rater's call; normalised-exact and Dice ≥ 0.85 dedupe. Then the `NEAREST`
   (5) accepted texts of every survivor go to the judge (`dedupeAgainst`, shared by the stage
   and maintenance passes). Not a band: character-bigram Dice scored "faked a phone call to
   escape a fundraiser" against "pretended my phone rang to get out of a conversation" at
   0.39, and a 0.60 floor published "said I love you without meaning it" three times. Dedupe
   compares `dedupeText`: the dilemma + setup for dilemmas (a title is a label), and questions
   with the deck-wide opener ("Never have I ever") stripped, which otherwise inflates every
   pair in that deck above 0.5.
3. Batch judging: 30 candidates per call, echoed numeric `index`, results keyed by index.
4. Avoid-list = normalised headlines only, capped at 150 per tier.
5. Cache by `sha256(provider|model|PROMPT_VERSION|system|user)` in `data/_cache/`
   (gitignored); candidates flushed to `data/candidates/{deck}/{provider}.jsonl` (committed)
   after every call.
6. Not now: provider Batch APIs (50 % off). Add when a run exceeds ~$50.

### Quality levers

Oversupply and select: many 12-card calls until a level holds 3× its target (see the pipeline
section), then `rank` orders the survivors and publish keeps the top. Writer self-rates
`intensity`; code drops cards > 1 step from the requested tier; `rate` re-assigns tier from
the judge. Rubric 1–5: `conversation`, `intellectual`, `emotional`, `depth`, `voice`, and
(`rate@5`, 2026-09-04) `escapability` (how easy a polite non-answer is; LOW is good, the proxy
for depth that catches profound-sounding questions that produce nothing), `specificity`
(concrete anchor vs abstract category), `exposureCost` (how much the honest answer reveals;
the stranger/friend/partner filter), `revealed` (value forced out of a choice or action = 5,
self-report = 1: self-report is where the flattering answers live). Keep if
`conversation ≥ 3 && voice ≥ 4`. Every judge returns a one-clause `reason`, persisted with rejections.

**Facets** (`Card.facets`, categorical, no ordering, for filtering and MIX control): `target`
(experience / position / priority / process / affect), `time` (past / present / future),
`subjects` (multi-label from work, family, money, mortality, sex, faith, failure, identity,
body, friendship, home), `relational` (solo / relational), `shape` (story / verdict / fact /
feeling). The rater returns them next to the scores; `asFacets` validates every value against
the declared list (unknown → null / dropped). Lists live in `shared.ts`; the browser and Spin
filter on them; a set of ten verdicts is a bad set whatever each card scores.

**`pnpm rerate [deck,...]`** re-judges every published card and live candidate with the
current rubric, in place (scores, intensity, `assumesHistory`, facets), never status or ids.
Run it whenever the rubric grows an axis so filters mean one thing across the corpus
(~$1 for everything). `validateDeck` treats an absent score key as unrated, so a corpus can
predate an axis until the re-rate lands.

**`rank`** (`src/rank.ts`, `rank@1`): the rater orders batches of 30 `safe` candidates within
one level ("which would you rather be asked"), two rolls with different batch mates; the mean
within-batch percentile is stored as `Candidate.rank` and `publish` sorts by it (falls back to
the rubric sum for unranked cards). 423 cards cost $0.09. Nothing is rejected here.

**Victor's taste is the yardstick** (`pnpm calibrate`, `src/calibrate.ts`): 50 published cards
stratified by deck and judge score go to `data/calibration/set.md`; Victor deletes the ones he
would not keep (or prefixes `cut: reason`); `pnpm calibrate read` writes `verdicts.json`;
`pnpm calibrate measure` re-judges the 50 and prints judge–Victor agreement. Any rubric or
judge change must not lower that number. Kept cards become the briefs' exemplars.

The site offers no voice slider (Spin, the question browser): the gate keeps only cards that
sound like a person, so every published card is already high on it and there is nothing for a
player to tune.

**Voice is measured, not hoped for.** The first corpus (Sep 2026) scored voice 4–5 on nearly
everything, including "What family trait do you recognize in yourself with mixed feelings?".
Fix, in three layers, each measured on a 30-card calibration set (15 generated-sounding, 15
spoken): (1) `STYLE` names the concrete TELLS seen in real output (filler intensifiers,
"a version of you", trailing explanatory clauses, "Name the…", game-manual syntax) with
BAD/GOOD pairs taken from that output; (2) shape checks only before the judge, no word
bans (a regex list was tried and removed the same day: too blunt next to a judge that reads);
(3) `rate@2` anchors voice 5→1 on those tells and
asks for the whole scale — the same judge then passed 1/15 generated at voice ≥ 4 and all 15
spoken, where `rate@1` had passed 13/15. A deck whose FORMAT the style guide would read as a
tell (Fast Friends' "Tell your partner…", Undercurrent's "Tell me…", Thought Experiments'
read-aloud setups) says so in `generation.rateNote`, appended to the rater's user turn.
When output looks generated, tune this way: point `ASKTHINGS_DATA_ROOT` at a scratch dir,
`LLM_MODE=live PER_TIER=10`, run generate → deduplicate → rate for one deck (≈ $0.7), read
every card, edit the brief, repeat. Never tune by editing the prompt alone. The run report prints kept-per-provider; a provider that contributes nothing is
disabled, not carried.

### Per-deck prompts

One specialised brief per deck in `decks.yml` (`brief:` block), several 12-card calls per
(deck, level, provider) until the level holds its oversupply.
Each brief: what a card IS, the mechanic (write for how it is played), hard format rules code
can check, tier guidance, 3–4 exemplars in the house voice. Summaries:

- **Inquisitives** — interviewer's question to a stranger; ≤ 22 words, one question mark.
- **Never Have I Ever** (`generation.tierFrom: writer` — its levels are spiciness, not exposure,
  so the writer's level is kept rather than the judge's) — starts exactly "Never have I ever", one concrete act with a story
  behind it, ≤ 18 words, no "or". Tiers Harmless / Cheeky / Confessional / Spicy (adults,
  consensual, legal).
- **Fast Friends** — the Aron procedure (3 sets, both answer, escalating). The 36 questions
  from Aron et al. (1997) are in the deck as hand-authored cards (`origin: "Aron et al.,
  1997"`, statements turned into questions), 12 per set in the original order; generation
  adds 12 NEW cards per set in the same register (the originals are in the avoid-list and the
  dedupe pool, never reworded), ≤ 30 words, may be two-part or an instruction. A session
  deals 12 of the 24 per set: sequential decks with more cards than `cardsPerTier` deal a
  random subset in file order after hydration (`sampleOrder`).
- **21 Questions** (`generation.wholeRun: true`: each provider writes one complete run of 21,
  runs are not deduplicated against each other, and publish assembles ONE run by taking the
  best passing card at each `position` from any run) — warm → curious → personal → a closer,
  `position` echoed, no adjacent same-topic cards, ≤ 20 words. The original rule kept or
  sank a run whole; nine runs in a row were sunk by one weak card each, so the arc now lives
  in the positions and the cards are judged one by one like every other deck.
- **Would You Rather** — `a`/`b` ≤ 12 words each, parallel grammar, genuinely hard, reveals
  a value or a fear; tiers Playful / Revealing / Uncomfortable.
- **Thought Experiments** — `title`, `setup` ≤ 120 words plain, `dilemma`, 2–3 `probes`
  ("Would that change if…"), `origin`. Two variants: canonical (listed experiments retold in
  house voice, attribution in `origin`, dedupe keyed on `origin`) and original (`origin:
  null`). Tiers Puzzling / Uncomfortable / Personal, `tierFrom: writer`: the levels are topics
  with canonical experiments assigned per level, and the judge's exposure score had emptied
  level 1. Probes are scored explicitly.
- **Closeness (Undercurrent)** — L1 noticing each other, L2 the relationship, L3 what has
  gone unsaid; addressed to you/me, ≤ 20 words, may be instructions; trademark rule verbatim.
- **Unaskable** (`tierFrom: writer`, `safetyNote` opens the gate to rankings of family, relief
  at a death, contempt) — a question people want answered and would never dare ask. Two tests
  in the brief: the DINNER TEST (would the asker have to apologise first? if not it is an
  Inquisitives card) and the HEIST TEST (a withheld fact is not a discovery; the answer must
  be computed live). Levels are the distance of the target from the table, not mildness:
  L1 friends and exes, L2 family and partner, L3 yourself, L4 the person asking. Rankings are
  a tool, never a syntax: at most two imperatives per batch. The first version graded levels
  on an undefined 1–10 "prompt intensity" and asked L1 for tastes and habits, which produced
  an icebreaker deck with "Rank your three…" 15 times; the 100 cards published from it mostly
  fail the new gate and do not fit the new level axis.

Every brief ends: output only the JSON array; each item echoes its `index`; each item carries
a self-rated `intensity` 1–4.

### Workflow

`generate.yml` inputs: `decks`, `providers`, `stages`, `per_tier`, `max_usd`. Typecheck +
test before spending budget; commit `content/` + `data/`; push with a 3-attempt rebase loop
that fails loudly. Secrets `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`.
`deploy.yml` chains off it via `workflow_run` (a `GITHUB_TOKEN` push fires no `push` event).

### Wrapper (`src/llm.ts`, mirrors eventyr `src/providers/gemini.ts` + `base.ts`)

Module-level semaphore (`LLM_CONCURRENCY` default 4) shared by all providers;
`mapWithConcurrency` for batches; backoff 5 s × 2^attempt + ≤ 30 % jitter, 4 retries,
`Retry-After` honoured (SDK error headers first, message regex second); budget checked before
acquire → `BudgetExhaustedError` ("progress is saved — rerun to continue"); per-stage and
per-provider accounting printed on exit/SIGINT/SIGTERM with a `reported` guard and written to
`data/runs/<ISO>.json`; empty result → retry once, then a recorded failure (never cached as
empty); provider selection by `PROVIDERS` / `DISABLE_PROVIDERS` allow-then-deny — naming a
provider without its key throws, an unnamed keyless provider is skipped with a warning.

## Engineering rules — each one cost a real bug in eventyr

Apply these to new code in this repo.

### Module boundaries
- `src/shared.ts` must never import `node:*`. `app/` imports it directly; a filesystem-reading
  module drags `node:fs` into the Vite bundle and breaks the build.
- One import specifier per module: always the form WITH the `.ts` extension
  (`"../shared.ts"`). Two forms give Vite two module graphs and two copies of React, which
  surfaces as "Invalid hook call" nowhere near the cause. `astro.config.mjs` also dedupes
  react/react-dom/jsx-runtime — keep it.
- `src/common.ts` uses `process.cwd()` for the project root, not `import.meta.url`: Astro
  bundles it into `dist/.prerender/` at build time.

### URLs
- Trailing slash on every generated URL (`deckPath`, `cardPath`, `trailingSlash: "always"`).
  Astro writes `<path>/index.html`; GitHub Pages 301s the slash-less form.
- One frozen identity hash per card (`cardId`), the basis of its share URL and any feed id.
  Pinned in `src/common.test.ts`. Never change the basis; it is what stops subscribers being
  re-notified about everything at once.

### Calling models
- Every call goes through ONE wrapper: process-wide limiter, 429-aware backoff honouring
  `Retry-After`, hard per-run call AND dollar budget, per-stage accounting printed at exit
  (including Ctrl-C). Per-module caps bound nothing.
- Batch, then run batches concurrently with a ceiling. Never a serial loop over independent
  work; never a bare `Promise.all` over an unbounded list.
- Cache by content hash + prompt version. Keep prompts cacheable: stable text first, variable
  payload last.
- An empty result is a failure, not an answer — retry once.
- Missing key or failed call degrades to the deterministic path with a warning. Never dies.
- Provider selection via `PROVIDERS` / `DISABLE_PROVIDERS`. Key presence is a bad switch.

### Trusting output
- A model proposes; code decides. Everything a model returns is validated against a declared
  enum or range before it is persisted.
- Prefer null over a guess. A field that cannot be established is null — never defaulted,
  inferred from a sibling, or approximated.
- Echo a numeric index through structured responses and key results by it, never by name or
  array position.
- The safety gate is a product requirement, not boilerplate: reject anything that pressures
  disclosure of illegal acts, solicits self-harm detail, targets protected characteristics,
  or is sexual content involving minors. Persist every rejection with its reason.

### Data integrity and reporting
- Fail safe, not silent: when state that gates coverage is missing or stale, assume the
  expensive branch.
- Report ratios, not totals — `generated → kept`, with reasons for the gap.
- Persist what was discarded and why, so diagnosis never needs a re-run of paid calls.
- Flush incrementally. A killed run keeps everything it proved.

### Libraries and correctness
- `Intl` for anything locale-shaped. Never hand-roll what a spec already defines.
- Measure before adding a dependency; look at the actual failing inputs first.
- Comment the why. Mark deliberate shortcuts `ponytail:` with their ceiling and upgrade path.

### Accessibility — measure, don't eyeball
- Compute contrast for every colour pair; text ≥ 4.5:1 in BOTH themes. The measured number
  sits in a comment next to the value and `app/styles.test.ts` fails if it drops.
- Colour is never the only carrier of meaning.
- Interactive things are real buttons and links, not click handlers on divs. Touch targets
  ≥ 44px.

## Key files

```
src/shared.ts            types, INTENSITIES, normaliseText, cardHeadline/Summary, deckPath/cardPath
src/common.ts            cardId, validateDeck, loadDecks (re-exports shared.ts)
src/validate.ts          pnpm validate
src/layouts/Base.astro   the one <head>; imports pico.scss + styles.css once
src/components/          CardBody.astro (card by kind), DeckMenu.astro (the switcher)
src/pages/               index, [deck]/index, [deck]/[card], 404
app/styles.css           token layer; tier hues with measured contrast
app/styles.test.ts       contrast gate
content/{deck}.json      the decks
```
