# Is this a general rating engine, or an MCP rating engine with a generic type signature?

Assessment date: 2026-09-06. Branch `claude/agent-trust-index-spec-359ywy`.

## The short answer

**It is an MCP rating engine with a generic type signature, plus one adapter that
is proven in tests and wired to nothing.**

The estimator is genuinely subject-agnostic and I could not find a place where it
assumes MCP. The `Subject` contract is genuinely expressive: I built subjects for
two non-MCP shapes and one on-chain shape and scored all three through the real
`scoreSubject` without editing the engine. That part of the claim holds.

What does not hold is everything around it. Of five registered profiles, one has
a collector. Of two rating paths in the schema, one is empty and the other holds
exactly one kind. And the two structural properties that decide whether a rating
can rank anything (how much evidence a shape can accumulate, and whether a
missing collector is reported as our gap or their shortfall) both turn out to be
tuned to a probe cadence that only the MCP collector has.

Measured on the live database at `2026-09-06`:

| | value |
|---|---|
| rows in `rating_results` | 607, all `kind = mcp_server`, all `profile_id = mcp_server.v2` |
| rows in `scores` (the chain path) | 0 |
| production callers of `agentSnapshotToSubject` | none; test-only |
| production callers of `scoreSubject` | one, `packages/collectors/scripts/daily.mts:29`, hardcoded `const COLLECTOR = "mcp"` |

## What I did

I did not survey. I built subjects and ran them through
`packages/scoring/src/rating/index.ts:479` (`scoreSubject`), unmodified:

- **code_package.v1 over 600 real registry records.** Every published field of
  the MCP registry (`published_at`, `first_published_at`, `version`,
  `description`, `repository_url`) carried in
  `packages/collectors/transcripts/*.json` is exactly the class of evidence a
  package-registry reader produces. I mapped it onto `code_package.v1` and scored
  all 600. No invented distributions for anything read; every dimension with no
  real source was declared a gap.
- **hosted_agent.v1 swept across its whole input space**, 13 task-pass rates by 5
  uptime levels. I could not obtain a real population of hosted agents, so I
  report the transfer function rather than a population spread, and say so.
- **onchain_agent.v1 over all 11 golden chain snapshots**, through
  `agentSnapshotToSubject` and then `scoreSubject`, compared against `score()`.
- **A partial-harness reproduction** on `mcp_server.v2`, which is where the P0 is.

Fixtures and assertions: `packages/scoring/test/generality.test.ts` (new, 10
tests, passing). The population runs were scripted against the real transcript
corpus and are described precisely enough below to rebuild.

### On `generality-fixtures.ts`: build on it, do not replace it

`packages/scoring/test/generality-fixtures.ts` is sound and I kept it unchanged.
Its header is right about the thing that matters: cadence is where the contract
turns out to fit or not, and emitting evidence at the cadence a real collector
would emit it is what exposed the `latest_only` finding below. Its one defect was
that nothing imported it, so it asserted nothing. `generality.test.ts` imports
it. It is no longer inert.

---

## P0. A missing collector becomes points off the subject's score

`packages/scoring/src/rating/index.ts:568`

```ts
if (blockedDimensions.has(o.spec.id) && !o.published) continue;
```

A harness gap leaves the completeness denominator only if the dimension it
blocked published **nothing at all**. The comment above it explains the intent:
"a dimension with a published score was clearly assessable, whatever else was
missing". That is true per dimension and false per check. Once ONE check of a
dimension gets through, every other check we were unable to run stops counting,
the dimension carries its full profile weight computed from the fragment we did
get, and the result asserts `assessment_completeness: 1.00`.

Measured, on `mcp_server.v2` with `tool_safety` (weight 0.20, five checks):

| case | `tool_safety` | completeness | `harness_gaps` | composite |
|---|---|---|---|---|
| all 5 checks ran, all passed | 77.50 | 1.00 | 0 | **77.50** |
| all 5 checks blocked by a missing credential | null | 0.80 | 5 | **77.50** |
| 4 of 5 blocked, the one that ran passed | 77.50 | **1.00** | 4 | **77.50** |
| 4 of 5 blocked, the one that ran failed | 27.50 | **1.00** | 4 | **67.50** |

