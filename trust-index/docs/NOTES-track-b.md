Track B: scoring engine

Status: complete. `pnpm --filter @trust-index/scoring run typecheck` and
`run test` both pass. Gate B1 (100% branch coverage on lifecycle.ts and
tiers.ts) holds. Gate B2 (byte-identical golden output, two-process
determinism) holds for all ten fixtures.

Continuing this track: the estimator was the most suspect module per the
handoff and it was correct as found. The two open items are the fixture
mismatches under "Fixture invariant mismatches" below and the eslint scope
request; nothing else is pending.

## What was inherited vs written

The predecessor left `src/constants.ts`, `epochs.ts`, `estimator.ts`,
`fixedmath.ts`, `hash.ts`, `lifecycle.ts`, `normalize.ts`, `tiers.ts`,
`time.ts`, `weights.ts` and an empty `bin/`, `scripts/`, `test/`. No
`src/index.ts` (the engine surface itself), no CLI, no golden files, no
tests existed; nothing had ever been run.

Read every inherited file against SPEC 5, 11 (all subsections), 12, 22, 24A
before writing anything. All ten inherited files were correct against spec
and were kept as-is, including `estimator.ts` and `hash.ts` (the two the
predecessor died mid-write on): the shrinkage formula, interval math,
anti-flooding cap, and canonical-hash field selection all check out
line-by-line against SPEC 11.0/11.1 and the inputs_hash definition in this
brief. I did not change any inherited file.

Written new: `src/signals.ts` (population-level cohort/funder signals),
`src/index.ts` (the `score()` engine surface, SPEC 22), `src/cli.ts` and
`bin/agent-trust.mjs` (UC-6), `scripts/generate-golden.ts` and
`scripts/print-canonical.ts`, all of `test/*.test.ts` (15 files, 159 tests),
and `fixtures/golden/*.json` (10 files).

## Interpretations already documented in the inherited files (carried forward, not re-litigated)

These are recorded in code comments in the files named; listed here per the
"maintain a running NOTES.md" protocol so the lead can find them without
reading every module.

- `lifecycle.ts`: an agent whose last activity is older than
  `live_window_days` but younger than `dormant_window_days` is classified
  `registered` (neither live nor dormant). SPEC 11.7 leaves this gap open.
- `normalize.ts`: a degenerate detected_scale (`max_raw <= min_raw`) is
  unusable, same as a null scale. A single observed point defines no scale.
- `weights.ts`: cohort share denominator is the total current-epoch
  reviewer count INCLUDING the reviewer itself; numerator is the count of
  OTHER reviewers within the window. Velocity comparison is strict (`>`,
  not `>=`). Repeat bonus is `repeat_bonus_multiplier^(count-1)`, capped at
  `repeat_bonus_cap`.
- `estimator.ts`: anti-flooding cap, a single reviewer's total contribution
  within one grouping (a context, or the global pool) is capped at their
  STRONGEST single decayed review, applied independently per grouping.
  (Adversarial-pass change: the cap was originally the reviewer's undecayed
  weight, which let a pile of stale reviews climb back to the full 1.0 weight
  and erase SPEC 11.4 decay. Capping at the most-recent decayed review keeps
  the one-reviewer-one-vote property while letting the ceiling decay. The
  `heavy-decay-flood` fixture locks this in.) Confidence uses the UNCLAMPED
  interval width (2 * half width); the [0,1] display clamp on
  score_low/score_high never feeds back into confidence.
- `epochs.ts`: a feedback entry in the same block as the resetting transfer
  is treated as pre-transfer (conservative: reputation laundering is the
  unrecoverable error, a false reset is not).

## New interpretations adopted while writing src/index.ts, src/cli.ts, src/signals.ts

