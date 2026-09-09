# Can ERC-8004 agent scores be calibrated against commerce outcomes?

Not by matching wallet addresses, which is what everything below tests and what
every attempt in it concludes. But address matching turns out to be the wrong
instrument, and the section "The link is published, not inferable" at the end
records what replaces it. Read that first: it materially qualifies the negative
results above it.

Reproduce with `scripts/check-commerce-linkage.mts` and
`scripts/match-acp-wallets.mts`, against a cached registry log history built by
`scripts/fetch-registry-logs.mts`.

## The question

SPEC 12 calibrates the index against real commerce outcomes: score an agent from
evidence available before a job, then check the job's outcome. Stage A6 built the
machinery to attach those outcomes and to stratify them by attribution
confidence. All of it assumes outcomes exist for agents the index scores. That
assumption had never been checked.

## The commerce source is real and its outcomes are usable

Virtuals ACP is an escrow and settlement contract for agents hiring agents. Its
v1 contract on Base, `0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A`, is verified on
Sourcify and reports 165,217 jobs. It emits both the parties to a job
(`JobCreated`) and every phase transition (`JobPhaseUpdated`), so outcomes are
auditable rather than reported.

Scanning the post-registry window exhaustively, blocks 41,663,783 to chain head:

| Terminal outcome | Jobs |
|---|---|
| Completed | 1,014 |
| Expired | 1,280 |
| Rejected | 170 |

3,017 jobs from 122 distinct providers and 167 distinct clients. As a label set
this is better balanced than expected: failures outnumber successes, so the
negative class is not the usual problem. The missing piece is disputes, which the
contract has no state for, so the SPEC 12.3 discrimination view cannot be
populated from this source however the linkage question resolves.

## The populations do not intersect

| Link type | What it matches | Result |
|---|---|---|
| Moderate | ACP provider against an agent's owner or transfer counterparty | 0 of 122 |
| Moderate | ACP client against the same set | 0 of 167 |
| Strong | ACP provider against a declared agent wallet | 0 of 122 |
| Strong | ACP client against a declared agent wallet | 0 of 167 |

The strong link runs against all 84,589 agents' declared wallets, 30,040 distinct
addresses. Not a thin overlap: an empty one, on every path the A6 design
supports, in both directions, over the window where both populations exist.

## Two wrong turns, recorded because the method matters more than the answer

**Sampling cannot answer "did this stop".** An earlier version concluded ACP had
stopped settling jobs, from 9,000-block windows spread across its history. ACP's
rate fell from roughly 650 jobs a day to roughly 13, and at that rate such a
window expects about three jobs, so a run of zeros is consistent with activity
continuing. The contract's monotonic `jobCounter`, read at two historical blocks,
showed thousands of jobs in exactly the period the sampling called empty. Read a
counter or scan exhaustively; do not sample.

**An empty result from one access path is not evidence of absent data.** An
earlier version reported that 327 of 33,347 agents declare a wallet, under one
percent, and treated the strong linkage path as largely unavailable.
`getAgentWallet(uint256)` returns zero for nearly every agent, but the registry's
`MetadataSet` events carry an `agentWallet` key for all 84,589 of them. The
declaration was always there; the getter is not where it lives.

Both mistakes share a shape that recurred throughout this work: a failure to
obtain data read as a fact about the data. A rate limit read as a nonexistent
token, an HTTP 500 read as a server fault, an oversized batch read as a malformed
response, a getter returning zero read as an undeclared wallet.

## Why, and why better matching will not help

ACP settled its jobs from roughly block 32,000,000 onward and the ERC-8004
registries were not deployed until 41,663,783, so the overlap is the tail of
ACP's activity. But the timing is not really the obstacle. Even within that tail,
across 3,017 jobs and 289 distinct parties, not one address belongs to a
registered agent. ACP's agents and ERC-8004's agents are different populations
that share a chain.

## ACP v2, where the activity actually is