Row four is the error. We do not hold an OAuth account for the platform. Four of
five safety checks could not run. The one that did run failed. The subject loses
10 composite points, and the published result says we assessed the whole profile.
`harness_gaps` faithfully lists all four, and nothing reads them.

Per `SubjectScoreResult.assessment_completeness`, a reader is told to interpret
coverage 1.00 with completeness 1.00 as "fully assessable and came up short".
That is precisely the false statement being published.

Reproduction is in `generality.test.ts`, "DEFECT: a partly blocked dimension
scores the subject on the fragment we got".

**Which test should have caught it.** `packages/scoring/test/rating.test.ts`
covers `assessment_completeness` only for whole-dimension blocks, which is the
one case that works. A test with a gap and an observation on the SAME dimension
would have caught it and does not exist.

**Not currently firing.** I checked the live database: zero subjects on
`2026-09-06` have both a `harness_capability_*` gap and a published score on the
same dimension. The MCP collector gaps whole dimensions, which is why this has
never shown up. It fires the moment any collector's capabilities are per check
rather than per dimension, which is what a package collector (advisory feed up,
registry API rate-limited) and a hosted-agent collector (some benchmark tasks
need credentials, others do not) both look like on day one.

**Fix.** Make completeness a share of CHECKS attempted, not of dimensions that
produced any output. The gap already carries the `check` it would have produced
and the observation already carries `observation_key`; the denominator is the
union and no new data is needed. Until that lands, a collector must gap whole
dimensions or not at all, and that rule is written down nowhere.

---

## P1. A gap is optional, and its absence silently blames the subject

Same file, and it is the reason P0 is dangerous rather than merely wrong.

Nothing anywhere requires a dimension with zero observations to be explained. A
collector that simply does not cover four of six dimensions, and says nothing,
produces a result reporting `assessment_completeness: 1.00`, which means "we were
able to attempt everything". Measured on the 600-package run, the two cases are
numerically identical:

| | composite p10 / p50 / p90 | distinct | coverage | completeness |
|---|---|---|---|---|
| gaps declared | 45.36 / 49.50 / 70.13 | 458 | 1.00 | **0.65** |
| gaps not declared | 45.36 / 49.50 / 70.13 | 458 | **0.65** | 1.00 |

Every composite is the same to the digit. The only difference between "we have no
collector for this" and "the subject provided nothing" is which of two fields
reads 0.65, and that field is populated by the collector on the honour system.

**This is already happening on the chain path.**
`packages/scoring/src/rating/adapter.ts:272` sets `gaps: []`, and the file's own
header explains why availability is absent: "a snapshot holds no probe result".
That is a statement about our tooling. It is recorded as `gaps: []`, so all 11
golden chain fixtures score with `assessment_completeness: 1.00` and
`harness_gaps: []` while 0.15 of the profile weight was never obtainable. The
comment at adapter.ts:269-272 argues this is "a fact about what a snapshot holds
rather than a defect in our tooling". Both are true, and the distinction does not
survive contact with the published field: a reader sees completeness 1.00 and
coverage 0.55 and is told by the type's own documentation to read it as the
subject falling short.

**Fix.** A dimension with no observations and no gap should be refused at
assembly time, or reported as an `unexplained_dimension` signal. Silence is the
one thing the gap model was built to make impossible, and it is the default.

**Which test should have caught it.** `packages/scoring/test/rating-adapter.test.ts`
asserts the two paths agree on the number. Nothing asserts what the adapter says
about its own coverage.

---

## P1. `latest_only` deletes the evidence for two of the four shapes

`ResamplingPolicy` is documented as a distinction between a repeat sample and a
re-read of a static fact. That is the right distinction. It was applied on the
assumption that the only repeat sampler is an availability probe.

