# Constant sensitivity report

Source cohort: ../../fixtures/snapshots (11 snapshots)

## What this establishes

Each constant below is swept across a plausible range and the cohort is rescored at every setting. The tables report two different things: how far the published scores move, and whether the ordering of agents survives.

Those are separate questions with separate answers, and the difference decides what a reader can safely do with an unverified constant. A constant that lifts every agent by the same amount moves the score a great deal and leaves the ordering untouched: a reader comparing two agents, or gating on a percentile, is unaffected by it, while a reader treating the number itself as a measurement is not. Reporting only the score movement would overstate the first reader's exposure.

This shows stability, not correctness. A constant can be perfectly stable and still be the wrong value, and an ordering can be stable under every constant and still be the wrong ordering. SPEC 12 permits shipping an untuned constant as provisional when its sweep is stable, and requires flagging one whose sweep is not. Nothing here promotes a constant to tuned; only a calibration run against real outcomes can do that.

The magnitudes below describe this cohort. A small or unrepresentative cohort gives an indicative reading, not a population statement: a constant that looks stable here can still move scores materially across the real index, and a tier change count is bounded by how many agents sit near a boundary in the first place. Read the ranking of constants by risk, which is robust, ahead of the absolute shifts, which are not.

## Summary

| Constant | Baseline | Worst mean score shift | Worst tier changes | Score stable | Worst pair agreement | Worst rank shift | Rank stable | Safe comparison margin |
|---|---|---|---|---|---|---|---|---|
| shrinkage_k | 5.00 | 10.30 | 0 | no | 0.9048 | 1 | no | 5.00 points |
| decay_half_life_days | 120 | 5.68 | 4 | no | 0.8000 | 2 | no | 10.00 points |
| weight.age_ramp_days | 365 | 0.67 | 1 | no | 0.8571 | 3 | no | 5.00 points |
| weight.age_floor | 0.20 | 0.19 | 1 | no | 0.9048 | 2 | no | 2.00 points |
| weight.cohort_penalty | 0.90 | 0.26 | 0 | yes | 0.9524 | 1 | no | 2.00 points |
| weight.common_funder_multiplier | 0.25 | 0.98 | 1 | no | 0.8571 | 3 | no | 5.00 points |
| weight.portfolio_penalty | 0.70 | 0.95 | 1 | no | 0.8095 | 3 | no | 5.00 points |
| suppression_neff_floor | 0.50 | 0.00 | 3 | no | 1.0000 | 0 | yes | 0.00 points |

7 of 8 constants move the published score materially across their plausible range: shrinkage_k, decay_half_life_days, weight.age_ramp_days, weight.age_floor, weight.common_funder_multiplier, weight.portfolio_penalty, suppression_neff_floor. These carry the most risk while untuned and should be named on the methodology page.

7 of 8 also disturb the ordering: shrinkage_k, decay_half_life_days, weight.age_ramp_days, weight.age_floor, weight.cohort_penalty, weight.common_funder_multiplier, weight.portfolio_penalty. For these, "agent A ranks above agent B" is not safe from the constant choice either.

1 constants move the score without disturbing the ordering: suppression_neff_floor. Their uncertainty falls entirely on the published magnitude. A reader comparing agents or gating on a percentile is not exposed to it; a reader reading the number as a measurement is.

## How far apart two agents must be

Unrestricted pair agreement counts a pair separated by a hundredth of a point the same as a pair separated by thirty, which understates how usable the ordering is: nobody quotes an ordering between two agents who are level. The margin below is the narrowest baseline score gap at which agreement holds across every setting of that constant, so it is the distance at which a comparison stops depending on the constant being right.

Every constant reaches the agreement threshold at some margin. Taking the widest across all of them, two agents separated by at least 10.00 points keep their ordering under every constant setting tested. That is the comparison the index can support today, before any constant is verified against outcomes.

| Constant | Margin at which the ordering holds |
|---|---|
| shrinkage_k | 5.00 points |
| decay_half_life_days | 10.00 points |
| weight.age_ramp_days | 5.00 points |
| weight.age_floor | 2.00 points |
| weight.cohort_penalty | 2.00 points |
| weight.common_funder_multiplier | 5.00 points |
| weight.portfolio_penalty | 5.00 points |
| suppression_neff_floor | 0.00 points |

This margin describes one constant at a time. Two constants moving together can disturb a pair that neither disturbs alone, so the figures above are a lower bound on the margin a joint sweep would find, not an upper one.

## Sweeps

### shrinkage_k

