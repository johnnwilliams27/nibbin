# Most of the registry is operated by very few parties

77 percent of ERC-8004 agents on Base share a declared wallet with another
agent, and one wallet controls 10,241 of them. This was found while checking
something else, and it matters more than what was being checked.

Reproduce with `scripts/wallet-concentration.mts` against a cached registry log
history.

## The measurement

Every agent declares an `agentWallet` in registry metadata. Across the 84,589
agents on Base those declarations point at only 30,040 distinct addresses.

| Agents controlled by one wallet | Wallets |
|---|---|
| 1 | 19,095 |
| 2 to 5 | 10,151 |
| 6 to 20 | 654 |
| 21 to 100 | 100 |
| over 100 | 40 |

- 65,494 agents, 77.4 percent of the registry, share a wallet with at least one
  other agent.
- The fifteen largest clusters hold roughly 27,700 agents between them, about a
  third of the registry.
- The single largest holds 10,241 agents, 12 percent of everything registered.

## Why this matters to the methodology

SPEC 11.2 defends against sybil reviewers with three constants:
`cohort_penalty`, `common_funder_multiplier` and `portfolio_penalty`. All three
key off funder clustering, which asks whether two wallets were first funded from
the same source. That is circumstantial evidence of a relationship, it needs
account-level transfer history the index does not currently have, and it is
exactly the data the real-cohort export could not fill, so those three constants
are inert in every measurement made so far.

A shared `agentWallet` is better evidence and it is free. A common funder
suggests two parties are related. A common wallet means they are the same party,
declared by the agents themselves, in the registry, with no inference required.

The registry hands us a stronger sybil signal than the one the methodology was
designed around, and the methodology does not read it.

## What it says about the population

An operator running 10,241 agents from one wallet is not running 10,241
businesses. Registration is cheap and there are visible reasons to hold many
identities, so a substantial share of this registry is better understood as one
party's inventory than as a population of independent agents.

That reframes the coverage finding in `research/real-cohort-coverage.md`. The
index scores 0.75 percent of agents, which reads as a failure of coverage. Some
of the 99 percent it declines to score are agents nobody has reviewed because
nobody has used them, and they belong to clusters of thousands created by a
single operator. Declining to score those is the methodology working.

## What to do about it

Three things, in order of how settled they are.

**Report it.** Cluster size is a fact about an agent that a reader should see
next to its score, on the same argument that puts uncertainty in band with the
score. An agent that is one of 10,241 from one wallet is a different proposition
from an agent that is alone, whatever the two scores say.

**Use it as a reviewer weight input.** Two reviewers sharing a wallet are one
reviewer and should not count twice. This is the same rule the anti-flooding cap
already applies per address, extended to the cluster the address belongs to. It
needs a decision from the author rather than a quiet code change, because it
changes published scores.

**Consider it as a scoring input, carefully.** Cluster membership is not
misconduct. Legitimate operators run fleets, and penalising an agent for its
operator's other agents would punish scale rather than behaviour. The defensible
version weights down *reviews* that come from within a cluster, not the agent
being reviewed. Getting that distinction wrong would make the index
systematically unfair to the largest honest operators.

## Limits

This measures Base only. It measures declared wallets, so an operator using a
distinct wallet per agent is invisible to it and the true concentration is at
least this high, never lower. And it says nothing about intent: the measurement
shows common control, not what that control is used for.
