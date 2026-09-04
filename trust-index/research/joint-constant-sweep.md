# Joint constant sweep

Source cohort: ../../fixtures/snapshots (11 snapshots)
Draws: 2002 of a 76800 point grid, seed 1

## What this establishes

Every constant is varied at the same time, and the worst effect on the cohort is reported. The per-constant sweep answers what one unverified value costs; this answers what all of them cost together, which is the honest position while none of them has been checked against outcomes.

The grid is sampled rather than enumerated: 2002 draws out of 76800 combinations, from a seeded generator with no clock, so the same seed and cohort reproduce this band exactly. The two corners of the grid, every constant at its lowest and every constant at its highest, are always included. A sample gives a lower bound on the worst case: a combination worse than any drawn here is possible, and more draws tighten the bound without ever making it a proof.

As with the per-constant sweep, this measures stability rather than correctness. A band this analysis calls narrow can still be centred on the wrong value. Only calibration against real outcomes speaks to that.

## How far the score moves

| Measure | Worst observed |
|---|---|
| Mean score movement | 20.04 points, over 2 agents |
| Largest single score movement | 36.18 points |
| Agents changing coverage tier | 7 of 11 |
| Agents changing suppression state | 5 of 11 |
| Fewest agents any draw left scored | 2 of 11 |

The mean score movement is the figure to quote as the methodology band: the published score of a typical agent can move that far on the constant choice alone, and no amount of additional evidence about that agent narrows it. Only verifying the constants does.

The agent count beside it matters. Some constant combinations suppress most of the cohort, and a mean taken over the few survivors is a statement about those survivors. The last row shows how far coverage collapses at the worst draw, so a band resting on a handful of agents is visible rather than implied.

## How far apart two agents must be

Each of the 21 tracked pairs is followed across every draw. A pair holds when every draw that could score both agents ordered them the way the baseline does; a draw that ties them does not support the ordering and counts against it, and a draw that suppresses either agent removes the comparison rather than breaking it. The figures below are therefore a property of the pairs, not of any single draw, which keeps a coverage collapse in one corner of the grid from standing in for an ordering result.

No tested margin reaches the survival threshold. On this cohort no comparison between two agents is safe from the joint constant choice at any separation measured here. That is the finding, and it belongs on the methodology page rather than softened: the index can rank agents only to the extent its unverified constants happen to be right.

| Baseline gap | Pairs | Held under every draw | Survival | Never evaluable |
|---|---|---|---|---|
| at least 0.00 | 21 | 9 | 0.4286 | 0 |
| at least 1.00 | 19 | 9 | 0.4737 | 0 |
| at least 2.00 | 16 | 9 | 0.5625 | 0 |
| at least 5.00 | 14 | 9 | 0.6429 | 0 |
| at least 10.00 | 10 | 8 | 0.8000 | 0 |
| at least 20.00 | 8 | 6 | 0.7500 | 0 |

Survival normally rises as the margin widens, because a wider gap takes more disturbance to close. Never evaluable counts pairs at that margin which no draw could score, because at least one of the two agents was suppressed in every draw; those pairs are excluded from the survival figure rather than counted as holding.

## Reproduction

Axes swept:

- shrinkage_k: 1, 2.50, 5.00, 10, 20
- decay_half_life_days: 30, 60, 120, 240, 365
- weight.age_ramp_days: 90, 180, 365, 540
- weight.age_floor: 0.05, 0.10, 0.20, 0.40
- weight.cohort_penalty: 0.50, 0.70, 0.90, 1.00
- weight.common_funder_multiplier: 0.10, 0.25, 0.50, 0.75
- weight.portfolio_penalty: 0.30, 0.50, 0.70, 0.90
- suppression_neff_floor: 0.25, 0.50, 1.00

Constant combination producing the worst score movement:

- shrinkage_k = 20
- decay_half_life_days = 30
- weight.age_ramp_days = 180
- weight.age_floor = 0.10
- weight.cohort_penalty = 0.70
- weight.common_funder_multiplier = 0.10
- weight.portfolio_penalty = 0.90
- suppression_neff_floor = 1.00

Rerun with `agent-trust-calibrate joint --cohort <dir> --draws 2000 --seed 1` to reproduce these numbers exactly.
