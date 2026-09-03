# Constant sensitivity report

Source cohort: fixtures/snapshots (11 snapshots)

## What this establishes

Each constant below is swept across a plausible range and the cohort is rescored at every setting. The tables report how far scores move and how many agents change coverage tier.

This shows stability, not correctness. A constant can be perfectly stable and still be the wrong value. SPEC 12 permits shipping an untuned constant as provisional when its sweep is stable, and requires flagging one whose sweep is not. Nothing here promotes a constant to tuned; only a calibration run against real outcomes can do that.

The magnitudes below describe this cohort. A small or unrepresentative cohort gives an indicative reading, not a population statement: a constant that looks stable here can still move scores materially across the real index, and a tier change count is bounded by how many agents sit near a boundary in the first place. Read the ranking of constants by risk, which is robust, ahead of the absolute shifts, which are not.

## Summary

| Constant | Baseline | Worst mean score shift | Worst tier changes | Stable |
|---|---|---|---|---|
| shrinkage_k | 5.00 | 10.30 | 0 | no |
| decay_half_life_days | 120 | 5.68 | 4 | no |
| weight.age_ramp_days | 365 | 0.67 | 1 | no |
| weight.age_floor | 0.20 | 0.19 | 1 | no |
| weight.cohort_penalty | 0.90 | 0.26 | 0 | yes |
| weight.common_funder_multiplier | 0.25 | 0.98 | 1 | no |
| weight.portfolio_penalty | 0.70 | 0.95 | 1 | no |
| suppression_neff_floor | 0.50 | 0.00 | 3 | no |

7 of 8 constants move the published output materially across their plausible range: shrinkage_k, decay_half_life_days, weight.age_ramp_days, weight.age_floor, weight.common_funder_multiplier, weight.portfolio_penalty, suppression_neff_floor. These carry the most risk while untuned and should be named on the methodology page.

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

### decay_half_life_days

Baseline value: 120

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 30 | 5 | 6 | 5.68 | 16.78 | 4 | 2 |
| 60 | 5 | 6 | 2.11 | 5.99 | 3 | 2 |
| 120 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 240 | 7 | 4 | 1.39 | 3.21 | 0 | 0 |
| 365 | 7 | 4 | 1.96 | 4.44 | 1 | 0 |

### weight.age_ramp_days

Baseline value: 365

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 90 | 7 | 4 | 0.67 | 4.56 | 0 | 0 |
| 180 | 7 | 4 | 0.33 | 2.16 | 0 | 0 |
| 365 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 540 | 6 | 5 | 0.39 | 1.03 | 1 | 1 |

### weight.age_floor

Baseline value: 0.20

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.05 | 6 | 5 | 0.01 | 0.02 | 1 | 1 |
| 0.10 | 6 | 5 | 0.01 | 0.02 | 1 | 1 |
| 0.20 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 0.40 | 7 | 4 | 0.19 | 1.25 | 0 | 0 |

### weight.cohort_penalty

Baseline value: 0.90

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.50 | 7 | 4 | 0.26 | 1.66 | 0 | 0 |
| 0.70 | 7 | 4 | 0.13 | 0.85 | 0 | 0 |
| 0.90 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 1.00 | 7 | 4 | 0.07 | 0.45 | 0 | 0 |

### weight.common_funder_multiplier

Baseline value: 0.25

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.10 | 6 | 5 | 0.00 | 0.01 | 1 | 1 |
| 0.25 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 0.50 | 7 | 4 | 0.53 | 3.70 | 0 | 0 |
| 0.75 | 7 | 4 | 0.98 | 6.77 | 0 | 0 |

### weight.portfolio_penalty

Baseline value: 0.70

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.30 | 7 | 4 | 0.95 | 3.60 | 0 | 0 |
| 0.50 | 7 | 4 | 0.49 | 1.89 | 0 | 0 |
| 0.70 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 0.90 | 6 | 5 | 0.27 | 1.03 | 1 | 1 |

### suppression_neff_floor

Baseline value: 0.50

| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |
|---|---|---|---|---|---|---|
| 0.25 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 0.50 | 7 | 4 | 0.00 | 0.00 | 0 | 0 |
| 1.00 | 4 | 7 | 0.00 | 0.00 | 3 | 3 |