### hosted_agent.v1: the heaviest dimension is decided by the most recent run

`task_success` (weight 0.35) is `latest_only`. A benchmark suite re-run against a
stochastic agent is a resample, not a re-read. Measured, 30 daily runs of a
12-task suite:

| behaviour over 30 days | `task_success` | n_eff | obs | span_days | composite |
|---|---|---|---|---|---|
| passed all 12 every day | 77.44 | 0.99 | 12 | 0 | **84.63** |
| failed all 12 for 29 days, passed 12 today | 77.44 | 0.99 | 12 | 0 | **84.63** |
| passed 12 today, coin-flip every prior day | 77.44 | 0.99 | 12 | 0 | **84.63** |
| passed all 12 for 29 days, failed all 12 today | 27.58 | 0.99 | 12 | 0 | **52.91** |

360 observations collapse to 12. `span_days` is published as 0 across a 30-day
window. An agent that worked once today and never before is rated identically to
one that has worked every day for a month, and one bad afternoon costs 32
composite points with no widening of the interval, because n_eff is 0.99 in every
row. This is the same class of failure as the "50% of tools are broken" headline
in `packages/collectors/src/mcp/invoke.ts`: the number is stable, reproducible,
and measuring the wrong thing.

**Fix.** `task_success` is `independent_per_day`. The volume cap already bounds a
day at one observer's worth, which is exactly the protection `latest_only` was
reached for.

### code_package.v1: the coverage ladder is unreachable by construction

All six dimensions are `latest_only`, and a registry reader is one probe
observer, so every capped bucket collapses onto one UTC day and n_eff is pinned
at one observer's weight forever. Measured: 1 read and 365 daily reads give
identical composites, n_eff <= 1.00 on every dimension, `coverage_tier: thin` on
every dimension, `composite_confidence: 0.0000`.

`thin_neff_max` is 5 and `moderate_neff_max` is 25, so no code package can ever
leave `thin`, and confidence cannot rise with observation. This is arithmetic,
not tuning. Note that `mcp_server.v2` already carries a `strong_min_observers: 1`
override with a comment explaining that the top rung "was unreachable by
construction, dead code for the only collector that exists". The same reasoning
was never applied one rung down, and for a wholly-`latest_only` profile it takes
out two rungs.

---

## P2. Declared dimension weights are not effective weights

Not shape-specific, but it decides whether a new profile means what its author
wrote, so it blocks writing profiles for new shapes.

A dimension's point estimate is shrunk toward the prior with weight
`priorN = min(n_basis, shrinkage_k)`, which is 1.00 everywhere today. So a
dimension's usable range is compressed by `n_eff / (n_eff + 1)`. A dimension at
n_eff 1 keeps half its range; one at n_eff 15 keeps 94%. Effective influence is
`weight * n_eff / (n_eff + 1)`, and profiles are authored in `weight`.

Measured on `hosted_agent.v1` across its full input space:

- sweeping task pass rate 0/12 to 12/12 at full uptime moves the composite
  52.91 to 84.63, a range of **31.72 points**, at declared weight **0.35**
- sweeping uptime 0% to 100% at full task success moves the composite
  50.00 to 84.63, a range of **34.63 points**, at declared weight **0.20**

Availability outweighs task success, on a profile whose summary says task success
is the thing being bought, because availability resamples daily to n_eff 15 and
task success is pinned at 1. The author wrote 0.35 against 0.20 and got 0.175
against 0.188.

The same arithmetic caps every published dimension in the compendium. With
prior 0.55 and n_eff 1, the maximum attainable dimension score is
`(0.55 + 1) / 2 = 0.775`. Checked against the live database: the observed p90 on
`maintenance` is 77.45, on `tool_safety` 77.66, on `functional_correctness`
77.36, on `robustness` 77.43, on `injection_resistance` 77.43. Nothing in the
compendium scores above 77.5 on a `latest_only` dimension and nothing can.

---

## Shape by shape

### 1. On-chain agents (ERC-8004): expressible, proven in tests, wired to nothing

