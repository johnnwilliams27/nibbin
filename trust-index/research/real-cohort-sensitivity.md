# Constant sensitivity report

Source cohort: ../../cohort-base (2000 snapshots)

## What this establishes

Each constant below is swept across a plausible range and the cohort is rescored at every setting. The tables report two different things: how far the published scores move, and whether the ordering of agents survives.

Those are separate questions with separate answers, and the difference decides what a reader can safely do with an unverified constant. A constant that lifts every agent by the same amount moves the score a great deal and leaves the ordering untouched: a reader comparing two agents, or gating on a percentile, is unaffected by it, while a reader treating the number itself as a measurement is not. Reporting only the score movement would overstate the first reader's exposure.

This shows stability, not correctness. A constant can be perfectly stable and still be the wrong value, and an ordering can be stable under every constant and still be the wrong ordering. SPEC 12 permits shipping an untuned constant as provisional when its sweep is stable, and requires flagging one whose sweep is not. Nothing here promotes a constant to tuned; only a calibration run against real outcomes can do that.

The magnitudes below describe this cohort. A small or unrepresentative cohort gives an indicative reading, not a population statement: a constant that looks stable here can still move scores materially across the real index, and a tier change count is bounded by how many agents sit near a boundary in the first place. Read the ranking of constants by risk, which is robust, ahead of the absolute shifts, which are not.

## Summary

| Constant | Baseline | Worst mean score shift | Worst tier changes | Score stable | Worst pair agreement | Worst rank shift | Rank stable | Safe comparison margin |
|---|---|---|---|---|---|---|---|---|
| shrinkage_k | 5.00 | 6.91 | 0 | no | 0.9714 | 1 | no | 1.00 points |
| decay_half_life_days | 120 | 1.15 | 18 | no | 0.8000 | 1 | no | 5.00 points |
| weight.age_ramp_days | 365 | 1.74 | 23 | no | 0.9619 | 2 | no | 5.00 points |
| weight.age_floor | 0.20 | 0.66 | 4 | no | 0.9818 | 1 | no | 1.00 points |
| weight.cohort_penalty | 0.90 | 0.13 | 2 | no | 1.0000 | 0 | yes | 0.00 points |
| weight.common_funder_multiplier | 0.25 | 0.00 | 0 | yes | 1.0000 | 0 | yes | 0.00 points |
| weight.portfolio_penalty | 0.70 | 0.00 | 0 | yes | 1.0000 | 0 | yes | 0.00 points |
| suppression_neff_floor | 0.50 | 0.00 | 37 | no | 1.0000 | 0 | yes | 0.00 points |

6 of 8 constants move the published score materially across their plausible range: shrinkage_k, decay_half_life_days, weight.age_ramp_days, weight.age_floor, weight.cohort_penalty, suppression_neff_floor. These carry the most risk while untuned and should be named on the methodology page.

4 of 8 also disturb the ordering: shrinkage_k, decay_half_life_days, weight.age_ramp_days, weight.age_floor. For these, "agent A ranks above agent B" is not safe from the constant choice either.

2 constants move the score without disturbing the ordering: weight.cohort_penalty, suppression_neff_floor. Their uncertainty falls entirely on the published magnitude. A reader comparing agents or gating on a percentile is not exposed to it; a reader reading the number as a measurement is.

## How far apart two agents must be

Unrestricted pair agreement counts a pair separated by a hundredth of a point the same as a pair separated by thirty, which understates how usable the ordering is: nobody quotes an ordering between two agents who are level. The margin below is the narrowest baseline score gap at which agreement holds across every setting of that constant, so it is the distance at which a comparison stops depending on the constant being right.

Every constant reaches the agreement threshold at some margin. Taking the widest across all of them, two agents separated by at least 5.00 points keep their ordering under every constant setting tested. That is the comparison the index can support today, before any constant is verified against outcomes.