Baseline value: 5.00

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 1 | 7 | 4 | 10.30 | 14.65 | 0 | 0 |
| 2.50 | 7 | 4 | 4.17 | 6.44 | 0 | 0 |
| 5.00 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 10 | 7 | 4 | 3.60 | 5.99 | 0 | 0 |
| 20 | 7 | 4 | 6.66 | 12.91 | 0 | 0 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 1 | 7 | 0.9524 | 1 of 21 | 0.9643 | 1 of 1 | 1 |
| 2.50 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 5.00 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 10 | 7 | 0.9524 | 1 of 21 | 0.9643 | 1 of 1 | 1 |
| 20 | 7 | 0.9048 | 2 of 21 | 0.9286 | 0 of 1 | 1 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 1 | 0.9524 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 2.50 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 5.00 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 10 | 0.9524 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 20 | 0.9048 (21) | 0.9474 (19) | 0.9375 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |

### decay_half_life_days

Baseline value: 120

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 30 | 5 | 6 | 5.68 | 16.78 | 4 | 2 |
| 60 | 5 | 6 | 2.11 | 5.99 | 3 | 2 |
| 120 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 240 | 7 | 4 | 1.39 | 3.21 | 0 | 0 |
| 365 | 7 | 4 | 1.96 | 4.44 | 1 | 0 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 30 | 5 | 0.8000 | 2 of 10 | 0.8000 | 0 of 1 | 1 |
| 60 | 5 | 0.9000 | 1 of 10 | 0.9000 | 0 of 1 | 1 |
| 120 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 240 | 7 | 0.9048 | 2 of 21 | 0.8929 | 1 of 1 | 2 |
| 365 | 7 | 0.9048 | 2 of 21 | 0.8929 | 1 of 1 | 2 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 30 | 0.8000 (10) | 0.8000 (10) | 0.7778 (9) | 0.8750 (8) | 1.0000 (6) | 1.0000 (4) |
| 60 | 0.9000 (10) | 0.9000 (10) | 0.8889 (9) | 1.0000 (8) | 1.0000 (6) | 1.0000 (4) |
| 120 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 240 | 0.9048 (21) | 0.9474 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 365 | 0.9048 (21) | 0.9474 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |

### weight.age_ramp_days

Baseline value: 365

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 90 | 7 | 4 | 0.67 | 4.56 | 0 | 0 |
| 180 | 7 | 4 | 0.33 | 2.16 | 0 | 0 |
| 365 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 540 | 6 | 5 | 0.39 | 1.03 | 1 | 1 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 90 | 7 | 0.8571 | 3 of 21 | 0.7857 | 1 of 1 | 3 |
| 180 | 7 | 0.9048 | 2 of 21 | 0.8929 | 1 of 1 | 2 |
| 365 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 540 | 6 | 0.9333 | 1 of 15 | 0.9429 | 1 of 1 | 1 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 90 | 0.8571 (21) | 0.8947 (19) | 0.9375 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 180 | 0.9048 (21) | 0.9474 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 365 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 540 | 0.9333 (15) | 1.0000 (14) | 1.0000 (12) | 1.0000 (11) | 1.0000 (8) | 1.0000 (6) |

### weight.age_floor

Baseline value: 0.20

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.05 | 6 | 5 | 0.01 | 0.02 | 1 | 1 |
| 0.10 | 6 | 5 | 0.01 | 0.02 | 1 | 1 |
| 0.20 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 0.40 | 7 | 4 | 0.19 | 1.25 | 0 | 0 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.05 | 6 | 1.0000 | 0 of 15 | 1.0000 | 1 of 1 | 0 |
| 0.10 | 6 | 1.0000 | 0 of 15 | 1.0000 | 1 of 1 | 0 |
| 0.20 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 0.40 | 7 | 0.9048 | 2 of 21 | 0.8929 | 1 of 1 | 2 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.05 | 1.0000 (15) | 1.0000 (14) | 1.0000 (12) | 1.0000 (11) | 1.0000 (8) | 1.0000 (6) |
| 0.10 | 1.0000 (15) | 1.0000 (14) | 1.0000 (12) | 1.0000 (11) | 1.0000 (8) | 1.0000 (6) |
| 0.20 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 0.40 | 0.9048 (21) | 0.9474 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |

### weight.cohort_penalty