**The chain path bypasses the generic engine entirely.** There is no production
caller of `agentSnapshotToSubject`; the only callers are
`packages/scoring/test/rating-adapter.test.ts` and the scoring package's own
re-export. `apps/web/src/lib/scoring-port.ts` dynamic-imports `score()` and
returns a `ScoreResult`, which is the chain-shaped type, not `SubjectScoreResult`.
The web app's chain routes and its `/api/v1/mcp` route read two different tables
through two different engines.

Do the two rating paths agree? They cannot be compared on real data, because
`scores` holds 0 rows and `rating_results` holds no chain rows. On the 11 golden
snapshots they agree on every publish/withhold decision and differ on the number
by up to 11 points:

| fixture | `score()` | `scoreSubject()` |
|---|---|---|
| strong-diverse | 82.55 | 74.80 |
| custody-migration | 85.46 | 74.46 |
| bulk-reviewer | 68.44 | 63.70 |
| dormant | 60.35 | 60.01 |
| thin-same-day-cohort | 60.57 | 60.72 |
| heavy-decay-flood | 62.09 | 60.61 |
| the other 5 | null | null |

The divergence is methodology, not a bug: the generic path discounts
`third_party_review` to 0.60 and rolls up four dimensions where the chain path
publishes one. `rating-adapter.test.ts` neutralises the multiplier and shows
exact agreement, and that test is honest about why.

**Verdict: expressible, and the engine carries it.** The claim "one engine, many
shapes" is false as built, but the fix is wiring, not design. What is missing: a
chain equivalent of `daily.mts` that writes `rating_results`, a decision about
whether `scores` is retired or kept, and the availability gap declared honestly
(P1 above).

### 2. Tools, as distinct from the servers hosting them: not expressible

There is no `tool` profile. `getRatingProfile` throws, and `scoreSubject` throws
before it on the kind check. This is not "merely typechecks"; it does not
typecheck, and the refusal is correct behaviour.

The evidence already exists at tool granularity. The live `observations` table
holds 409 `invocation_succeeds` rows across **381 distinct tool instances**,
keyed `invocation_succeeds:<toolname>`, and `observationCheck` already splits the
instance suffix off for gate matching. So the collector computes per-tool
evidence, the schema stores per-tool evidence, and the subject boundary throws it
away by aggregating to the server.

What is missing: a profile, a subject id scheme (`<server>#<tool>` is the obvious
one and it collides with nothing in the primary key), and a decision about how a
tool inherits its server's availability. I did not attempt to answer the last
one. Note that a per-tool subject would have roughly one observation per
dimension, so it publishes only if a profile is written that expects that.

### 3. Packages and libraries: the contract carries it, and it publishes too easily

600 real registry records scored through `code_package.v1`:

| | code_package (600 real records) | mcp_server.v2 (live, 2026-09-06) | manifest-only failure (historical) |
|---|---|---|---|
| published | **600 / 600 (100%)** | 164 / 604 (27%) | 300 / 600 |
| p10 / p50 / p90 | 45.36 / 49.50 / 70.13 | 45.00 / 66.67 / 75.98 | n/a |
| **p10-p90 spread** | **24.77** | **30.98** | **2.4** |
| distinct scores | **458** | 132 | 8 |
| mean composite confidence | **0.0000** | 0.0028 | n/a |
| coverage tier | 600 thin, 0 moderate, 0 strong | 600 thin, 3 moderate, 0 strong | n/a |

This is a defensible spread, not a constant wearing a dimension's clothes. 24.77
points across 458 distinct values on 600 subjects is a ranking. It is somewhat
tighter than MCP's 30.98 and far away from the 2.4-point failure. So the honest
answer to "can a metadata-only shape rank": yes, and the reason is worth stating,
because it cuts against the MCP-first framing. **The single best-spreading
dimension in the entire live compendium is `maintenance`, which is a registry
publish-date read** (123 distinct scores, p10 40.76 to p90 77.45), and that is
exactly the evidence a package registry offers. The metadata is not the problem.

