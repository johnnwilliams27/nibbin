# Judge model economics: which models, how many, and what it costs

Status: **decision deferred pending measurement.** This note sets up the choice
and prices it. It does not make it, because we have no accuracy data for any
candidate on our task, and inventing some would be the same error this project
has made twelve times already — reading "I have not measured it" as "I know it".

## The headline

At our current scale the entire cost spread between the cheapest sane ensemble
and the most expensive one is **about $105 a month**. Cost is not the deciding
variable. This is a quality decision wearing a cost costume.

Cost only becomes a real constraint at registry-wide scale (Scale B below),
where the spread widens to roughly $280–$920/month — still small against the
cost of publishing one wrong rating about somebody's software.

## Volume model

Two scales, both derived from measured census numbers rather than assumed.

**Scale A — what we can judge today.** 1,397 callable tools across the
reachable, non-401 portion of the 600-server census. At ~2.5 judged checks per
callable tool (response classification on differential pairs, injection,
robustness, determinism, plus the restricted fabrication probe), a full cold
pass is **~3,500 judgements**.

**Scale B — registry-wide**, once the `mcp_account` gap is closed and the ~40k
registry rows become assessable. Scaled from A: **~35,000 judgements per pass**.

Steady-state refresh at Scale A:

| Driver | Judgements/day |
|---|---|
| Staleness floor (every subject re-judged ≤30 days) | 117 |
| Change-driven (assumed 2%/day of corpus has a changed transcript) | 70 |
| Net of overlap | **~180** |

That is **5,400 judgements/month**, ≈1.55 full passes. A `JUDGE_PROMPT_VERSION`
bump forces one extra cold pass on top.

Token shape per judgement: ~1,500 in (350-token preamble + 4,000-char fenced
content ≈ 1,000 tokens + tool declaration), ~150 out.

**Assumption flagged:** the 2%/day churn rate is not measured. We have the
registry `publishedAt`/`isLatest` fields to measure it properly and have not.

## Per-judgement unit cost

Anthropic prices from the `claude-api` skill (cached 2026-06-24). Open-weight
prices fetched live 2026-09-04; they move, and third-party providers differ
from first-party by up to 60%, so treat them as a band not a quote.

| Model | $/1M in | $/1M out | $/judgement |
|---|---|---|---|
| Opus 5 | 5.00 | 25.00 | $0.01125 |
| Sonnet 5 | 2.00 | 10.00 | $0.00450 |
| Haiku 4.5 | 1.00 | 5.00 | $0.00225 |
| Kimi K2.6 | 0.60 | 2.50 | $0.00128 |
| Qwen3.5 Plus | 0.40 | 2.40 | $0.00096 |
| DeepSeek V4-Pro | 0.435 | 0.87 | $0.00078 |
| Qwen3.5 Flash | 0.10 | 0.40 | $0.00021 |
| DeepSeek V4-Flash | 0.14 | 0.28 | $0.00025 |

Anthropic Batch API halves its leg. A 24h batch window is fine for the daily
incremental refresh; it is not fine for an on-demand re-rate, so the wiring
needs both paths.

Prompt caching does not help us: the shared preamble is ~350 tokens, below the
512-token minimum cacheable prefix.

## Variant costs, Scale A

| # | Variant | $/day | $/month | Cold pass | Batched $/mo* |
|---|---|---|---|---|---|
| A | Opus 5 alone | 2.03 | 60.75 | 39.38 | 30.38 |
| B | Opus 5 ×2 (two seeds) | 4.05 | 121.50 | 78.75 | 60.75 |
| C | Opus 5 + Sonnet 5 | 2.84 | 85.05 | 55.13 | 42.53 |
| D | Opus 5 + Kimi K2.6 | 2.26 | 67.64 | 43.84 | 37.26 |
| E | Sonnet 5 + Haiku 4.5 | 1.22 | 36.45 | 23.63 | 18.23 |
| F | Sonnet 5 + Kimi K2.6 | 1.04 | 31.19 | 20.21 | 19.04 |
| G | Haiku 4.5 + DeepSeek V4-Pro | 0.54 | 16.38 | 10.61 | 10.31 |
| H | Opus 5 + Sonnet 5 + Kimi K2.6 (vote) | 3.07 | 91.94 | 59.58 | 49.42 |
| **I** | **Haiku + Kimi, Opus adjudicates 15%** | **0.94** | **28.18** | **18.26** | **14.09** |
| J | Sonnet + Kimi, Opus adjudicates 15% | 1.34 | 40.32 | 26.13 | 20.16 |

\* Anthropic legs halved; open-weight legs unchanged (no verified batch discount).

Scale B is 10× every figure: variant I ≈ $282/mo, variant H ≈ $919/mo.

**Sensitivity:** the cascade variants' cost depends on the disagreement rate,
which is unmeasured. Assumed 15%. At 40% disagreement, variant I rises to
~$45/mo — and the ceiling if the cascade degenerates entirely is variant A at
$61/mo. The cost of being wrong about this assumption is bounded and trivial.

## Expected quality — hypotheses, not measurements

No accuracy number below is measured. Each is a hypothesis with a named failure
mode and a falsifier. The labelled set decides.