Baseline value: 0.90

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.50 | 7 | 4 | 0.26 | 1.66 | 0 | 0 |
| 0.70 | 7 | 4 | 0.13 | 0.85 | 0 | 0 |
| 0.90 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 1.00 | 7 | 4 | 0.07 | 0.45 | 0 | 0 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.50 | 7 | 0.9524 | 1 of 21 | 0.9643 | 1 of 1 | 1 |
| 0.70 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 0.90 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 1.00 | 7 | 0.9524 | 1 of 21 | 0.9643 | 1 of 1 | 1 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.50 | 0.9524 (21) | 0.9474 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 0.70 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 0.90 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 1.00 | 0.9524 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |

### weight.common_funder_multiplier

Baseline value: 0.25

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.10 | 6 | 5 | 0.00 | 0.01 | 1 | 1 |
| 0.25 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 0.50 | 7 | 4 | 0.53 | 3.70 | 0 | 0 |
| 0.75 | 7 | 4 | 0.98 | 6.77 | 0 | 0 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.10 | 6 | 1.0000 | 0 of 15 | 1.0000 | 1 of 1 | 0 |
| 0.25 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 0.50 | 7 | 0.8571 | 3 of 21 | 0.7857 | 1 of 1 | 3 |
| 0.75 | 7 | 0.8571 | 3 of 21 | 0.7857 | 1 of 1 | 3 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.10 | 1.0000 (15) | 1.0000 (14) | 1.0000 (12) | 1.0000 (11) | 1.0000 (8) | 1.0000 (6) |
| 0.25 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 0.50 | 0.8571 (21) | 0.8947 (19) | 0.9375 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 0.75 | 0.8571 (21) | 0.8947 (19) | 0.9375 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |

### weight.portfolio_penalty

Baseline value: 0.70

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.30 | 7 | 4 | 0.95 | 3.60 | 0 | 0 |
| 0.50 | 7 | 4 | 0.49 | 1.89 | 0 | 0 |
| 0.70 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 0.90 | 6 | 5 | 0.27 | 1.03 | 1 | 1 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.30 | 7 | 0.8095 | 4 of 21 | 0.7500 | 1 of 1 | 3 |
| 0.50 | 7 | 0.9524 | 1 of 21 | 0.9643 | 1 of 1 | 1 |
| 0.70 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 0.90 | 6 | 0.9333 | 1 of 15 | 0.9429 | 1 of 1 | 1 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.30 | 0.8095 (21) | 0.8421 (19) | 0.9375 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 0.50 | 0.9524 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 0.70 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 0.90 | 0.9333 (15) | 1.0000 (14) | 1.0000 (12) | 1.0000 (11) | 1.0000 (8) | 1.0000 (6) |

### suppression_neff_floor

Baseline value: 0.50

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.25 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 0.50 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 1.00 | 4 | 7 | 0.00 | 0.00 | 3 | 3 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.25 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 0.50 | 7 | 1.0000 | 0 of 21 | 1.0000 | 1 of 1 | 0 |
| 1.00 | 4 | 1.0000 | 0 of 6 | 1.0000 | 1 of 1 | 0 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.25 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 0.50 | 1.0000 (21) | 1.0000 (19) | 1.0000 (16) | 1.0000 (14) | 1.0000 (10) | 1.0000 (8) |
| 1.00 | 1.0000 (6) | 1.0000 (6) | 1.0000 (6) | 1.0000 (5) | 1.0000 (4) | 1.0000 (2) |

## How to read the ordering tables

Pair agreement is the fraction of agent pairs that the baseline orders and the swept setting orders the same way. It is the direct measure of whether "A is better than B" survives the constant. Pairs the swept setting ties are counted in neither the agreed nor the inverted column, so agreement plus inversions can fall short of the ordered-pair total.

Spearman is the rank correlation over the whole cohort, reported in its standard form for comparison against other work. Top decile kept counts how many of the baseline's top-decile agents remain in the top decile, which is the claim a consumer gating on a threshold depends on. The decile is taken by score threshold rather than by count, so ties at the cut line widen the set rather than being broken arbitrarily, and both sides of the count are printed.

Worst rank shift is the largest number of positions any single agent moves. It is reported because the other three measures are cohort averages, and an average can stay excellent while one agent moves from second place to two hundredth.

Agents that one setting suppresses and another does not have no rank to compare and are excluded from these tables. That is a coverage effect rather than an ordering effect, and the suppression flips column above already reports it.

In the agreement-by-gap table each cell is the agreement among pairs separated by at least that margin, with the number of such pairs in brackets. Agreement normally rises as the margin widens, because a wider gap takes more disturbance to close. A cell reading no pairs means the cohort contains no pair that far apart, which is a statement about the cohort rather than about the constant.
