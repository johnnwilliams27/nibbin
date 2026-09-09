# Trust Index learnings

## 2026-09-09 — Detail-evidence pre-merge review

Three distinct P1 findings and one P2 were found and resolved by four independent
reviewers; see `docs/gates/2026-09-09-detail-evidence.md`.

- JSON syntax is not proof of a successful detail response. Validate identity
  and interface field shapes before interpreting a null endpoint as evidence.
- Failure logs are historical. Derive current gaps from snapshot state, and do
  not let a stale 429 explain a corrupt cache.
- A shorter retry sleep does not bound a large run. Stop admitting work across
  the shared worker pool when the upstream quota is exhausted.
- Check the emitted HTML as well as pure helpers. Tests now cover all 112
  listed null-endpoint pages in the current snapshot.
- Excluded workspace members need explicit CI commands. The marketplace now
  participates in required typecheck, test and build jobs through npm.

Verification: 991 workspace tests passed (25 explicitly skipped), 16 marketplace
regressions passed, repository lint/typecheck passed, 240 marketplace pages built.
No paid/model calls introduced; no invented per-user COGS projection applies.

## 2026-09-09 — a2a_agent.v1, and what running a battery for the first time reveals

Building the A2A rating profile took an afternoon. Four of the five defects
below were found not by reading the code but by running it against 48 live
agents and then STARING AT THE MARGINAL COUNTS — pass/fail/undecided per check,
across the population — rather than at the scores. Every one of them was
invisible in a score and obvious in a tally.

- **A verdict column with zero failures is a bug report.** 76 pass, 0 fail on
  injection resistance looked like good news about the population. 14 of the 76
  came from calls that returned only a JSON-RPC error: the injected token cannot
  appear in a response that does not exist, so `obeyed` was false by
  construction and the agent was credited with resisting. Check the DENOMINATOR
  of every clean sweep.
- **A verdict column with mostly failures is also a bug report.** 57 of 76
  skills "non-deterministic" — every sampled pair byte-identical apart from the
  three UUIDs A2A requires to be fresh. Comparing whole envelopes measured the
  protocol, not the agent.
- **A screen is only as good as the vocabulary it delegates to.** `invokable`
  called `isMutatingName`, which carries the MCP verb list — written for tools
  that edit documents. It has `transfer` and `pay`; it has no `swap`, `stake`,
  `mint` or `withdraw`. The file's own header named those as the verbs that
  matter here, and the list enforcing them was reachable only from the examples
  check. Three financially-named skills were invoked. Re-read what a guard
  actually calls, not what its comment says it guards.
- **An arm that is undecidable three times in four is not measuring.** The
  malformed arm sent an empty text part, which is legal A2A. Robustness carries
  0.20 of the composite and was measured on nothing for 57 of 76 skills. It was
  recorded honestly as a gap, which is why nobody noticed: honest gaps are quiet.
- **A shared dimension id must mean one thing.** The first draft restated
  `functional_correctness` in A2A's vocabulary. `profiles.test.ts` caught it:
  two profiles would have published one column heading meaning two different
  things, which is exactly the comparability the profile exists to provide.

Engine: `dimension_coverage` could exceed 1 (measured 1.21). The note in
`rating/index.ts` predicted this would arrive with the first per-check
collector, and it did. Published weight was counted at full profile weight
against an assessable denominator that was fractional.

Result: 13 published composites -> 42, the A2A half going 0 -> 29 of 100
probed. The pre-fix run reported 34; five rested on the false injection passes.