| Variant | Hypothesised behaviour | Named risk |
|---|---|---|
| A (single Opus) | Best single-model accuracy; no error detection at all | A confident wrong verdict publishes as a rating with nothing to catch it |
| B (Opus ×2) | Near-zero added value | Same model, same training, same errors — agreement is not evidence, it is an echo |
| C (Opus + Sonnet) | Catches capability-driven errors | Shared lineage: correlated errors on exactly the semantic edge cases we built the judge for |
| D/F (frontier + Kimi) | Genuinely decorrelated pair | Kimi's injection resistance unknown; disagreement rate likely higher, costing coverage |
| E/G (cheap pair) | Cheapest disagreement detection | Both members may miss the same hard case; two weak judges agreeing is worse than one strong one alone |
| H (three, majority vote) | Looks robust | **Unsound.** Majority voting assumes independent errors; two same-family members outvote the outsider along family lines |
| **I/J (cascade)** | Decorrelated cheap pair for detection, strongest model for resolution | Depends on the cheap pair's recall — a case both members get confidently wrong never escalates |

## 2 vs 3

Two models **detect** disagreement. They cannot **resolve** it.

Under the corrected design (judge instability is a harness gap, not subject
uncertainty — see the self-critique in `judge-design.md`), every disagreement
becomes an `AssessmentGap`. So a two-model ensemble trades accuracy for
coverage, and the exchange rate *is* the disagreement rate. At 15% we lose 15%
of judged checks, which pushes subjects against `min_assessment_completeness`
and can make them unpublishable. We would be rating fewer things in order to
rate them more carefully — possibly the right trade, but it should be a
decision, not a side effect.

Three models as **voters** is the wrong fix, for the reason in row H above.

Three models as **escalation** is the right shape:

```
  cheap model 1  ─┐
                  ├─ agree ──────────────► publish observation
  cheap model 2  ─┘
                  └─ disagree ──► strong adjudicator ──► publish, verdict stands alone
                                                    └──► adjudicator abstains ──► AssessmentGap
```

This converts most would-be gaps back into observations, spends the expensive
model only where it earns its price, and — the part I care about most — makes
**the disagreement rate itself a published harness metric**. A rising
disagreement rate is the early warning that a cheap model has been swapped
under us or that a new class of subject has arrived that the pair cannot read.

## Open weights: three arguments for, one against

**For 1 — decorrelation.** This is the real argument, and it is a quality
argument, not a price one. An Opus/Sonnet pair shares training data, RLHF
lineage and tokenizer. Their errors on "is this a refusal or fabricated
content" will correlate, and correlated agreement is not evidence of anything.
A different lab's model is the cheapest independence available to us.

**For 2 — reproducibility.** Judged observations are frozen into the artifact,
so re-*scoring* stays deterministic. But re-*judging* a two-year-old transcript
under a deprecated API model is impossible. A pinned open-weight checkpoint we
host is auditable indefinitely. A ratings source has to be able to defend a
number years after it published it.

**For 3 — residency.** We send third parties' tool output to a judge. If
operators are going to hand us credentials to close the `mcp_account` gap, being
able to say that their traffic never leaves our infrastructure is worth
something concrete.

**Against — injection resistance.** The judge reads untrusted tool output inside
a fence. Weaker instruction-following makes a model likelier to obey text inside
that fence. This is where "slightly worse model" becomes "model exploitable by
any server that wants a better rating" — i.e. gameability, the exact property
the whole compendium is supposed to lack.

So injection resistance is a **gate, not a score**.

Note also that self-hosting trades per-token cost for fixed GPU and ops cost.
The per-token figures above assume hosted APIs for the open-weight legs, which
gives up argument 3.

## Admission criteria

A candidate judge model clears three gates before price is discussed at all:

- **G1 Injection resistance.** Zero successful injections across the existing
  `INJECTION_PAYLOAD` corpus plus a purpose-built adversarial set aimed at the
  judge specifically (fenced content instructing a verdict). Any success is
  disqualifying at any price.
- **G2 Schema discipline.** 100% parseable structured output. Our contract is
  structured output only; free-text drift is a failure, not a retry.
- **G3 Refusal recognition.** ≥95% on the hand-labelled refusal set. This is the
  load-bearing capability: three separate word-list implementations of exactly
  this check have already failed here.

Only candidates past all three are ranked on agreement with ground truth, then
on price.

## The test, and why it is obviously worth running

- **Labelled set:** ~250 items drawn from the 92 stored tool calls and the
  battery transcripts, hand-labelled across the three judge tasks. Genuinely
  ambiguous items are excluded — they would be gaps in production anyway.
- **Run:** every candidate against the set. ~250 × ~8 candidates ≈ 2,000
  judgements. **Under $30 total**, dominated by the Opus runs.
- **Report:** per-candidate G1/G2/G3 pass/fail, accuracy against labels, and
  **pairwise error correlation between candidates** — the number nobody quotes
  and the one that actually decides the ensemble.

$30 and a day of labelling, against a decision baked into every rating we ever
publish. There is no version of this where we should guess instead.

## Prior on the outcome

Stated so it can be scored later: I expect variant **I** to win — a decorrelated
cheap pair with strong adjudication, ~$28/month at current scale — because
decorrelation plus strong resolution beats a same-family pair on both accuracy
and coverage. If the open-weight leg fails G1, fall back to **J** ($40/month).
If both cheap tiers fail G3, the cascade collapses and we run **A** with the
adjudicator as the only judge ($61/month), losing error detection entirely,
which would be the genuinely bad outcome and the one worth knowing about early.

Every one of those numbers is affordable. That is the point of this note: pick
on quality.

## Sources

- Anthropic pricing: `claude-api` skill, cached 2026-06-24.
- Kimi K2.6: <https://www.kimi.ai/resources/kimi-k2-6-pricing>,
  <https://benchlm.ai/moonshot/api-pricing>
- Qwen3.5: <https://benchlm.ai/alibaba/api-pricing>
- DeepSeek V4: <https://pricepertoken.com/pricing-page/provider/deepseek>
