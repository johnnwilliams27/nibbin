# Calibration report

Source cohort: SYNTHETIC cohort (agents=200 seed=42 signal=1). Validates the harness only; establishes nothing about real agents.
Split at: 2026-07-02T00:00:00Z (block 32304000)
Label view: success

## Standing of this report

This run evaluated 200 agents against outcomes recorded after the split. Scoring used only evidence dated at or before the split, so no result here is in-sample.

Cohort: 200 agents. Excluded for no post-split outcome: 0. Excluded for no outcome in this label view: 0. Evaluated: 200.

Known limitation: reviewer aggregate statistics (total reviews, distinct agents reviewed, peak daily reviews, portfolio concentration, first seen) are carried as-of-snapshot rather than as-of-split, because the snapshot contract does not retain their history. They leak a limited amount of post-split information into reviewer weights. The effect is second order, it shifts weights rather than outcomes, but it is real and is not corrected here.

## Gate G2: does the index beat the trivial baselines?

FAIL: index_score does not beat: raw_mean.

## Reading these numbers

Brier and AUC answer different questions, and a score can do well on one and badly on the other. AUC asks whether the score ranks agents correctly, which is mapping-free. Brier and the expected calibration error ask whether the number itself is a probability, which depends entirely on how the score is read.

The index publishes a 0 to 100 quality estimate, and this report reads it as p = score/100 because that is the mapping a consumer gating on `minimum_score` implicitly assumes. High AUC with poor Brier therefore means the ranking works while that assumed mapping does not: the scores separate good agents from bad ones, but a score of 80 does not mean an 80 percent chance of clean completion. That gap is a finding about the mapping, not about the ranking, and it is the argument for publishing a fitted score-to-probability curve alongside the score rather than letting integrators infer one.

## Results by predictor

### index_score

The Agent Trust Index posterior score, read as p = score/100.

- Brier score: 0.231140 (lower is better)
- Base rate: 0.3150, base-rate Brier: 0.215775
- Skill against the base rate: -0.0712
- Expected calibration error: 0.2108
- AUC: 0.7561

Reliability:

| Predicted range | Agents | Mean predicted | Observed frequency |
|---|---|---|---|
| 0.20 to 0.30 | 3 | 0.2803 | 0.0000 |
| 0.30 to 0.40 | 24 | 0.3598 | 0.1250 |
| 0.40 to 0.50 | 54 | 0.4462 | 0.1296 |
| 0.50 to 0.60 | 57 | 0.5421 | 0.3158 |
| 0.60 to 0.70 | 55 | 0.6472 | 0.5636 |
| 0.70 to 0.80 | 7 | 0.7281 | 0.5714 |

By coverage tier:

| Tier | Agents | Brier | Mean predicted | Observed rate |
|---|---|---|---|---|
| moderate | 85 | 0.233197 | 0.5106 | 0.2588 |
| none | 1 | 0.202500 | 0.5500 | 1.0000 |
| thin | 114 | 0.229856 | 0.5369 | 0.3509 |

### raw_mean

Unweighted, undecayed mean of normalized feedback values.

- Brier score: 0.204756 (lower is better)
- Base rate: 0.3150, base-rate Brier: 0.215775
- Skill against the base rate: 0.0511
- Expected calibration error: 0.1880
- AUC: 0.7806

Reliability:

| Predicted range | Agents | Mean predicted | Observed frequency |
|---|---|---|---|
| 0.00 to 0.10 | 4 | 0.0510 | 0.0000 |
| 0.10 to 0.20 | 14 | 0.1510 | 0.0714 |
| 0.20 to 0.30 | 35 | 0.2482 | 0.1143 |
| 0.30 to 0.40 | 23 | 0.3435 | 0.1739 |
| 0.40 to 0.50 | 15 | 0.4352 | 0.0667 |
| 0.50 to 0.60 | 32 | 0.5143 | 0.2500 |
| 0.60 to 0.70 | 19 | 0.6511 | 0.6316 |
| 0.70 to 0.80 | 38 | 0.7493 | 0.4737 |
| 0.80 to 0.90 | 15 | 0.8455 | 0.6667 |
| 0.90 to 1.00 | 5 | 0.9638 | 1.0000 |

By coverage tier:

| Tier | Agents | Brier | Mean predicted | Observed rate |
|---|---|---|---|---|
| unknown | 200 | 0.204756 | 0.5012 | 0.3150 |

### review_count

Number of usable reviews, normalized to [0,1] by the cohort maximum.

- Brier score: 0.330734 (lower is better)
- Base rate: 0.3150, base-rate Brier: 0.215775
- Skill against the base rate: -0.5328
- Expected calibration error: 0.2882
- AUC: 0.4630

Reliability:

| Predicted range | Agents | Mean predicted | Observed frequency |
|---|---|---|---|
| 0.10 to 0.20 | 27 | 0.1287 | 0.3704 |
| 0.20 to 0.30 | 25 | 0.2379 | 0.2800 |
| 0.30 to 0.40 | 27 | 0.3470 | 0.4444 |
| 0.40 to 0.50 | 26 | 0.4494 | 0.3077 |
| 0.50 to 0.60 | 25 | 0.5516 | 0.3200 |
| 0.60 to 0.70 | 17 | 0.6440 | 0.0588 |
| 0.70 to 0.80 | 22 | 0.7560 | 0.2727 |
| 0.80 to 0.90 | 18 | 0.8684 | 0.3889 |
| 0.90 to 1.00 | 13 | 0.9798 | 0.3077 |

By coverage tier:

| Tier | Agents | Brier | Mean predicted | Observed rate |
|---|---|---|---|---|
| unknown | 200 | 0.330734 | 0.5011 | 0.3150 |

### wallet_age

Agent registration age in days, normalized to [0,1] by the cohort maximum.

- Brier score: 0.353783 (lower is better)
- Base rate: 0.3150, base-rate Brier: 0.215775
- Skill against the base rate: -0.6396
- Expected calibration error: 0.3094
- AUC: 0.4515

Reliability:

| Predicted range | Agents | Mean predicted | Observed frequency |
|---|---|---|---|
| 0.00 to 0.10 | 17 | 0.0538 | 0.3529 |
| 0.10 to 0.20 | 15 | 0.1450 | 0.3333 |
| 0.20 to 0.30 | 16 | 0.2562 | 0.3750 |
| 0.30 to 0.40 | 23 | 0.3577 | 0.3043 |
| 0.40 to 0.50 | 17 | 0.4584 | 0.3529 |
| 0.50 to 0.60 | 25 | 0.5589 | 0.3600 |
| 0.60 to 0.70 | 29 | 0.6548 | 0.3448 |
| 0.70 to 0.80 | 21 | 0.7511 | 0.3810 |
| 0.80 to 0.90 | 19 | 0.8434 | 0.1053 |
| 0.90 to 1.00 | 18 | 0.9600 | 0.2222 |

By coverage tier:

| Tier | Agents | Brier | Mean predicted | Observed rate |
|---|---|---|---|---|
| unknown | 200 | 0.353783 | 0.5262 | 0.3150 |

## Reproduction

Rebuild the cohort, then run `agent-trust-calibrate run --cohort <dir> --split <iso-ts> --split-block <n>`. Metrics are exact fixed-point arithmetic, so a rerun on the same inputs reproduces these numbers byte for byte.
