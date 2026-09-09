# Agent Trust Index

Scores for ERC-8004 agents that carry their own uncertainty. Every score ships
with a 95% interval, an effective sample size, and a coverage tier, computed by
a deterministic engine anyone can rerun from public chain data.

The full build specification is in [SPEC.md](./SPEC.md). This directory is a
self-contained pnpm workspace, separate from the repository that hosts it.

## Layout

```
packages/types      shared contracts: AgentSnapshot, ScoreResult, envelopes
packages/scoring    the estimator: pure functions, no I/O, fixed-point math
packages/db         schema, migrations, query layer
packages/indexer    chain backfill + poller
apps/web            Next.js frontend + /api/v1 + MCP
contracts           AnchorRegistry + ScoreOracle (Foundry)
fixtures            committed AgentSnapshot fixtures + golden ScoreResult outputs
research            reviewer-analysis, comparative-analysis (artifacts, not served)
docs                methodology, runbook, track NOTES
```

## Getting started

```
pnpm install
pnpm typecheck
pnpm test
```

The scoring engine never reads the network or the clock. It takes a materialized
`AgentSnapshot` and returns a `ScoreResult`; the committed fixtures in
`fixtures/` are the reproduction contract. See SPEC.md §22 for the determinism
guarantees.