| Constant | Margin at which the ordering holds |
|---|---|
| shrinkage_k | 1.00 points |
| decay_half_life_days | 5.00 points |
| weight.age_ramp_days | 5.00 points |
| weight.age_floor | 1.00 points |
| weight.cohort_penalty | 0.00 points |
| weight.common_funder_multiplier | 0.00 points |
| weight.portfolio_penalty | 0.00 points |
| suppression_neff_floor | 0.00 points |

This margin describes one constant at a time. Two constants moving together can disturb a pair that neither disturbs alone, so the figures above are a lower bound on the margin a joint sweep would find, not an upper one.

## Sweeps

### shrinkage_k

Baseline value: 5.00

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 1 | 15 | 1985 | 6.91 | 14.81 | 0 | 0 |
| 2.50 | 15 | 1985 | 2.39 | 5.32 | 0 | 0 |
| 5.00 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 10 | 15 | 1985 | 1.49 | 3.41 | 0 | 0 |
| 20 | 15 | 1985 | 2.33 | 5.36 | 0 | 0 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 1 | 15 | 0.9714 | 3 of 105 | 0.9893 | 2 of 2 | 1 |
| 2.50 | 15 | 0.9905 | 1 of 105 | 0.9964 | 2 of 2 | 1 |
| 5.00 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 10 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 20 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 1 | 0.9714 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 2.50 | 0.9905 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 5.00 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 10 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 20 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |

### decay_half_life_days

Baseline value: 120

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 30 | 3 | 1997 | 0.56 | 1.08 | 12 | 12 |
| 60 | 5 | 1995 | 0.84 | 2.94 | 10 | 10 |
| 120 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 240 | 21 | 1979 | 0.82 | 3.54 | 6 | 6 |
| 365 | 33 | 1967 | 1.15 | 5.00 | 18 | 18 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 30 | 3 | 1.0000 | 0 of 3 | 1.0000 | 1 of 1 | 0 |
| 60 | 5 | 0.8000 | 2 of 10 | 0.8000 | 1 of 1 | 1 |
| 120 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 240 | 15 | 0.9905 | 1 of 105 | 0.9964 | 2 of 2 | 1 |
| 365 | 15 | 0.9714 | 3 of 105 | 0.9893 | 2 of 2 | 1 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 30 | 1.0000 (3) | 1.0000 (3) | 1.0000 (3) | 1.0000 (2) | no pairs | no pairs |
| 60 | 0.8000 (10) | 0.8889 (9) | 0.8889 (9) | 1.0000 (6) | 1.0000 (1) | no pairs |
| 120 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 240 | 0.9905 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 365 | 0.9714 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |

### weight.age_ramp_days

Baseline value: 365

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 90 | 38 | 1962 | 1.74 | 4.03 | 23 | 23 |
| 180 | 29 | 1971 | 1.19 | 3.58 | 14 | 14 |
| 365 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 540 | 10 | 1990 | 0.59 | 1.37 | 5 | 5 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 90 | 15 | 0.9619 | 3 of 105 | 0.9831 | 1 of 2 | 2 |
| 180 | 15 | 0.9905 | 1 of 105 | 0.9964 | 2 of 2 | 1 |
| 365 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 540 | 10 | 1.0000 | 0 of 45 | 1.0000 | 1 of 1 | 0 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 90 | 0.9619 (105) | 0.9785 (93) | 0.9877 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 180 | 0.9905 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 365 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 540 | 1.0000 (45) | 1.0000 (42) | 1.0000 (41) | 1.0000 (20) | 1.0000 (5) | no pairs |

### weight.age_floor

