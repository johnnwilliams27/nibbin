# Scoring engine: adversarial correctness review

Reviewed: `packages/scoring/src/*`, `packages/types/src/*`, `docs/NOTES-track-b.md`,
`fixtures/manifest.json`, `fixtures/golden/*.json`, against SPEC.md sections 5, 11
(all), 12, 22, 24A.

Every finding below is demonstrated by a probe script under
`/tmp/claude-0/-home-user-nibbin/a85751eb-0583-5f76-a70f-6188875ed6ec/scratchpad/probe-scoring/`,
run with `pnpm exec tsx <script>` from `/home/user/nibbin/trust-index`, importing
`score()` and the internal modules directly from `packages/scoring/src`. No
production file, test, fixture, or golden file was edited as part of this
review.

**Note on a mid-review change to the engine.** `packages/scoring/src/estimator.ts`
and `packages/scoring/src/index.ts` were modified on disk partway through this
review by something other than this review (not by an edit made here; this
report's own scope is read-only against production code). The change tightens
`capAndSum`'s anti-flooding ceiling from a reviewer's undecayed weight to their
single strongest decayed observation, and adds an `assertValidPrior` guard on
`priors.basis`/`priors.n_basis` plus a prototype-safe lookup for
`priors.by_context`. Every probe below was re-run against the current file
state after that change was noticed, and every quoted output reflects the
current code, not the code as it stood earlier in this session. The change
narrows F1's cousin case in `p4-duplicate-feedback.ts` (a duplicate entry no
longer inflates `n_eff` through the cap, since the cap is now the entry's own
decayed value when it is the reviewer's only distinct review) but does not
touch F1 through F9 below; each was independently reconfirmed against the
current code and the quoted numbers are current as of the final run.

## Summary

| ID | Severity | Claim |
|---|---|---|
| F1 | P0 | `shrinkage_k = 0` with zero current-epoch feedback throws (division by zero), instead of returning the same null-score shape every other zero-evidence agent gets. |
| F2 | P0 | A prior of exactly 0 or exactly 1 forces `confidence` to exactly `0.0000` regardless of `n_eff`, silently corrupting the one field the whole product thesis rests on. |
| F3 | P0 | A feedback entry whose `client_address` is missing from `snapshot.reviewers` throws, and this gap is reachable under the ops cadence the spec itself defines (30s feedback polling vs. daily reviewer refresh). |
| F4 | P0 | Any snapshot timestamp landing after `as_of_ts` (feedback, validation, commerce, `registered_at`, or a transfer) throws, through two different code paths, while the near-identical reviewer-age computation clamps the same condition gracefully three lines away. |
| F5 | P1 | `inputs_hash` is not invariant to feedback array order, even though the score itself is fully order-independent. |
| F6 | P1 | `inputs_hash` is not invariant to equivalent decimal formatting of a constant (`"5"` vs. `"5.00"` vs. `"5.000000000000"`), for the same underlying reason as F5. |
| F7 | P1 | A duplicate feedback entry (same `client_address` + `feedback_index`, the declared primary key) is not deduplicated and earns the "repeat interaction" weight bonus for free, inflating a reviewer's weight by over 50% from five copies of one review. |
| F8 | P2 | The `recompute` CLI crashes with a raw Node stack trace on malformed or incomplete snapshot JSON instead of a clean error. |
| F9 | P3 | Revoked-only feedback still counts as "activity" for lifecycle classification, so an agent whose entire feedback history was revoked reads as `live`. |

## F1 (P0): shrinkage_k = 0 crashes the engine on a zero-feedback agent

**Claim.** SPEC 11.0's posterior formula divides by `n_eff + k`. The engine never
guards against that denominator being zero. `shrinkage_k` is a plain
`DecimalString` with no floor enforced anywhere in `packages/types` or
`packages/scoring`, and a brand-new agent with zero current-epoch feedback
(exactly UC-4's cold-start case) has `n_eff = 0` by construction. The two
together throw.

**Probe:** `probe-scoring/p1-k-zero-crash.ts`, starting from
`fixtures/snapshots/registered-no-history.json` (a real "registered, cold
start" fixture) with `constants.shrinkage_k.value` set to `"0"`.

**Actual output:**

```
CRASHED: RangeError divisor must be positive
RangeError: divisor must be positive
    at divRoundHalfUp (packages/types/src/fixed.ts:66:22)
    at divFx (packages/scoring/src/fixedmath.ts:32:10)
    at intervalWidthFx (packages/scoring/src/estimator.ts:120:18)
    at posterior (packages/scoring/src/estimator.ts:129:30)
    at scoreGroup (packages/scoring/src/index.ts:105:16)
    at score (packages/scoring/src/index.ts:243:23)
```

**Expected:** the same graceful `score: null, coverage_tier: "none",
suppression_reason: "n_eff below suppression floor"` shape the unmodified
fixture produces (confirmed against `fixtures/golden/registered-no-history.json`).

**Why it matters.** `shrinkage_k` is explicitly `provisional` today and
"tuned by calibration" per SPEC 12; nothing stops a sensitivity sweep or a
config mistake from landing on 0, and the crash only fires on the
combination of a small `k` and low `n_eff`, so it will surface for real,
low-evidence agents rather than in an obvious smoke test. `alpha` and `beta`
of zero is explicitly one of the boundary conditions this review was asked
to probe (SPEC 11.1), and this is the concrete failure that combination
produces.

**Smallest fix.** Guard `ab = alphaFx + betaFx` in `intervalWidthFx`
(`estimator.ts`): when it is zero, return a defined degenerate posterior
(mean 0, variance 0, width 0) instead of calling `divFx`. A one-line
`if (ab === 0n) return { meanFx: 0n, halfFx: 0n };` at the top of
`intervalWidthFx` covers it, since `sums.neffFx` and `kFx` are both
non-negative by construction, so `ab === 0n` only happens when both are
exactly zero.

## F2 (P0): prior of exactly 0 or 1 zeroes confidence regardless of evidence

**Claim.** SPEC 11.1's confidence transform normalizes the posterior's
interval width against the "prior-only" width at `n_eff = 0`
(`confidence = 1 - min(1, width / width_prior_only)`). At `prior = 0` or
`prior = 1`, the Beta(alpha0, beta0) prior-only distribution is a point mass
(variance is `mean * (1 - mean) / (ab + 1)`, and `mean` is exactly 0 or 1),
so `width_prior_only` computes to exactly zero. `estimator.ts` special-cases
that as `confidenceFx = 0n`. The result: any agent whose cohort prior lands
on exactly 0 or 1 gets `confidence: 0` no matter how much real evidence it
has, because the baseline it is compared against is degenerate, not because
its own evidence is thin.

**Probe:** `probe-scoring/p2-prior-zero-confidence.ts`, using
`fixtures/snapshots/strong-diverse.json` (46 real feedback entries, `n_eff`
just under 28) with `priors.global` and every `priors.by_context` entry
swapped to `"0.000000"`, then again to `"1.000000"`, holding everything else
byte-identical.

**Actual output:**

```
=== baseline prior=0.55 ===
n_eff: 27.17 score: 82.55 confidence: 0.6756 interval: 69.64 95.47
=== prior=0 (same evidence, same n_eff) ===
n_eff: 27.17 score: 74.01 confidence: 0 interval: 59.08 88.93
=== prior=1 (same evidence, same n_eff) ===
n_eff: 27.17 score: 89.55 confidence: 0 interval: 79.14 99.96
```

**Expected:** confidence is a monotone function of interval width per SPEC
11.1. Here the actual posterior interval is 29.85 points wide at `prior = 0`
(59.08 to 88.93), close to the baseline's 25.83-point interval, on a
well-evidenced agent (`n_eff` near 27, past the `moderate` tier). It should
read close to the baseline's 0.68, not 0.

**Why it matters.** `confidence` is the field SPEC 5.2 and 11.1 build the
entire product claim on ("a consumer reading only `score` still receives
... `confidence` ... `confidence` is never optional"), and it is the exact
field `meetsThreshold(minScore, minConfidence)` (SPEC 20.2) gates on. A
well-evidenced agent failing a `minConfidence: 0.5` check purely because its
context's high-weight prior happened to compute to `0.0000` or `1.0000` (a
context where every corroborated review has so far been uniformly worst-
or best-in-scale, entirely plausible for a narrow or new tag) is exactly
the failure mode UC-1 exists to prevent, reproduced by the confidence
formula itself rather than by thin evidence.

**Smallest fix.** Do not derive the confidence baseline from a Beta variance
formula that degenerates at the boundary. A width-based transform needs a
baseline that stays meaningful there, for instance evaluating
`width_prior_only` at a `mean` clamped away from the literal 0/1 endpoints
(e.g. treating alpha0/beta0 as never less than some small positive floor
purely for the baseline calculation), or defining the transform directly in
terms of `n_eff` and `k` rather than through a variance computation that
can hit exactly zero.

## F3 (P0): a feedback entry with no matching reviewer record crashes the engine

**Claim.** `score()` builds its reviewer set from `currentEpochFeedback`'s
addresses and looks each one up in `snapshot.reviewers`, throwing if any
address is missing (`index.ts:206-212`, same pattern repeated in `cli.ts`).
SPEC 23 documents the poller running every 30 seconds and the "reviewer
refresh" job (which recomputes `reviewer_wallets` aggregates, SPEC 9) running
daily. A snapshot built between a reviewer's first feedback landing and the
next reviewer-refresh run is exactly the inconsistency this throws on, and
it is not a contrived edge case: it is the ordinary state of the system for
up to 24 hours after any address's first review, by the spec's own job
schedule.

**Probe:** `probe-scoring/p9-misc-robustness.ts`, case (b): one feedback
entry from an address deliberately left out of `snapshot.reviewers`.

**Actual output:**

```
(b) missing reviewer snapshot -> CRASHED: snapshot.reviewers is missing an entry for current-epoch reviewer 0x0000000000000000000000000000000000009999
```

**Expected:** at minimum, a defined and documented failure mode
(exclude the entry as unusable coverage, or suppress the score with a
named reason) rather than an uncaught `Error` reaching whatever calls
`score()` in production (per SPEC 7, that is meant to be a pure function
an API route or job runner calls directly, not something wrapped in
defensive error handling by convention).

**Smallest fix.** Either (a) have the index build guarantee this invariant
before handing a snapshot to the engine and treat any violation as a build
error caught upstream, and say so explicitly in `AgentSnapshot`'s doc
comment, or (b) have `score()` itself treat an unresolvable reviewer as
unusable coverage (skip the entry, count it, do not throw), matching how
`normalize.ts` already handles an uninferable scale. Given the daily/30s
cadence mismatch SPEC 23 documents, (b) is the safer default.

## F4 (P0): a timestamp after as_of_ts crashes the engine, inconsistently

**Claim.** Four different snapshot fields can carry a timestamp: feedback/
validation/commerce `ts`, `registered_at`, and transfer `ts`. If any of them
lands after `as_of_ts` (clock skew between an RPC provider's block
timestamp and the indexer's chosen `as_of_ts`, or a snapshot assembled while
a block is still landing), the engine throws, through two different
mechanisms depending on which field it is: `lifecycle.ts`'s explicit
`RangeError("activity after as_of_ts: snapshot is inconsistent")` for
feedback/validation/commerce, and `time.ts`'s `floorDaysBetween`'s
`RangeError("floorDaysBetween: a must be >= b")` for `registered_at` or a
transfer `ts` (both feed `effective_history_days`). Meanwhile the
near-identical computation in `weights.ts` (reviewer address age) and
`index.ts`'s `scoreGroup` (feedback decay age) both clamp the same
"timestamp is later than as_of" condition to zero with a plain ternary,
three lines of code away from the throwing paths. The engine does not have
one policy for this input class; it has at least three.

**Probes and actual output:**

`probe-scoring/p3-future-activity-crash.ts` (feedback `ts` one second past
`as_of_ts`):

```
CRASHED: RangeError activity after as_of_ts: snapshot is inconsistent
```

`probe-scoring/p11-future-registered-at-crash.ts` (`registered_at` one day
past `as_of_ts`, no transfers):

```
CRASHED: RangeError floorDaysBetween: a must be >= b
```

`probe-scoring/p11b-future-transfer.ts` (a transfer `ts` one day past
`as_of_ts`):

```
CRASHED: RangeError floorDaysBetween: a must be >= b
```

**Expected:** either all four fields clamp (matching the reviewer-age and
feedback-decay behavior already in the codebase) or all four throw a single,
documented, caught-at-the-boundary error. The current mix of both is neither.

**Smallest fix.** Pick one policy and apply it uniformly. Clamping is
already the majority behavior in this codebase (`weights.ts`,
`index.ts`'s `scoreGroup`) and is the more production-safe choice given
that `as_of_block`/`as_of_ts` are set by an indexer reading a chain, not by
the engine itself, so a few seconds of skew is normal, not corrupt input.
Concretely: change `floorDaysBetween` to clamp `a - b` at zero instead of
throwing, and change `lifecycle.ts`'s guard to treat future activity as
"activity at `as_of_ts`" rather than raising.

## F5 (P1): inputs_hash is not invariant to feedback array order

**Claim.** SPEC 22 requires "no map/set iteration order dependence... sort
explicitly before any reduction" for canonical JSON. `hash.ts`'s
`scoringInputsCanonical` explicitly sorts `reviewers` (by address) and
`priors.by_context` (by key) before serializing them, but serializes
`feedback`, `transfers`, `transfer_linkages`, `validations`, and `commerce`
with a plain `.map()` over the array exactly as given, with no sort. The
estimator itself does not have this problem: `capAndSum` groups by address
and sorts before reducing, so the score is fully order-independent. The
hash is not, because it bypasses the estimator's grouping and serializes
the raw snapshot fields.

**Probe:** `probe-scoring/p6b-hash-not-order-invariant.ts`, using
`fixtures/snapshots/strong-diverse.json` against a copy with only the
`feedback` array reversed.

**Actual output:**

```
rest of ScoreResult identical (score, n_eff, interval, signals, reviewer_weights, contexts): true
score: 82.55 82.55  n_eff: 27.17 27.17
inputs_hash identical: false
  forward-order inputs_hash:  cf4e9ccc19578e5a05b8b2dd4b39d1eeb23437d702dd5668d582377020874cee
  reversed-order inputs_hash: aa905454a1e8a95276143910070389eb666bb2993c325ba18b94e09f48b7673c
```

**Expected:** two snapshots that produce a byte-identical `ScoreResult`
outside of `inputs_hash` should also produce the same `inputs_hash`, since
`inputs_hash` is itself part of `ScoreResult` (SPEC 11.11) and is the value
anchored on chain per SPEC 20.1's Merkle leaf definition.

**Why it matters.** `AgentSnapshot.feedback`'s doc comment promises
"ascending by (block, client_address, feedback_index)" as an invariant of a
well-formed snapshot, but nothing enforces or checks that invariant, and two
independently correct index builds (different DB query plans, different
backfill chunk processing order, a reorg-driven reprocessing that appends
records in a different sequence) can easily produce a different but
equally "ascending-ish" order when multiple entries share a block. Since
`transfers`, `transfer_linkages`, `validations`, and `commerce` go through
the identical unsorted `.map()` pattern in the same file, the same defect
applies to all of them by inspection, not only to `feedback`. This directly
threatens the SPEC 22 verification gate ("the same snapshot scored on two
different machines... must produce byte-identical `ScoreResult` JSON"),
specifically for the one field meant to prove reproducibility.

**Smallest fix.** In `hash.ts`, sort `feedback` by
`(block, client_address, feedback_index)`, `transfers` by
`(block, tx_hash)` (matching the tie-break `epochs.ts` already uses),
`transfer_linkages` by `transfer_index`, and `validations`/`commerce` by
`(block, ...)` plus a stable secondary key, before mapping them into the
canonical tree. This mirrors the sort already applied to `reviewers` and
`priors.by_context` two fields above it in the same function.

## F6 (P1): inputs_hash is not invariant to equivalent decimal formatting

**Claim.** Same root cause as F5, different surface. `constantValues()` in
`hash.ts` embeds `c.shrinkage_k.value` (and every other constant) as the
raw `DecimalString` from the snapshot, passed straight into `canonicalJson`,
which treats a plain string as opaque text (`JSON.stringify(v)`) rather
than re-normalizing it through `FixedNum`. `parseFx`, by contrast, pads to
`INNER` (12) decimal places when the engine actually uses the value, so
`"5"`, `"5.00"`, and `"5.000000000000"` compute identically everywhere the
value is used, but hash differently because the hash never goes through
that normalization.

**Probe:** `probe-scoring/p6c-hash-decimal-formatting.ts`, three copies of
`fixtures/snapshots/registered-no-history.json` differing only in the
spelling of `constants.shrinkage_k.value`.

**Actual output:**

```
ScoreResult (minus inputs_hash) identical across '5' / '5.00' / '5.000000000000': true
hash('5')             = 6e224d26a519bd5281fd758755a1f979a751f60bcd18024581df75cca74d86be
hash('5.00')          = 5b6599d3c79f2fe8c54febaf6d8730955a3820193efd7d5473bbdc2e52fd1f83
hash('5.000000000000')= 760d563abf8a4dcf498917a9195bdc65818ff3d5a0f4bf8fd77544bf78fef09b
all three hashes equal: false
```

**Why it matters.** The same class of bug as F5: a value coming from a
Postgres `numeric` column (SPEC 9's schema) can print with a different
number of trailing zeros depending on driver, migration history, or a
manual constant edit, with zero effect on scoring and a full effect on the
anchored hash. This is the more general form of the defect F5 demonstrates
on array order.

**Smallest fix.** Route every `DecimalString` embedded in the canonical
tree, not only the computed numeric outputs, through `FixedNum.parse(...,
INNER).toDecimalString()` (or a fixed, declared precision per field) before
handing it to `canonicalJson`, instead of passing the raw string through.
`value_raw` and `detected_scale` bounds (arbitrary-precision integers, not
decimals) need the equivalent treatment: reformat through a canonical
integer string (e.g. strip leading zeros, normalize sign) rather than
embedding the raw snapshot string.

**Attempted and did not find:** the more dangerous direction, two snapshots
producing a *different* score but the *same* `inputs_hash`. Cross-checking
`parseConstants()` (what `score()` actually reads) against
`constantValues()` (what `hash.ts` hashes) field by field turned up no
constant used by scoring that is missing from the hash, and the same check
against every other snapshot field `score()` reads (`feedback`, `reviewers`,
`priors`, transfers/linkages, `metadata_status`, `declared_endpoints`,
`agent_wallet_active`, `as_of_ts`, `registered_at`) found each one present
in `scoringInputsCanonical`'s tree. `value_decimals` and `tag2` are hashed
but never read by any scoring computation (confirmed by grep across
`packages/scoring/src`), which is the safe direction (hash sensitive to
something irrelevant, not blind to something relevant). I could not
construct a same-hash-different-score pair; this attack held.

## F7 (P1): duplicate feedback entries earn a free repeat-interaction bonus

**Claim.** SPEC 9 declares `(chain_id, agent_id, client_address,
feedback_index)` the feedback table's primary key. The engine never checks
uniqueness of that tuple within the `feedback` array it is handed. The
"repeat interaction" weight signal (SPEC 11.2, "up-weight reviewers who
returned to the same agent... repeat business is expensive to fake") counts
occurrences of a `client_address` in the current-epoch feedback array
(`reviewCountByAddress` in `index.ts`) without checking that each occurrence
has a distinct `feedback_index`. A literal duplicate of one feedback record
(same `client_address` and `feedback_index`, appearing twice) is counted as
two genuine "return visits" and earns the same up-weight a reviewer would
get from actually submitting two different reviews.

**Probe:** `probe-scoring/p5-duplicate-inflates-weight.ts`, a single
one-day-old reviewer's single feedback record duplicated 1, 2, 3, and 5
times in the array (same `feedback_index: 0` every time).

**Actual output:**

```
copies of the SAME feedback_index=1: reviewer weight=0.2022 (components.repeat=1) n_eff=0.2 feedback_count=1
copies of the SAME feedback_index=2: reviewer weight=0.2325 (components.repeat=1.15) n_eff=0.23 feedback_count=2
copies of the SAME feedback_index=3: reviewer weight=0.2674 (components.repeat=1.3225) n_eff=0.27 feedback_count=3
copies of the SAME feedback_index=5: reviewer weight=0.3033 (components.repeat=1.5) n_eff=0.3 feedback_count=5
```

Five copies of one on-chain event push this reviewer's weight from 0.2022
to 0.3033, a 50% increase, purely from the duplication, with the repeat
multiplier hitting its 1.5 cap.

**Why it matters.** This is not exploitable by a reviewer wallet acting
alone (on-chain `feedback_index` increments per call; a wallet cannot
literally submit the same index twice through `giveFeedback`), but it is
exploitable by, and will silently corrupt output under, exactly the failure
mode SPEC 10.1 is written to guard against: a backfill crash-and-resume, or
a reorg-triggered reprocessing window, that re-emits an already-indexed
feedback row into the snapshot array a second time. `capAndSum`'s
anti-flooding cap (documented in `estimator.ts` and confirmed correct in
`docs/NOTES-track-b.md`) bounds how much extra *n_eff* a duplicate can add
directly, but it does not stop the duplicate from first inflating the
reviewer's *undecayed weight ceiling* through the repeat bonus, which raises
what the cap caps at.

**Smallest fix.** Deduplicate `feedback` by `(client_address,
feedback_index)` at the top of `score()` before any downstream computation
reads it (keep first occurrence, or throw if two entries with the same key
disagree on content, which would indicate real data corruption rather than
a harmless replay).

## F8 (P2): the CLI crashes with a raw stack trace on bad input

**Claim.** `cli.ts`'s `readSnapshot` calls `JSON.parse` with no
`try`/`catch`, and `score()` (via `parseConstants`) accesses nested fields
of `snapshot.constants` with no validation, so both malformed JSON and
valid-but-incomplete JSON produce an uncaught exception and a full Node
stack trace on stderr with exit code 0 (no `process.exitCode` set on the
crash path).

**Probe and actual output**, run directly against the built CLI entry point
(`pnpm exec tsx src/cli.ts recompute --snapshot <path>` from
`packages/scoring`):

Malformed JSON (`{not valid json`):

```
SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
    at JSON.parse (<anonymous>)
    at readSnapshot (packages/scoring/src/cli.ts:36:15)
...
Node.js v22.22.2
```

Valid but empty JSON (`{}`):

```
TypeError: Cannot read properties of undefined (reading 'methodology_version')
    at parseConstants (packages/scoring/src/constants.ts:39:27)
...
Node.js v22.22.2
```

Both runs exit 0 despite crashing (confirmed with `echo $?` after the
malformed-JSON run), so a script driving this CLI would not even see it as
a failure.

**Why it matters.** UC-6 positions `recompute` as the audit tool a
researcher or grant reviewer runs against a snapshot they built themselves.
A raw stack trace with a misleading zero exit code is a bad first
experience for exactly that audience, and does not tell the caller which
field was missing or malformed.

**Smallest fix.** Wrap `readSnapshot`'s `JSON.parse` in a `try`/`catch`
that prints a one-line error and sets `process.exitCode = 1`. A minimal
shape check on the parsed object (or a runtime schema validator, since
`packages/types` has none today) before calling `score()` would turn the
`{}` case into the same clean failure instead of a `TypeError`.

## F9 (P3): revoked-only feedback still reads as lifecycle activity

**Claim.** `score()` computes `lastActivitySec` (the input to
`classifyLifecycle`) by scanning every entry in `snapshot.feedback` without
checking `is_revoked`. An agent whose entire feedback history has since
been revoked is excluded from scoring correctly (revoked entries are
filtered out before `scoreGroup` ever sees them, via
`!f.is_revoked` in `currentEpochFeedback`'s filter), but it still reads as
`lifecycle_state: "live"`, because the revoked entries still count as
"activity" for the lifecycle window.

**Probe:** `probe-scoring/p10-all-revoked-and-suppression-precedence.ts`,
case (a): ten feedback entries from one reviewer, all `is_revoked: true`.

**Actual output:**

```
(a) all-revoked feedback:
    lifecycle_state: live (is this 'live' purely from revoked feedback counting as activity?)
    suppression_reason: n_eff below suppression floor
    n_eff: 0 score: null coverage_tier: none
    scores_by_context: {}
```

**Why it matters.** The score itself is correct (null, correctly
suppressed). The lifecycle label is the part in question: SPEC 11.7 defines
`live` as "feedback, validations, or commerce activity within 90 days,"
which is ambiguous on whether a since-retracted review counts. Read against
UC-4's stated goal (distinguishing an operating agent from a placeholder),
letting revoked feedback alone confer permanent `live` status is a small,
free way for a placeholder identity to escape `placeholder`/`registered`
classification (self-review, then revoke) without ever earning a real
score. Low severity because it changes a reported label, not the score or
any suppression behavior, and because the spec text does not explicitly
resolve this either way.

**Smallest fix.** Filter `is_revoked` out of the `lastActivitySec` scan in
`score()`, matching the filter already applied everywhere else in the
function.

## Unverified suspicions

Speculative items not run against the real engine; listed separately per
the review's own rules.

- The same order-sensitivity pattern documented in F5 for `feedback`
  likely applies identically to `transfers`, `transfer_linkages`,
  `validations`, and `commerce` (all four go through the same unsorted
  `.map()` in `hash.ts`), but no fixture in this repository currently has
  more than one transfer, validation, or commerce record, so F5's specific
  byte-comparison probe could not be repeated for those arrays. The
  code-level pattern is identical to the one demonstrated for `feedback`.
- `ageRampDays`, `cohortWindowSeconds`, and other constants used as raw
  divisors in `weights.ts` (e.g. `divFx(ageDaysFx, c.ageRampDays)`) are
  likely exposed to the same zero-divisor crash class as F1 if tuned to
  `0`. Not probed individually; F1 already demonstrates the pattern is
  real for `shrinkage_k`, and every other bare `divFx`/`divRoundHalfUp`
  call on a tunable constant in `weights.ts` and `tiers.ts` is a plausible
  sibling of the same defect.
- `FixedNum`'s constructor rejects `decimals > 18`, which does not
  interact with the snapshot's `value_decimals` field (confirmed unused,
  see F6's writeup), but nothing was found or tested that would let a
  malicious or malformed `constants` value push an internal `FixedNum`
  construction past that bound; flagged only because it was not
  specifically probed, not because any evidence points to it.

## What was attacked and held

- Reviewer weight product clamp: pushing `commerce_multiplier` to 3.00 and
  `repeat_bonus_multiplier`/`repeat_bonus_cap` to 2.00/5.00 (all far past
  documented defaults) still produced a final weight of exactly 1.00, never
  above. The `clampFx(w, weightFloor, ONE)` at the end of
  `computeReviewerWeights` holds regardless of how the constants upstream
  of it are tuned.
- Coverage tier boundaries: `n_eff` of exactly 5.00 lands `moderate`, one
  unit below lands `thin`; exactly 25.00 (with span/counterparties clear)
  lands `strong`, one unit below lands `moderate`; `n_eff` of exactly 0.50
  with the engine's own suppression check reads `thin`, not `none`,
  matching the spec's strict-`<` floor. All four match SPEC 11.5's stated
  inequalities exactly, tested against the real `coverageTier` function at
  the boundary.
- Lifecycle window boundaries: a gap of exactly 90 days reads `live`, 90
  days plus one second reads `registered`; exactly 180 days reads
  `dormant`, one second under reads `registered`. Matches the documented
  gap interpretation in `lifecycle.ts`.
- Degenerate and malformed `detected_scale` (`min_raw > max_raw`) is
  correctly treated as unusable, incrementing `unusable_feedback_count`
  with no crash and no out-of-range normalized value.
- Out-of-range (`99999`) and negative (`-1`) `transfer_linkages
  .transfer_index` values fail safe: the transfer is treated as a hard
  epoch reset (the documented conservative default), no crash, no
  false-benign classification.
- Feedback landing in the exact same block as a resetting transfer is
  correctly excluded from the new epoch.
- An int128-magnitude `value_raw` (up to 2^127-1) with `value_decimals:
  255` normalizes correctly with no crash or precision loss, via
  arbitrary-precision `bigint` arithmetic; `value_decimals` is (as
  documented) never read by the normalization math.
- A `value_raw` far outside its `detected_scale` bounds clamps to the
  bound instead of producing an out-of-`[0,1]` normalized value.
- No wall-clock read anywhere in `packages/scoring/src` or
  `packages/types/src` (`grep` for `Date.now`/`new Date`/`Math.random`
  returns nothing); SPEC 22's clock ban holds by inspection and by every
  probe run above producing identical output across repeated runs.
- Suppression-reason precedence is deterministic, and the three reasons
  (`placeholder`, `no_usable_feedback`, `neff_below_floor`) turn out to be
  mutually exclusive by construction given the current lifecycle gate
  (`placeholder` requires zero feedback entries of any kind;
  `no_usable_feedback` requires at least one), so the three-way collision
  the review was asked to probe is not actually reachable as a single
  input; the precedence chain in `index.ts` never has to arbitrate a real
  tie.
- A suppressed result never leaks a numeric score: every context's
  `score`/`score_low`/`score_high` is nulled alongside the global result
  when `forceSuppressed` is set, confirmed against the placeholder-shaped
  and all-revoked probes above.
- The score itself (everything in `ScoreResult` except `inputs_hash`) is
  fully order-independent: reversing the `feedback` array and reordering
  `reviewers`' object keys away from address-sort order produced a
  byte-identical result outside of `inputs_hash`, across three
  differently-ordered variants of the same fixture.
- A same-`inputs_hash`-different-score pair could not be constructed;
  every constant and snapshot field `score()` reads was confirmed present
  in `hash.ts`'s canonical tree by direct cross-reference.