1. **Scope: validations and commerce do not feed the weighted-sum
   estimator.** SPEC 8 explicitly says "index it, but do not build scoring
   dependencies on [the Validation Registry's] current shape," and no
   subsection of SPEC 11 gives a concrete formula for folding validations or
   raw commerce records into n_eff (11.8's "substitute for reviewer volume"
   is narrative, not a formula). Both still drive lifecycle classification
   (11.7, via last-activity) and are reported as coverage signals
   (`validation_record_count`, `commerce_corroborated_reviews`). Commerce
   already enters reviewer weighting today via
   `ReviewerSnapshot.has_commerce_with_agent` (SPEC 11.2), which is scored.
   If the lead wants validations to move n_eff directly, that needs a
   concrete formula added to SPEC 11 first; flagging as an open question
   rather than inventing one.

2. **Lifecycle's "last activity" is not epoch-scoped.** SPEC 11.7 does not
   say "current epoch"; whether an identity is an operating agent at all is
   independent of whose reputation currently counts toward its score. Uses
   the max timestamp across ALL feedback, validations, and commerce
   records, all epochs.

3. **Reviewer set for weighting/output is every current-epoch,
   non-revoked reviewer**, including ones whose only feedback has an
   uninferable scale. They get a real weight and appear in
   `reviewer_weights`, they just contribute nothing to n_eff (their
   normalized value doesn't exist). This matches "Emit per-reviewer
   components in reviewer_weights sorted by address" read as "every
   reviewer of the current epoch," not "every reviewer who cleared
   normalization."

4. **Suppression reason precedence:** `placeholder` (lifecycle) overrides
   everything; else `no_usable_feedback` when current-epoch non-revoked
   feedback exists and ALL of it is unusable; else `neff_below_floor`
   (covers both "zero feedback at all" and "some usable, still below
   0.5"). Zero feedback is distinguished from "feedback present but
   unusable" because the two SUPPRESSION_REASONS strings mean different
   things and only one of them is literally true when there is no feedback
   to begin with.

5. **Signal definitions** (all conditions, never intent, per SPEC 5.5):
   - `reviewer_cohort_same_day`: share of current-epoch reviewers that have
     at least one OTHER current-epoch reviewer within `cohort_window_hours`
     of their own `first_seen_ts`. An agent-level population statistic,
     recomputed independently in `signals.ts` rather than derived from the
     per-reviewer `cohort` multiplier in `weights.ts`, so that module stays
     focused on producing a weight and this one on a population signal.
   - `common_funder_share`: same shape, for a shared non-null
     `funder_address`.
   - `distinct_counterparties`, `feedback_span_days`: the GLOBAL group's
     values (same numbers used for the top-level coverage tier decision).
   - `pre_transfer_reputation_excluded`: `ownership_epoch > 0`.
   - `ownership_transferred_at`: the last resetting transfer's `ts`, or
     `null` when the epoch was never reset (including when only benign
     custody migrations occurred).
   - `custody_migration_detected`: as computed in `epochs.ts`.
   - `commerce_corroborated_reviews`: count of current-epoch reviewers with
     `has_commerce_with_agent === true`.
   - All ten SIGNAL_KEYS are always emitted, with neutral defaults (0,
     false, null) rather than omitted when not applicable. `signals` is a
     `Record`, and "conditions only, never intent" reads as being about
     what the VALUES say, not about a sparse shape; a stable key set is
     easier for downstream consumers (API, oracle encoder) to rely on.

6. **Context-level suppression** uses only the `n_eff < floor` test (a
   `ContextScore` has no `suppression_reason` field to hold a distinct
   reason); a placeholder lifecycle forces every context suppressed too via
   the same `forceSuppressed` flag passed into `scoreGroup`.

7. **Display rounding**: `score`/`score_low`/`score_high` are
   `mean * 100` rescaled from INNER (12) decimal places to `PRECISION.score`
   (2) with round-half-up, i.e. exactly "multiply the [0,1] posterior by 100,
   then round," per "Display scale 0-100 at PRECISION.score" (SPEC 11.1).

8. **`priors.by_context` fallback**: an observed `tag1` absent from
   `priors.by_context` uses `priors.global`, per the `PriorSet` doc comment
   in `packages/types/src/snapshot.ts` ("Fall back to global when a context
   is absent").

9. **`effective_history_days`** is `floorDaysBetween(as_of, epoch_start)`
   where epoch_start is the last resetting transfer's `ts`, or
   `registered_at` when the epoch was never reset. Verified against the
   transferred-identity fixture: transfer at 2026-07-21, as_of
   2026-08-01, exactly 11 days.

## Engine surface (src/index.ts)

`score(snapshot) => { result, canonicalBytes }`. `canonicalBytes` is built
once from a `CanonicalValue` tree with `FixedNum` leaves at each field's
declared `PRECISION`, via `canonicalJson`; `result` is
`JSON.parse(canonicalBytes) as ScoreResult`, so the two can never drift
relative to each other by construction. `scoreGroup` (exported) computes one
grouping (a context, or the global pool): normalizes, decays
(`reviewer_weight * 2^(-age_days/half_life)` via `pow2NegFx`), calls the
inherited `capAndSum`/`posterior`, and derives span/counterparties/
suppression. `src/cli.ts`'s derivation printer calls the exact same
`scoreGroup` export rather than recomputing anything, so the human-readable
`recompute` output cannot drift from the canonical result it prints
alongside.

## Fixture invariant mismatches (RESOLVED at integration by the lead)

Historical record. As delivered, two of the ten manifest cases had
invariants that did not hold under the literal SPEC 11.2/11.4 formulas with
the v0.1.0 provisional constants, and Track B skipped those specific
assertions per protocol. At integration the lead retuned the two fixture
INPUTS (never the estimator) so both tiers are genuinely exercised, and a
later adversarial pass changed the anti-flooding cap (see the cap section
above), which shifted the numbers again. The current committed goldens read:
`thin-same-day-cohort` n_eff 0.79, thin, score 60.57; `strong-diverse`
n_eff 27.17, strong, score 82.55. The previously skipped assertions now run
and pass. The original as-delivered arithmetic is preserved below because it
documents why the untuned constants behave as they do; the numbers in it are
the pre-retune, pre-cap-fix values, not what the engine now emits.

**`thin-same-day-cohort`** (manifest wants `coverage_tier: thin`, i.e.
`n_eff` in `[0.5, 5)`; the engine reports `n_eff: 0.11`, suppressed,
`coverage_tier: none`):

- Both reviewers: `age ~0.244` (wallets ~20 days old against a 365-day
  ramp from a 0.20 floor), `cohort 0.55` (both created within the 24h
  window; share is 1 other-in-window / 2 total per the documented
  denominator convention), `funder 1.0` (different funders), `repeat
  1.3225` (3 reviews each, `1.15^2`), `portfolio 0.30` (both reviewers'
  `portfolio_top_funder_share` is `1.0000`, i.e. they've only ever reviewed
  this one agent). Product: weight ≈ 0.053 per reviewer (well above the
  0.01 floor, so the floor is not the limiter).
- 3 reviews each at ages 8-20 days, `decay_half_life_days: 120`: decay
  factor ≈ 0.89-0.96. Undecayed-per-reviewer sum of the 3 decayed
  contributions (≈0.15) exceeds that reviewer's undecayed weight (≈0.053),
  so the anti-flooding cap (item above) caps each reviewer's contribution
  down to their own undecayed weight. Total `n_eff = 0.0532 + 0.0536 =
  0.1068 ≈ 0.11`.
- 0.11 is below `suppression_neff_floor: 0.50`, so the engine suppresses:
  `coverage_tier: none`, `score/score_low/score_high: null`. This is SPEC
  11.0's stated behavior at the floor, correctly triggered.
- SPEC 6's UC-1 narrative example for this exact scenario (six reviews, two
  same-cohort wallets) states `n_eff: 1.4`, about 12x higher than what these
  constants produce here. UC-1 is illustrative prose, not a constant
  specification; the v0.1.0 constants are explicitly `provisional`
  (`sensitivity sweep ... pending` throughout `methodology.ts`) and were
  never fit to reproduce that narrative number.
- Assertions kept (they hold): `n_eff` well below 6; `signals.
  reviewer_cohort_same_day = 1.0000`.
- Assertions skipped, each with an inline comment pointing here:
  `coverage_tier = thin`; "score strictly between prior*100 and the raw
  mean" (score is null when suppressed); "interval width > 20 points"
  (score_low/score_high are null when suppressed, so there is no width to
  measure).

**`strong-diverse`** (manifest wants `coverage_tier: strong`, i.e. `n_eff
>= 25` AND span `>= 90` days AND counterparties `>= 10`; the engine reports
`n_eff: 19.05`, `coverage_tier: moderate`):

- Span (268 days) and counterparties (34) both clear the strong thresholds
  comfortably; `n_eff` is the only shortfall, and it is close (19.05 vs the
  25 floor), not a design break.
- Many reviewers are commerce-corroborated (`commerce_multiplier: 1.60`)
  and fully aged, pushing their undecayed weight to the clamp ceiling of
  `1.0` before decay. The shortfall is entirely decay: `decay_half_life_days:
  120` against feedback spanning up to ~700 days of this agent's history
  (registered 2024-08-31) means a real share of otherwise maximally-weighted
  evidence is multiple half-lives old by `as_of_ts` and contributes little.
  Per-context: `code-review n_eff 9.36` (21 entries), `data-feed n_eff 9.69`
  (21 entries); global `19.05`.
- This is the direct, intended effect of SPEC 11.4's exponential decay
  applied literally; a shorter half-life sensitivity sweep (SPEC 12,
  currently unstarted) is the correct lever if the lead wants this fixture
  to land in `strong`, not a change to the estimator.
- Assertions kept: `lifecycle_state = live`; a substitute for "narrow
  interval relative to thin-same-day-cohort" using `confidence` (0.6297 vs
  0.0106) since `thin-same-day-cohort`'s score is null and has no numeric
  width to diff against (confidence is SPEC 11.1's always-present,
  posterior-derived proxy for interval width, so this is a faithful
  restatement of the same intent, not a weaker check).
- Assertions skipped: `coverage_tier = strong`; `n_eff >= 25`.

Neither fixture's snapshot or manifest.json was edited. Full detail and the
exact skip locations are in `test/manifest.test.ts`.

## Adopted deviation confirmed correct on review (not new, re-affirmed)

The anti-flooding cap in `estimator.ts` (capping a reviewer's total
decayed contribution within one grouping at their undecayed weight) is
exactly what makes `thin-same-day-cohort`'s multiple-reviews-per-reviewer
pattern not inflate n_eff past what a single review from that reviewer
would contribute. Confirmed this is working as designed by comparing
capped vs uncapped sums by hand for that fixture; recorded above rather
than re-deriving it as a "new" decision since it was already documented in
`estimator.ts`.

## ESLint scope request (not resolved here; this track does not own eslint.config.mjs)

`trust-index/eslint.config.mjs`'s I/O-import ban
(`no-restricted-imports`/`ioPatterns`) is scoped to
`packages/scoring/**/*.ts` (and `.mts`/`.cts`), i.e. the whole package tree,
not just `src/`. Three files in this package legitimately need an I/O
module and cannot avoid it:

- `src/cli.ts` (`node:fs`, to read the snapshot file named on the command
  line for `agent-trust recompute --snapshot <path>`). This is the ONLY
  file in `src/` that imports `node:fs`; every other file in `src/` stays
  I/O-free.
- `test/determinism.test.ts` and `test/cli.test.ts` (`node:child_process`),
  which spawn separate node processes for the SPEC 22 two-process
  determinism gate and for exercising the real `bin/agent-trust.mjs`
  end to end.

Request to the lead: either scope the `files` glob on the I/O-ban block to
`packages/scoring/src/**/*.ts` excluding `src/cli.ts`, or add a second
override block after it that re-allows `node:fs` for `src/cli.ts` and
`node:child_process` for `test/determinism.test.ts` and `test/cli.test.ts`
specifically. I did not edit `eslint.config.mjs` (workspace root file,
outside this track's ownership) or move these files out of `src/`/`test/`
to dodge the glob, since the glob is written to cover the whole tree on
purpose ("Tests are covered on purpose: golden tests must be deterministic
too") and a directory move would just be gaming that intent for the CLI.
This does not block the required gate: `pnpm --filter @trust-index/scoring
run typecheck && run test` is green; eslint is not part of either script,
and `pnpm -r --if-present run lint` at the workspace root skips this
package since its `package.json` has no `lint` script.

`bin/agent-trust.mjs` also uses `node:child_process` (to re-exec node with
tsx's loader registered, since `module.register` from within the launcher
itself hit `tsx must be loaded with --import instead of --loader` on Node
22) but is a `.mjs` file, outside the ban's glob already.

## Type change requests

None. `@trust-index/types` covered every shape this track needed; nothing
was worked around locally or forked.

## Golden score/interval/n_eff for the two named fixtures (SPEC 22, gate B2)

**thin-same-day-cohort**: `score: null`, `score_low: null`,
`score_high: null` (suppressed), `confidence: 0.0106`, `n_eff: 0.11`,
`coverage_tier: none`, `suppression_reason: "n_eff below suppression
floor"`. Context `code-review`: `n_eff 0.11`, also suppressed. Reviewer
weights: `0.0532` and `0.0536`.

**strong-diverse**: `score: 82.91`, `score_low: 68.17`, `score_high: 97.65`,
`confidence: 0.6297`, `n_eff: 19.05`, `coverage_tier: moderate`,
`lifecycle_state: live`. Contexts: `code-review` (`n_eff 9.36`, `score
78.26`, `[57.64, 98.89]`), `data-feed` (`n_eff 9.69`, `score 77.95`,
`[57.43, 98.47]`).

Full canonical bytes for all ten fixtures: `fixtures/golden/*.json`.
Regenerate with `pnpm run golden:generate` from
`packages/scoring` after any deliberate methodology change (never by hand).

## Gate results

- **B1** (100% branch coverage, lifecycle.ts and tiers.ts): met, enforced by
  `vitest.config.ts` thresholds scoped to those two files.
- **B2** (golden byte-compare, all ten fixtures; determinism across two
  separate processes): met. `test/golden.test.ts` byte-compares all ten;
  `test/determinism.test.ts` spawns two separate child `node` processes and
  byte-compares their output for all ten fixtures. Two physically separate
  machines/OSes were unavailable in this environment; two separate
  processes on the same machine is the closest available substitute, noted
  per the protocol's own acknowledgment that this substitution would be
  needed.
- Manifest invariants: one `describe` block per fixture in
  `test/manifest.test.ts`, covering every invariant in
  `fixtures/manifest.json` except the two documented above.
- Overall: 100% statement/line/function coverage, 98.5% branch coverage
  package-wide (the two small remaining branch gaps, in `epochs.ts`'s
  same-block tie-break and `weights.ts`'s empty-input defensive checks, are
  unreachable with real data: equal `tx_hash` on two transfers, and a
  current-epoch reviewer set that is simultaneously empty and non-empty
  inside the same `.map()` call).
