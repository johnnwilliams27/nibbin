# Joint constant sweep

Source cohort: SYNTHETIC cohort (agents=200 cohort-seed=11). Establishes how the band behaves at scale; establishes nothing about real agents.
Draws: 202 of a 76800 point grid, seed 1

## What this establishes

Every constant is varied at the same time, and the worst effect on the cohort is reported. The per-constant sweep answers what one unverified value costs; this answers what all of them cost together, which is the honest position while none of them has been checked against outcomes.

The grid is sampled rather than enumerated: 202 draws out of 76800 combinations, from a seeded generator with no clock, so the same seed and cohort reproduce this band exactly. The two corners of the grid, every constant at its lowest and every constant at its highest, are always included. A sample gives a lower bound on the worst case: a combination worse than any drawn here is possible, and more draws tighten the bound without ever making it a proof.

As with the per-constant sweep, this measures stability rather than correctness. A band this analysis calls narrow can still be centred on the wrong value. Only calibration against real outcomes speaks to that.

## How far the score moves

| Measure | Worst observed |
|---|---|
| Mean score movement | 8.75 points, over 139 agents |
| Largest single score movement | 22.81 points |
| Agents changing coverage tier | 174 of 200 |
| Agents changing suppression state | 86 of 200 |
| Fewest agents any draw left scored | 114 of 200 |

The mean score movement is the figure to quote as the methodology band: the published score of a typical agent can move that far on the constant choice alone, and no amount of additional evidence about that agent narrows it. Only verifying the constants does.

The agent count beside it matters. Some constant combinations suppress most of the cohort, and a mean taken over the few survivors is a statement about those survivors. The last row shows how far coverage collapses at the worst draw, so a band resting on a handful of agents is visible rather than implied.

## How far apart two agents must be

Each of the 19894 tracked pairs is followed across every draw. A pair holds when every draw that could score both agents ordered them the way the baseline does; a draw that ties them does not support the ordering and counts against it, and a draw that suppresses either agent removes the comparison rather than breaking it. The figures below are therefore a property of the pairs, not of any single draw, which keeps a coverage collapse in one corner of the grid from standing in for an ordering result.

Two agents separated by at least 10.00 points keep their ordering under every constant combination drawn. That is the comparison the index can support today, before any constant is verified. Below that margin the ordering depends on constants nobody has checked, and the index should not be read as ranking those agents against each other.

| Baseline gap | Pairs | Held under every draw | Survival | Never evaluable |
|---|---|---|---|---|
| at least 0.00 | 19894 | 17506 | 0.8800 | 0 |
| at least 1.00 | 18885 | 17381 | 0.9204 | 0 |
| at least 2.00 | 17880 | 16983 | 0.9498 | 0 |
| at least 5.00 | 15040 | 14865 | 0.9884 | 0 |
| at least 10.00 | 10502 | 10501 | 0.9999 | 0 |
| at least 20.00 | 3848 | 3848 | 1.0000 | 0 |

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
- weight.age_ramp_days = 365
- weight.age_floor = 0.40
- weight.cohort_penalty = 0.50
- weight.common_funder_multiplier = 0.25
- weight.portfolio_penalty = 0.70
- suppression_neff_floor = 1.00

Rerun with `agent-trust-calibrate joint --cohort <dir> --draws 200 --seed 1` to reproduce these numbers exactly.
