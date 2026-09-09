# CLAUDE.md — Nibbin (router)

Nibbin is an independent assessor of AI agents and the interfaces they expose.
We probe a subject's declared interface, measure how it actually behaves when called,
and publish a rating — or decline to, and say why. Subjects are ERC-8004 on-chain agents
and the MCP/A2A endpoints they declare.

The distinguishing property is that we **refuse to publish when the evidence is thin,
and record the reason**. Our inability to measure never becomes a fact about the subject.

**Read only what the task needs:**

| Working on | Read first |
|---|---|
| Anything (always) | `docs/STATE.md` (current state, open P0/P1) |
| The direction, positioning, what is settled | the trust-index direction doc (§11 lists what not to relitigate) |
| Hard rules you must not break | the rules section at the bottom of this file |
| Past mistakes & patterns | `docs/GOTCHAS.md` |
| The scoring engine (pure, no I/O) | `trust-index/packages/scoring` |
| Probing MCP servers | `trust-index/packages/collectors/src/mcp` |
| Probing A2A agents | `trust-index/packages/collectors/src/a2a` |
| Network safety (SSRF, DNS pinning) | `trust-index/packages/collectors/src/net.ts` — read before any outbound code |
| On-chain enumeration, registries, chains | `trust-index/packages/indexer` |
| Persistence, snapshots, credentials | `trust-index/packages/db` |
| The BNB agent-marketplace app | `trust-index/apps/bnb-marketplace` (+ its `DATA-CONTRACT.md`) |
| The v1 product (archived) | `ARCHIVE.md` — nothing was deleted; history has it all |

## The rules that are the product, not decoration

1. **A gap is never evidence.** "We could not obtain the data" is recorded as our failure,
   never as a fact about the subject. Only `harness_capability_missing` /
   `harness_capability_unhealthy` leave the completeness denominator.
2. **Never fabricate.** No invented agent, score, endpoint, or category — not even as a
   placeholder. A missing value is `null` plus a reason.
3. **401/403 is an auth wall**, a known and rateable state — not a dead endpoint.
   429 means alive and rate-limiting us. Judge by the body, never the status alone.
4. **Coverage is orthogonal to score.** Coverage is how much we looked; score is how good
   it is. Never merge them.
5. **Withholding is the product.** Do not soften it to make a number look better.
6. **Third-party data stays labelled** as third-party. Never present someone else's score
   as our measurement.
7. **Participation and payment never influence a score**, in any direction. We do not rank
   agents we deployed ourselves.

**Update protocol:** at every milestone gate update `docs/STATE.md`, append `LEARNINGS.md`,
and add new traps to `docs/GOTCHAS.md`. Keep this file under 50 lines — it is a router,
not a memory dump.
