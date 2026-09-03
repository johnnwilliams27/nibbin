# Calibration harness notes

Covers `packages/calibration` (SPEC 12, gates G2 and G3).

## What is built and what is not

Built: the machinery. Temporal splitting with a leakage guard, Brier score,
reliability curves, expected calibration error, AUC, per-tier breakdown, the
three trivial baselines SPEC 12.5 names, a Brier-minimizing grid search, and a
constant sensitivity sweep. All of it is validated by known-answer tests.

Not built, because it cannot be: an actual calibration result. There is no
commerce label set in this repository. Olas and Virtuals ACP ingest is stage A6
on Track A and has not run. Until it does, no number in this package says
anything about whether the index predicts real outcomes, and every constant
stays `provisional`.

The distinction is deliberate and is enforced in the output: a run below
`MIN_EVALUABLE_AGENTS` is labeled underpowered, the tuning report refuses to
promote a constant on an underpowered run, and the synthetic demo report states
in its own header that it establishes nothing about real agents.

## Decisions

- **Fixed-point metrics.** Brier, reliability, ECE and AUC are computed in
  integer and fixed-point arithmetic at 12 fractional digits, the same scale the
  scoring engine uses. The published Brier score is a claim about the system, so
  it gets the same reproducibility treatment as the scores. AUC is computed from
  doubled ranks via the Mann-Whitney identity, which keeps tie handling exact.
- **Leakage guard.** Commerce outcomes are the labels, but commerce also feeds
  the features through `has_commerce_with_agent` (a strong up-weight, SPEC 11.2).
  The split recomputes that flag from pre-split commerce only. Without it the
  score would partly read its own answer sheet. The run reports when the guard
  fired.
- **Known residual leakage, stated not hidden.** Reviewer aggregates
  (total_reviews, distinct_agents_reviewed, max_reviews_single_day,
  portfolio_top_funder_share, first_seen) are as-of-snapshot, not as-of-split,
  because `AgentSnapshot` does not retain their history. They leak a limited
  amount of post-split information into reviewer weights. Second order, but real.
  Fixing it needs point-in-time reviewer aggregates from the indexer. Tracked as
  future work; every calibration report prints this limitation.
- **One evaluation point per agent.** An agent's post-split outcomes collapse to
  a single label, conservatively (any failure is a failure). Per-job points would
  let a handful of high-volume agents dominate, making the Brier a statement
  about them rather than about the method.
- **Two label views.** `success` (completed versus everything else) drives Brier
  and reliability, because it is the question a consumer gating on a score
  actually asks. `discrimination` (completed versus disputed only) drives AUC,
  per SPEC 12.3, because rejected and abandoned conflate a bad counterparty with
  an ordinary no-deal.
- **Baselines get their best shot.** Review count and wallet age are
  cohort-normalized to [0,1], the most generous monotone mapping available
  without fitting to the labels. A strawman baseline would make the gate
  meaningless.
- **Score read as p = score/100.** That is the mapping a consumer gating on
  `minimum_score` implicitly assumes, so it is the honest thing to test. See the
  finding below.

## Findings so far

**The score is a quality estimate, not a probability, and the harness shows the
gap.** On the synthetic validation cohort the index score reaches AUC 0.76
(it ranks agents well) while scoring worse than the base rate on Brier, with an
expected calibration error around 0.21 and a reliability curve that sits well
above the diagonal. Discrimination is good; the assumed score-to-probability
mapping is not. These specific numbers are artifacts of the synthetic generator
and mean nothing about real agents, but the structural point does not depend on
the data: nothing in the methodology currently makes "80" mean "80 percent".
When real labels arrive, the likely answer is to publish a fitted
score-to-probability curve alongside the score rather than leaving integrators
to invent one. Worth raising with the author before the whitepaper claims
calibration.

**Most constants are not stable.** `research/constant-sensitivity.md`, run
against the committed fixture cohort: 7 of 8 swept constants move the published
output materially across their plausible ranges. `shrinkage_k` shifts scores by
up to 14.65 points between k=1 and k=20; `decay_half_life_days` changes 4 agents'
coverage tier across 30 to 365 days. This is exactly the case SPEC 12 has in
mind when it says an unstable untuned constant must be flagged. Caveat: an
11-agent fixture cohort gives an indicative reading, so trust the ranking of
constants by risk ahead of the absolute magnitudes.

## Requests to the author

- Commerce ingest (Track A stage A6) is the blocker for everything that matters
  here. Until Olas and Virtuals ACP outcomes are indexed, calibration cannot run.
- Decide whether the published artifact should be the raw score plus a fitted
  probability curve, or the score alone with the mapping left to integrators.
  The first is more useful and more honest; the second is less to maintain.