Where the spread comes from, per dimension, on the 600-package run:

| dimension | weight | published | p10 | p90 | distinct | n_eff |
|---|---|---|---|---|---|---|
| maintenance | 0.25 | 600 | 47.87 | 73.31 | 330 | 1.00 |
| provenance_integrity | 0.25 | 600 | 27.50 | 77.50 | **2** | 1.00 |
| documentation | 0.15 | 600 | 56.88 | 64.63 | 77 | 1.00 |
| dependency_hygiene | 0.20 | **0** | | | | |
| adoption | 0.10 | **0** | | | | |
| operator_reputation | 0.05 | **0** | | | | |

Two problems, both of which are `mcp_server.v1` repeating itself.

**The profile publishes 100% of the population from registry metadata alone.**
`min_assessment_completeness` is 0.50 and the three metadata-reachable dimensions
total 0.65, so nothing is ever withheld for lack of the expensive evidence. The
three dimensions that require real work (dependency hygiene, adoption, operator
reputation, 0.35 of the weight) have no collector and their absence blocks
nothing. `mcp_server.v1`'s doc comment says its failure was that "0.75 of its
weight sits on availability, conformance and tool safety as read from the
manifest". `code_package.v1` has 0.65 of its weight reachable from a registry
record, and unlike v1 it will publish for every subject in existence.

**`provenance_integrity` at 0.25 weight yields 2 distinct values.** From real
registry data the only obtainable signal is whether a source repository is
declared, so the dimension is a 50-point coin flip at a quarter of the composite.
Signed releases, lockfiles and reproducible builds all require fetching and
opening the artifact, which no collector does.

**Verdict: merely typechecks, and would publish 600 wrong-looking ratings on
day one.** What is missing, in order: a collector; an advisory feed for
`dependency_hygiene` and a decision about its provenance (see below);
`min_assessment_completeness` raised above 0.65 so that a metadata-only run is
withheld rather than published; and either more checks in `provenance_integrity`
or less weight on it.

**A gate that cannot fire.** `code.known_vulnerable_dependency` is the gate the
whole gate mechanism was motivated by, and its `trigger_provenance` is
`["measured", "attested"]`. A package's vulnerability evidence comes from OSV or
GitHub Advisory, which is somebody else's claim about somebody else's code. If a
collector labels it `third_party_review`, which is the literal reading of the
provenance definitions, **the gate can never fire and every vulnerable package
publishes clean.** If it labels it `attested`, the gate works and we have
declared an advisory feed to be "a third party signing a claim it is accountable
for", which is arguable but is a decision, not a default. I could not determine
which the eventual collector will do, because there is no collector. This must be
decided in `profiles.ts` before one is written, not inside it afterwards.

### 4. Off-chain hosted agents: the contract carries it, the cadence model does not

Full input sweep of `hosted_agent.v1`, 13 task-pass rates by 5 uptime levels:
composite range **18.78 to 84.63, 65.85 points, 62 distinct values over 65
combinations**. That is the widest usable range of any shape I tested, and it
comes from `availability` being the one `independent_per_day` dimension in a
`latest_only` profile.

I could not obtain a real population of hosted agents and did not invent one, so
I am not reporting a population spread for this shape. The transfer function says
the shape CAN rank; whether it does depends entirely on a collector that does not
exist.

The defects are P1 (`task_success` is `latest_only`) and P2 (availability
outweighs task success). Beyond that, four of six dimensions have no conceivable
collector today, `HOSTED_AGENT_UNCOLLECTABLE` in the fixtures names them, and
with them declared the subject sits at completeness 0.55 against a floor of
0.50 and publishes anyway.

**Verdict: merely typechecks.** What is missing: a benchmark suite held constant
across subjects (the rubric text promises one), a task harness, the resampling
fix, and a `min_assessment_completeness` that is not cleared by two dimensions.

---

## Occurrence gates: generic mechanism, MCP-specific hazards