v1 is not where ACP runs any more. The v2 deployment at
`0xa6C9BA866992cfD7fd6460ba912bfa405adA9df0` is a modular system whose
`jobManager` module (`0x9c690c267f20c385f8a053f62bc8c7e2d4b83744`) is busy:
1,924 jobs in the ~500,000 blocks to 50,853,288, roughly twelve days.

Scanning that window with `scripts/check-acp-v2.mts`:

| | Count | Matching a declared agent wallet |
|---|---|---|
| Providers | 12 | 0 |
| Clients | 35 | **2** |
| Evaluators | 7 | 0 |

The two client matches are agents 61440 and 58627. This is the first non-empty
intersection found anywhere in this investigation, and it is the wrong side of
the transaction: a job's outcome is evidence about the provider who did the
work, not about the client who commissioned it. Zero providers match, so there
are still no usable labels.

Two other things the window shows. The provider set is tiny and concentrated,
twelve addresses serving 1,924 jobs, so even a perfect linkage would yield at
most twelve labeled agents against a floor of thirty. And the terminal outcomes
in-window are sparse (1 completed, 24 rejected, 1 expired against 386 jobs still
in negotiation), because jobs created recently have not resolved yet; a wider
window would be needed before the outcome mix means anything.

What this changes: the populations are beginning to touch, which they were not
on v1. Two registered agents are transacting on ACP today. That is worth
re-checking on a schedule rather than concluding from once, because the trend
matters more than the current count.

## What this does and does not establish

It establishes that no calibration against Virtuals ACP v1 is possible, for this
project or anyone, and that the obstacle is the composition of the data rather
than the ingest code. The A6 adapters, linkage rules and arm comparison are
correct; they have nothing to run against.

It does not establish that no commerce source works. ACP v2 is checked above and
is the near miss: two registered agents are transacting there, on the client
side. Olas has not been examined the same way. And the multi-chain census
(`scripts/chain-census.mts`) shows Base is the only chain of twelve with an
observed reputation layer, so the search for outcomes should stay on Base rather
than widen.

## What would change the answer

- Check Olas, which the outcome mapping still covers only from documentation.
- A commerce platform whose agents register on ERC-8004, so the two populations
  are one population. This is the only durable fix.
- Elapsed time: the registries are seven months old and the overlap can only
  accumulate.

Until one of those, every constant in the methodology stays provisional, and
`docs/NOTES-calibration.md` records what the untuned constants cost.

## The link is published, not inferable

Everything above matches wallet addresses. That was the wrong instrument, and
the negative results it produced are real but narrower than they read.

Agents publish a metadata URL, and for agents that work on a commerce platform
that URL names the platform and their identity on it. Counting hosts across the
42,750 agents with an http(s) agentURI:

| Host | Agents |
|---|---|
| marketplace.olas.network | 637 |
| api.acp.virtuals.io | 181 |
| acpx.virtuals.io | 155 |

Roughly 970 agents on Base declare themselves as belonging to one of the two
commerce platforms this project cares about. The registry and those platforms
were never disjoint populations; their *wallets* are disjoint, because the
address an agent registers is not the address it trades from.

The Olas URLs carry the platform's own agent id in the path. Agent 3 publishes
`https://marketplace.olas.network/erc8004/base/ai-agents/1`, which resolves to a
registration document naming it `nekto-ramar05 by Olas` and describing a mech
that executes on-chain AI tasks. That is a direct, published mapping from an
ERC-8004 agent id to an Olas agent id, needing no inference at all.

What this does not yet establish: whether per-agent job outcomes can be
retrieved from Olas for those ids. That is the next measurement, and it decides
whether calibration is possible. Roughly 970 candidate agents is well above the
thirty-agent floor, so the question is now about the outcome data rather than
about the population.

What it does establish: "the populations do not intersect" is too strong. The
correct statement is that they do not intersect *on wallet addresses*, and the
linkage machinery in `packages/indexer/src/commerce/linkage.ts`, which matches
on addresses only, cannot see a link that is sitting in plain text in the
registry's own metadata.
