# Adversarial Gate — Channel-Initiated Work (§7.3)

**Branch:** `feature/channel-initiated-work` (range `ca5c85c..` incl. gate-fix `6e42246`)
**Date:** 2026-06-19
**Plan:** `docs/superpowers/plans/2026-06-19-channel-initiated-work.md`
**Surface sensitivity:** HIGH — a verified Telegram user initiates real Planner work (frontier ReAct loop) from chat; ships DEFAULT-ON. Mandatory gate per AGREEMENTS.

## Scope
5 tasks: `channel_work_session` table + RPCs; channel-context planner wrappers (principal-explicit `proposePlanForChannel`/`startPlanRunForChannel`/`respondToPlanRunForChannel`); orchestrator session state machine (propose → Start → per-write approval → resume, all in chat); Telegram inline buttons + plan-callback parsing; live dep wiring. Gated by `CHANNELS_INITIATED_WORK_ENABLED`.

## Mechanical gates (post-fix)
- `npm run typecheck` clean · full `vitest run` green (1394+ tests, +152 in the fix wave) · `next build` ✓ · no `.js` specifiers.

## Reviewers (4 lenses)

| Lens | Model | Initial | Notes |
|---|---|---|---|
| Red-team (security/auth/RLS) | opus | PASS (no P1) | Writes cannot execute un-approved (student-stage drafts everything; FIX1 surface+draft-class re-assertion + CAS + idempotency reused on the channel path). No cross-account (sessions PK'd per binding; runs filtered by ingest-resolved accountId). RPCs service-role-only; injection clean; replay at-most-once. Raised **P2**: work path didn't require an attributable **active-member** actor. |
| Cost-auditor (§11 COGS) | opus | **PASS** | Channel-initiated cost is bounded: per-user daily frontier budget (5/day, durable/atomic/fail-closed) is the binding cap; `origin:'chat'` can't be spoofed to unbudgeted; resumes can't reset budget or the 12-iter ceiling; per-run ceilings + 3-concurrent secondary. Full `model_calls` tally. P3: crash-orphaned `running` slot (self-DoS, not cost). |
| Claims-auditor (contract) | sonnet | BLOCK | RPC param contracts, callback round-trip literals, channel.ts↔actions.ts parity, flag degrade, migration numbering all verified clean. Raised **P1** (empty `userId` reaches `proposeWork`) + **P2** (vacuous ceiling test). |
| Logic-skeptic (edge/race) | sonnet | BLOCK | Raised **3×P2**: stray `planAction`+active session consumed as a typed answer; `ps:go` with null plan orphans the session; `userId` empty-string fallback. + P3 unknown-outcome swallow. |

## Findings fixed (commit `6e42246`)
- **P1 — actor authorization (claims P1 / red-team P2 / logic P2):** `userId` now resolved only when `linked_by` is non-null AND an **active membership** exists (mirrors `decideViaChannel`); the `''` fallback removed; every work-initiating/resuming path (propose, `ps:go`, `pw:approve`, `pw:reject`, free-text answer) gates on a present `userId` → honest-degrade otherwise. Closes the invariant violation + the per-user-budget-bucket collapse.
- **P2 — stray planAction:** an active session + any `planAction` now nudges and returns before the free-text branch (no callback string submitted as an answer).
- **P2 — ps:go null plan:** clears the session + errors instead of orphaning it.
- **P2 — vacuous ceiling test:** new test posts a widened plan (`maxTokens:999999`) and asserts the run executes clamped to canonical `PLAN_CEILINGS`.
- **P3 — stale Approve consent fidelity:** approval buttons carry `pw:approve:<requestId>`; parser extracts `planRequestId`; a stale tap's id mismatch makes `respondToRequest` re-prompt the current pending draft instead of approving it.
- **P3 — unknown outcome:** `applyOutcome` fallback clears the session + honest-degrades.
- **Tally (cost CHECK 7):** `recordModelCall.origin` defaulted to `null` → channel planner calls were mis-tagged in the COGS-by-channel view; added `origin:'chat'` to the 4 `plan_synthesis` sites (budgeting unchanged).

**Result: PASS after fixes** (4/4; the two BLOCKs both reduced to the single actor-authorization root + the test/quality items, all fixed and tested; red-team + cost-auditor PASS on the core invariants — no unapproved writes, no cross-account, bounded cost).

## Deferred (documented, non-blocking)
- Crash-orphaned `plan_runs.status='running'` slot reaper (pre-existing planner concern, not channel-specific; daily frontier budget is the real cost cap).
- `actions.ts`↔`channel.ts` core convergence (replicated with a TODO).

**Human sign-off:** pending (per AGREEMENTS).