The mechanism generalises cleanly. `code.known_vulnerable_dependency` fires
correctly on a hand-built package fixture, capping the composite at exactly 40.00
with `composite_suppression_reason: "capped by a gate"` and
`gate_capped_by` set on the dimension. `observationCheck` splits the instance
suffix off the key, so a gate written against `no_known_vulnerable_dependencies`
matches `no_known_vulnerable_dependencies:lodash`. Nothing here is MCP-shaped.

The hazards are. Six of the seven registered gates are MCP gates, and the
assumption underneath all of them is that we discover the hazard by calling the
thing: `trigger_provenance` is measured-and-attested everywhere, which is the
right gameability defence and is also a statement that we only cap what we
measured ourselves. For every shape where the hazard is discovered by reading a
feed rather than by making a call, that assumption has to be re-decided. See the
advisory-provenance problem above; it is the whole of the gate coverage for the
only non-MCP profile that has any.

## Completeness versus coverage: the mechanism is right and the default is wrong

The mechanism does what it claims. A wholly blocked dimension leaves the
completeness denominator, the composite is unchanged, and a shape blocked past
its floor is withheld with `assessment_incomplete` rather than scored low. On the
live day, 439 of 604 MCP subjects are withheld for exactly that reason, which is
the model working at scale and is the strongest thing in this report.

But the answer to "does a shape with no collector come out as `we cannot assess
this`" is: **only if the collector volunteers that it could not.** Silence
produces "assessed, and short". That is the default for every new shape, because
a new collector's author has to know to emit gaps for dimensions their collector
was never built to reach. See P1.

And P0 is the case where it does become a low score rather than a declared gap.

## Ranked by what blocks the product claim soonest

1. **P0, `rating/index.ts:568`.** A partly blocked dimension scores the subject
   on the fragment we got and publishes completeness 1.00. Latent today, fires on
   the first per-check collector, which is what every non-MCP collector will be.
2. **P1, gaps are optional.** Nothing requires a silent dimension to be
   explained, so "no collector" and "subject provided nothing" are the same
   published result. Already live on the chain adapter, which sets `gaps: []`
   while its own header explains the gap.
3. **P1, `code_package.v1` publishes 100% of the population from metadata.**
   `min_assessment_completeness` 0.50 against 0.65 of metadata-reachable weight.
   This is `mcp_server.v1` again, and this time nothing is withheld.
4. **P1, `task_success` is `latest_only`.** A hosted agent's headline dimension
   is decided by the most recent run and 30 days of evidence are discarded.
5. **P1, the chain path is not wired to the generic engine.** The "one engine,
   many shapes" claim is false in the codebase as built. Adapter proven, no
   caller, no rows.
6. **P2, declared weights are not effective weights.** Compression by
   `n_eff/(n_eff+1)` means profile authors cannot predict what they wrote.
   Blocks authoring profiles for new shapes.
7. **P2, the coverage ladder is dead for `latest_only` profiles.** Every code
   package is permanently `thin` at confidence 0.0000. Also 600 of 604 live MCP
   subjects are `thin`, so this is not only a non-MCP problem.
8. **P2, `classify` ignores `reachable`.** A source-only package publishes as
   `live`, which on a listing reads as "this endpoint answers".
9. **P3, `tool` has no profile.** Per-tool evidence exists and is aggregated
   away. Least urgent because the refusal is loud and correct.

## What I could not determine

- Whether the two rating paths agree on real data. `scores` is empty and
  `rating_results` holds no chain rows, so there is nothing to compare. The
  golden-fixture comparison above is the closest I could get.
- The population spread for `hosted_agent.v1`. No real population exists and I
  declined to invent one; the 65.85-point figure is a transfer function across
  the input space, not a spread over subjects.
- Which provenance an advisory feed will be labelled with, and therefore whether
  `code.known_vulnerable_dependency` can fire at all. No collector exists to
  inspect.
- Whether a per-tool subject can publish under any profile that could reasonably
  be written. I did not attempt to design that profile.
