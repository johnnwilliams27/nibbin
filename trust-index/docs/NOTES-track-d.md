# Track D notes (surface)

Running log per SPEC 18.0. Owns exactly `apps/web/` and this file.

## Starting state

A prior Track D agent was terminated mid-flight. On pickup, `apps/web/`
contained: `package.json`, `next.config.ts`, `tsconfig.json`,
`vitest.config.ts`, `docs/design-plan.md` (already written, already good -
kept as-is except one correction below), and `src/lib/tokens.ts` plus three
real, valid self-hosted woff2 files under `src/fonts/`. No `src/app/` yet: no
routes, no API, no tests, no `next-env.d.ts`. Nothing was broken, just
unstarted past the config/token layer. Everything from that state was kept;
the rest was built fresh.

## What was built

**Part 1, API (D1).** All nine endpoints under `/api/v1` per SPEC 13:
`agents/:chain/:id` (+ `/feedback`, `/recompute`), `reviewers/:chain/:address`
(+ `/agents`), `stats/:chain`, `dumps`, `health`, `POST /mcp`. All go through
a `DataSource` interface (`src/lib/data-source.ts`); `FixtureDataSource`
(`src/lib/fixture-data-source.ts`) is the only working implementation,
reading `fixtures/manifest.json` and every snapshot directly off disk.
`PostgresDataSource` is a stub that throws with a `TODO(@trust-index/db)`
pointing at SPEC §9. `ApiEnvelope`/`ApiError` construction is centralized in
`src/lib/envelope.ts`; `meta.coverage_disclaimer` is set exactly when
`coverage_tier` is `none` or `thin` (tested in `test/envelope.test.ts` and
`test/api-routes.test.ts`). Rate limiting is `src/lib/rate-limit.ts`, an
in-memory token bucket behind a `RateLimiter` interface (`anonymous`: 60/min,
burst 20; `expensive`: 10/min for `/recompute` and
`/reviewers/:address/agents`, applied identically to the matching MCP tool
calls); `UpstashRateLimiter` is a stub for when real infrastructure exists.
`GET /dumps` is deliberately never rate limited (SPEC 13: "unlimited and
unauthenticated"). CORS is open on every response (`Access-Control-Allow-Origin: *`).
`POST /mcp` is a small JSON-RPC 2.0 dispatcher (`src/lib/mcp.ts`) exposing
all seven `MCP_TOOLS`, wrapping the same `ApiEnvelope` as REST.

**Scoring port** (`src/lib/scoring-port.ts`): the only module referencing
`@trust-index/scoring`. It dynamic-imports the package through a
runtime-computed specifier (not a string literal) on purpose - a literal
specifier makes both `tsc`'s `import()` type resolution and webpack's module
resolution try to resolve `packages/scoring/src/index.ts` at build time,
which does not exist yet and would fail the whole build, not just the
optional-dependency path. As of this writing `@trust-index/scoring/src/`
has every supporting module (`estimator.ts`, `weights.ts`, `tiers.ts`, etc.)
but no `index.ts`, so the import fails cleanly every time and every fixture
renders through the fallback. When it fails (or the module doesn't export a
callable `computeScore`/default), `src/lib/synthetic-estimator.ts` takes
over: a from-scratch implementation of the SPEC 11.0/11.1 shrinkage and
interval formulas in plain JS numbers (not the fixed-point path SPEC 22
requires of the real engine), with its own reasonable reading of the SPEC
11.2 reviewer-weight components. Every synthetic result carries
`signals.engine_source = "synthetic_fallback"`, and the recompute derivation
page shows a banner when a page rendered through it. **Request to Track B /
lead:** confirm the intended export shape once `index.ts` lands -
`scoring-port.ts` currently looks for a named `computeScore(snapshot)` or a
default export of the same signature; anything else will keep falling back
silently (correctly, but silently) until updated.

**Known limitation of the fallback estimator:** it is tuned for internal
consistency (bounds, monotonicity, floors) and for the two fixtures the
protocol names explicitly (`placeholder`, `unparseable-scale`, both
correctly suppressed), not for hitting every number in
`fixtures/manifest.json`'s `invariants` arrays - those are Track B's golden
targets, not a contract on this fallback. Concretely: under this fallback,
`thin-same-day-cohort`, `transferred-identity`, and `common-funder-ring` all
end up fully suppressed (`n_eff` under the 0.5 floor) rather than landing in
the fixture-authors' intended tiers, because independent down-weights
(reviewer age, cohort concentration, portfolio concentration) compound
multiplicatively exactly as SPEC 11.2 literally specifies ("weight is their
product"), and for these three fixtures the reviewers are young enough that
the product collapses fast. This is very possibly also true of the real
engine; it is not possible to tell without Track B's code. The homepage's
"thinner evidence" panel uses `bulk-reviewer` instead of
`thin-same-day-cohort` for this reason (it renders reliably non-suppressed
under the fallback). None of this affects the D1 gate, which skips outright
when the engine is absent, or D2a/D2b, which are written to discover
suppressed vs. non-suppressed fixtures at test time rather than assume which
ones land where.

**Part 2, frontend (D2).** `docs/design-plan.md` was already written per
SPEC 14.1 by the prior agent and is good: six named tokens (not the usual
four), the log-sheet register, IBM Plex Mono for every numeral, a real
critique pass with five recorded findings. Kept essentially verbatim; the
only edit was correcting "five text links" in the nav description to match
what actually shipped (three: Methodology, Stats, Dumps - see Deviations).
Built on top of it: all six SPEC 14.2 pages, the signature interval as a
real `<svg>` forest-plot band (`src/components/IntervalFigure.tsx`, CSS-only
draw-in animation gated by `prefers-reduced-motion`, no client JS anywhere
in the app), a dedicated `/agent/[chain]/[id]/recompute` derivation page,
and the suppression handling described below.

## Deviations from spec text

- **Nav link count.** SPEC 14.1's own design plan called for "five text
  links"; the actual page set (SPEC 14.2) has three static top-level pages
  (Methodology, Stats, Dumps) plus two per-record detail page types (Agent,
  Reviewer) that have no natural static nav entry. Shipped three links,
  corrected the design plan to say so.
- **Free-API-key rate tier (600/min).** SPEC 13 lists a keyed tier; this
  build has no key issuance, auth, or account system (fixture-backed, zero
  infrastructure per the Track D protocol), so every caller is anonymous.
  Documented in `src/lib/rate-limit.ts`; wiring a real tier is a
  `PostgresDataSource`-adjacent follow-up.
- **`get_proof` MCP tool.** SPEC 20 (on-chain anchoring) is Track C's
  domain and no anchor data exists in the fixture set. Rather than
  fabricate a Merkle proof, this returns `{ anchored: false, note: ... }`.
  Tested in `test/api-routes.test.ts` ("never fabricates on-chain anchoring
  data").
- **`/dumps` rows are placeholders.** No dump-generation pipeline exists
  yet (that's Track A/E territory). Rows report `row_count: 0` and
  `sha256: "pending"`, and the page marks them with an explicit
  "placeholder: not yet generated" badge rather than a fake checksum.

## D2a method (documenting per the protocol's instruction)

The suppressed-agent page is rendered for real with `react-dom/server`'s
`renderToStaticMarkup` (our Server Component pages are plain async functions
built only from our own components, so they can be invoked directly without
a running Next server). The score-bearing area of `/agent/[chain]/[id]`
carries `data-testid="score-region"`; `test/render-helpers.ts` isolates that
element's outer HTML by balanced-tag counting (regex alone cannot handle
nesting), and `test/gate-d2a-suppression.test.ts` asserts it contains no
ASCII digit whenever `score === null`. Digits are permitted, and expected,
in the separate "Evidence summary" section directly below the score region
(SPEC 14.2 does ask for an evidence summary, and that is impossible to write
with zero digits); interpreting the "no number appears anywhere on the page"
line in SPEC 14.2 as scoped to the score region itself, not the literal
whole page, is the design plan's own reading (see its critique pass, item
3) and is what the protocol's D1/D2 gate list actually asks this track to
test ("assert no digit sequence renders in the score region"). Both fixtures
the protocol names explicitly - `placeholder` and `unparseable-scale` - are
asserted by name in the test in addition to the full-fixture sweep.

## Gate results

- `pnpm --filter @trust-index/web run typecheck` - clean.
- `pnpm --filter @trust-index/web run build` - clean except one expected
  webpack warning ("Critical dependency: the request of a dependency is an
  expression") on the deliberately-dynamic `@trust-index/scoring` import;
  this is the intended shape of an optional runtime dependency, not a
  build failure. No network font requests (`next/font/local` only,
  verified by reading the build output and the font files themselves).
- `pnpm --filter @trust-index/web run test` - 53 passed, 1 skipped, 0
  failed. The skip is the D1 gate (see below).
- **D1** (`test/gate-d1-recompute.test.ts`): skips with an explicit message
  because `@trust-index/scoring` has no `src/index.ts` yet; runs and
  compares byte-for-byte (`JSON.stringify` equality against the engine's raw
  `ScoreResult`) the moment it does.
- **D2a** (`test/gate-d2a-suppression.test.ts`): passes for all ten
  fixtures; confirms `placeholder` and `unparseable-scale` are in fact
  suppressed under this build and asserts zero digits in their score
  regions.
- **D2b** (`test/gate-d2b-intervals.test.ts`): passes for every fixture the
  fallback estimator does not suppress; asserts an `<svg>` renders and its
  low/point/high numerals match the `ScoreResult` exactly.
- `node scripts/copylint.mjs` from `trust-index/` - 0 errors, 0 warnings.

## Design plan summary

Palette: six named tokens (`ink`, `paper`, `slate`, `band`, `marker`,
`hairline`), a cool grey-green "instrument enclosure" ground with a single
desaturated steel-blue accent used identically for every coverage tier -
never a verdict color, verified computationally against WCAG AA in
`test/contrast.test.ts` (which also asserts no red/green/amber hue exists in
the palette at all). Faces: IBM Plex Mono for every numeral
(`font-variant-numeric: tabular-nums` everywhere via the `.num` utility
class), IBM Plex Sans for prose and sentence-case headings, both self-hosted
through `next/font/local` with zero runtime font requests. Signature
element: a forest-plot SVG band on a 0-100 axis, point marker, `n_eff`
printed beside it in mono, drawing in from the marker on load with the
animation fully removed under `prefers-reduced-motion`; suppressed agents
never receive this element in any form.

## Requests to the lead / other tracks

- Confirm `@trust-index/scoring`'s intended public export once `index.ts`
  exists, per the scoring-port note above.
- If `fixtures/manifest.json`'s per-fixture invariants are meant to bind
  anything beyond Track B's golden tests, flag it - this track's fallback
  intentionally does not chase them all (see "Known limitation" above).
