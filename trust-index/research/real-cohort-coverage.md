# Coverage report

Source cohort: ../../cohort-base (2000 snapshots)

## What this establishes

How many agents receive a published score, and where the rest are lost. The sensitivity and joint sweeps measure how far a score moves; neither says how many agents have one. On a real registry that turns out to be the more consequential number, and a band around a score almost nobody carries is not a headline.

## Where agents are lost

| Stage | Agents | Share of cohort |
|---|---|---|
| In the cohort | 2000 | 100.00% |
| Carry any feedback | 743 | 37.15% |
| Carry usable feedback | 712 | 35.60% |
| Receive a published score | 15 | 0.75% |

The three stages fail for different reasons and have different fixes. An agent with no feedback cannot be scored by any constant setting. An agent whose feedback is all revoked or all scale-uninferable is excluded by SPEC 11.10, which excludes rather than guesses at a scale. An agent that clears both and still has no score was suppressed for insufficient evidence weight, and that last one is a constant choice.

Mean n_eff across the cohort is 0.0478, against a suppression floor of 0.50, and the highest any agent reaches is 1.660. The index publishes 15 distinct score values, which bounds how finely it can rank regardless of anything else.

| Coverage tier | Agents |
|---|---|
| none | 1985 |
| thin | 15 |

## Why the evidence weighs so little

743 agents have at least one reviewer. The median such agent has 1, the 90th percentile has 3, and 401 have exactly one.

That interacts with two rules that are individually reasonable. One reviewer one vote (SPEC 11.1, and the anti-flooding cap) means a reviewer contributes at most their own weight no matter how many reviews they leave, so an agent reviewed by one address cannot exceed an n_eff of one however much that address says. The age ramp and time decay then discount that single contribution well below one. A floor of 0.50 therefore asks for something close to three recent, fully weighted, distinct reviewers, and most agents on the registry have one reviewer of unknown age.

## Separating the methodology from the inputs

Some of the shortfall is ours rather than the methodology's: an index build that cannot date a reviewer's wallet understates the age ramp, and one that reads a short history still applies decay. The first two variations below disable those effects to bound that artifact. They are not proposed settings, and neither is a fix. The last two vary the suppression floor itself, which is a real constant choice.

| Variation | Purpose | Agents scored | Share | Mean n_eff |
|---|---|---|---|---|
| baseline constants | baseline | 15 | 0.75% | 0.0478 |
| age ramp removed (age_floor = 1.00) | bounds an input artifact | 39 | 1.95% | 0.0865 |
| time decay removed (half life 100000 days) | bounds an input artifact | 84 | 4.20% | 0.1150 |
| age ramp and decay both removed | bounds an input artifact | 292 | 14.60% | 0.2026 |
| suppression floor halved (0.25) | constant choice | 52 | 2.60% | 0.0478 |
| suppression floor effectively removed (0.01) | constant choice | 708 | 35.40% | 0.0478 |

Reading this: even with every age and decay effect removed, which is more generous than any real index build could justify, coverage reaches 14.60%. So the shortfall is not mainly an artifact of thin inputs. Removing the suppression floor instead reaches 35.40%, which is close to the share of agents carrying usable feedback at all. The floor, not the evidence, is what decides coverage here.

None of this says the floor is wrong. Publishing a score from a single unverified review may well be worse than publishing nothing, and SPEC 12 is explicit that a sparse-coverage finding should be reported rather than hidden. It does say the floor is the single most consequential constant in the methodology, that it is currently unverified like the rest, and that it should be tuned against outcomes before the index claims to cover a registry.
