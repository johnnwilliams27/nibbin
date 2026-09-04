# Can ERC-8004 agent scores be calibrated against commerce outcomes?

Not today, and not for a reason that more engineering fixes. This records the
measurement so the conclusion can be checked rather than taken on trust.

Reproduce with `pnpm --filter @trust-index/indexer exec tsx
scripts/check-commerce-linkage.mts`, against a cached registry log history built
by `scripts/fetch-registry-logs.mts`.

## The question

SPEC 12 calibrates the index against real commerce outcomes: score an agent from
evidence available before a job, then check the job's outcome. Stage A6 built the
machinery to attach those outcomes and to stratify them by how confidently each
one attaches. All of that assumes outcomes exist for agents the index scores.
That assumption had never been checked.

## What was measured

Virtuals ACP is the commerce source with the most on-chain history. Its v1
contract on Base, `0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A`, is verified on
Sourcify and reports a `jobCounter` of 165,217. Its implementation emits
`JobCreated(uint256 jobId, address indexed client, address indexed provider,
address indexed evaluator)` and `JobPhaseUpdated(uint256 indexed jobId, uint8
oldPhase, uint8 phase)`, so both the parties and the terminal outcome of every
job are on chain and auditable. This is exactly the label source calibration
wants.

Sampling `JobCreated` across the period when ACP was settling jobs gives 145
distinct provider addresses and 869 distinct client addresses.

The registry side comes from the full cached Identity Registry history: 84,589
agents, 47,659 distinct owner and transfer-counterparty addresses.

| Link type | What it matches | Result |
|---|---|---|
| Moderate | ACP provider against an agent's owner or a transfer counterparty | 0 of 111 |
| Moderate | ACP client against the same set | 0 of 869 |
| Strong | ACP provider against an agent's declared wallet | 0 of 145 |

Not a small overlap. An empty one, on every link type the A6 design supports.

## Why, and why better matching would not help

The two populations barely coexisted.

ACP settled jobs from roughly block 32,000,000 to 43,507,333 on Base. The
ERC-8004 registries were not deployed until block 41,663,783. The overlap is the
tail of ACP's activity, and by then it was nearly finished: a 9,000-block window
at block 43,000,000 carries 16 logs, against 6,269 at block 35,000,000.

33,347 agents were registered at or before the last observed ACP job, so the
eligible set is not the problem. The problem is that ACP's agents and ERC-8004's
agents are different populations that happen to share a chain.

## A second finding, independent of the timing

Of those 33,347 eligible agents, 327 have a declared agent wallet. That is under
one percent.

The declared wallet is what the strong link matches on, so even against a
commerce source with perfect temporal overlap, the high-confidence linkage path
would be available for roughly one agent in a hundred. Attribution would fall
back to owner matching for everyone else, which is the weaker evidence the
linkage-arm comparison exists to be suspicious of.

## What this does and does not establish

It establishes that no calibration of these scores against Virtuals ACP outcomes
is possible, for us or for anyone, and that the obstacle is the composition of
the data rather than the ingest code. The A6 adapters, the linkage rules and the
arm comparison are all still correct; they have nothing to run against.

It does not establish that no commerce source works. Olas has not been checked
the same way and should be, using this script as the template. Nor does it say
the situation is permanent: the registries are three months old and adding
agents, and overlap can accumulate. It says the overlap does not exist yet.

## What would change the answer

- A commerce platform whose agents register on ERC-8004, so the two populations
  are the same population. This is the only real fix.
- Enough elapsed time for jobs to be settled by agents that are already
  registered.
- Agents declaring wallets, which would make the strong linkage path usable when
  outcomes do arrive.

Until one of those, every constant in the methodology stays provisional, and
`docs/NOTES-calibration.md` records what the untuned constants cost.