Baseline value: 0.20

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.05 | 11 | 1989 | 0.59 | 1.34 | 4 | 4 |
| 0.10 | 11 | 1989 | 0.39 | 0.86 | 4 | 4 |
| 0.20 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 0.40 | 19 | 1981 | 0.66 | 1.38 | 4 | 4 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.05 | 11 | 0.9818 | 1 of 55 | 0.9909 | 2 of 2 | 1 |
| 0.10 | 11 | 0.9818 | 1 of 55 | 0.9909 | 2 of 2 | 1 |
| 0.20 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.40 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.05 | 0.9818 (55) | 1.0000 (51) | 1.0000 (48) | 1.0000 (25) | 1.0000 (6) | no pairs |
| 0.10 | 0.9818 (55) | 1.0000 (51) | 1.0000 (48) | 1.0000 (25) | 1.0000 (6) | no pairs |
| 0.20 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.40 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |

### weight.cohort_penalty

Baseline value: 0.90

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.50 | 17 | 1983 | 0.13 | 1.08 | 2 | 2 |
| 0.70 | 16 | 1984 | 0.07 | 0.55 | 1 | 1 |
| 0.90 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 1.00 | 15 | 1985 | 0.04 | 0.30 | 0 | 0 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.50 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.70 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.90 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 1.00 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.50 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.70 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.90 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 1.00 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |

### weight.common_funder_multiplier

Baseline value: 0.25

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.10 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 0.25 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 0.50 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 0.75 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.10 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.25 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.50 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.75 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.10 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.25 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.50 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.75 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |

### weight.portfolio_penalty

Baseline value: 0.70

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.30 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 0.50 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 0.70 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 0.90 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.30 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.50 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.70 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.90 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.30 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.50 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.70 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.90 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |

### suppression_neff_floor

Baseline value: 0.50

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.25 | 52 | 1948 | 0.00 | 0.00 | 37 | 37 |
| 0.50 | 15 | 1985 | 0.00 | 0.00 | 0 | 0 |
| 1.00 | 4 | 1996 | 0.00 | 0.00 | 11 | 11 |

Ordering at each setting, against the baseline ordering:

| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |
|---|---|---|---|---|---|---|
| 0.25 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 0.50 | 15 | 1.0000 | 0 of 105 | 1.0000 | 2 of 2 | 0 |
| 1.00 | 4 | 1.0000 | 0 of 6 | 1.0000 | 1 of 1 | 0 |

Agreement by how far apart the baseline puts the pair:

| Value | gap >= 0.00 | gap >= 1.00 | gap >= 2.00 | gap >= 5.00 | gap >= 10.00 | gap >= 20.00 |
|---|---|---|---|---|---|---|
| 0.25 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 0.50 | 1.0000 (105) | 1.0000 (93) | 1.0000 (81) | 1.0000 (40) | 1.0000 (7) | no pairs |
| 1.00 | 1.0000 (6) | 1.0000 (5) | 1.0000 (5) | no pairs | no pairs | no pairs |

## How to read the ordering tables

Pair agreement is the fraction of agent pairs that the baseline orders and the swept setting orders the same way. It is the direct measure of whether "A is better than B" survives the constant. Pairs the swept setting ties are counted in neither the agreed nor the inverted column, so agreement plus inversions can fall short of the ordered-pair total.

Spearman is the rank correlation over the whole cohort, reported in its standard form for comparison against other work. Top decile kept counts how many of the baseline's top-decile agents remain in the top decile, which is the claim a consumer gating on a threshold depends on. The decile is taken by score threshold rather than by count, so ties at the cut line widen the set rather than being broken arbitrarily, and both sides of the count are printed.

Worst rank shift is the largest number of positions any single agent moves. It is reported because the other three measures are cohort averages, and an average can stay excellent while one agent moves from second place to two hundredth.

Agents that one setting suppresses and another does not have no rank to compare and are excluded from these tables. That is a coverage effect rather than an ordering effect, and the suppression flips column above already reports it.

In the agreement-by-gap table each cell is the agreement among pairs separated by at least that margin, with the number of such pairs in brackets. Agreement normally rises as the margin widens, because a wider gap takes more disturbance to close. A cell reading no pairs means the cohort contains no pair that far apart, which is a statement about the cohort rather than about the constant.
