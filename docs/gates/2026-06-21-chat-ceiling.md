# Gate — Tier-scaled daily chat ceiling + raised T2 budget (#230)

**Date:** 2026-06-21
**Branch:** `feat/chat-ceiling`
**Sensitive paths:** `packages/router/`, `packages/keeper/`, `supabase/migrations/`, the model-spend path → 4-reviewer gate.

## Verdict: PASS (after fixes)

Anti-runaway backstop on the web in-app Grovekeeper chat surface, per the founder principle "respect the credit limits people have, but prevent runaway spend." Every web chat turn (T0/T1/T2) draws a per-user/day ceiling, plan-scaled (Hatchling 150 / Grove 500 / Canopy 2000); past it, chat politely pauses for the UTC day and **never debits run-credits**. Plus the Sonnet T2 chat budget raised 5→15/day. New `chat_total` counter shares `frontier_budget` via a `kind` discriminator; migration applied + assertion-tested on dev/staging/prod.

Reviewers: red-team, logic-skeptic, cost-auditor, claims-auditor. **No reviewer found a P1 logic/correctness/claims/cost defect in the web path.** One P1 (scope), resolved below.

### Findings & resolution

- **P1 (red-team) — channel chat (Telegram/SMS) bypasses the #230 ceiling.** `ingest-deps.ts buildAnswer` calls the same `keeperChat` with `userId:''` and no `dailyChatCeiling`, so the ceiling never applies there; the code/comments claimed "EVERY chat turn." **Verified the channel path is NOT unbounded** — it has its own, stronger guard: `gateTurn` (per-account/channel turn limit + **dollar spend cap** + anomaly auto-pause, `packages/channels/.../budget.ts`). So this is a claim-scope defect, not a missing guard. **Resolved:** scoped all #230 claims to "web in-app chat" and documented the two-mechanism model (web = per-user/day turn ceiling; channels = channel spend-cap/anomaly gate) in `credits.ts`, `router.ts`, `types.ts`. Threading a redundant per-user turn ceiling into channels would be weaker than the dollar cap they already have, so we deliberately keep them separate.
- **P2 (red-team) — the 5→15 raise is the shared T2 cap, not chat-only.** `DEFAULT_DAILY_FRONTIER_BUDGET` is consulted by every budgeted T2 path. **Resolved:** reworded the constant's doc to state it's the shared per-user/day T2 grant; cost-auditor confirmed 15/day is ~$0.15/user/day worst case across surfaces — cost-safe.
- **P2 (logic) — the SQL RPC's `kind` discriminator had no committed test** (only InMemory was unit-tested). **Resolved:** added a pg integration test (`tests/rls/m65-budget.test.ts`) — the RLS harness applies the real migration chain, so it exercises the actual RPC: independence of the two `kind` counters in one (user, day), the cap, 3-arg back-compat, and the null-limit guard. (Also hand-validated on dev via assertions before staging/prod apply.)
- **P3 (claims + logic + red-team, convergent) — the recreated RPC dropped the original's `p_limit IS NULL` fail-loud guard.** Not reachable from current callers, but a removed defensive check. **Resolved:** restored `if p_limit is null or p_limit < 0` in the migration and re-applied the function (create-or-replace) to dev/staging/prod.
- **P3 (logic) — assert the paused decision's `budget` survives to the caller.** **Resolved:** added the assertion to the keeper chat test.
- **P3 (claims) — implicit PK-name dependency** in the migration. **Resolved:** added a comment noting the original PK was unnamed → `frontier_budget_pkey`.

### Accepted / follow-up (non-blocking)

- **P3 (cost-auditor) — Canopy's 2000 ceiling was a sustained-abuse margin edge.** A single runaway loop is bounded fine (~$4.67/day), but a user maxing 2000 turns *every* day with maxed output is ~$140/mo worst / ~$75/mo realistic vs the $79 price. **RESOLVED post-gate (founder decision): lowered Canopy 2000 → 1000**, so even the adversarial worst case (~$2.3/day → ~$70/mo) stays under the $79 price, while 1000 is still ~5-7× above any real human's daily chat. A monthly aggregate guard / anomaly auto-pause remains the better-targeted fix if sustained abuse ever materializes (channels already have anomaly auto-pause).

### Cost math (cost-auditor, adversarial maxed-output)

Worst-case $/user/day at the ceiling: **Hatchling ~$0.41** (target <$1 met), Grove ~$1.22, Canopy ~$4.67. The cap is checked before any model work, counts exactly once per turn, paused turns cost $0, and there are no leaks (scripted-floor and pipeline/diagnosis paths correctly accounted/exempt).

## Verification
- 223 unit tests pass (router/keeper/shared/grove); new ceiling + paused-budget tests included. pg integration test added for the RPC (CI service container; locally skips without DATABASE_URL).
- lint clean; tsc clean standalone (cross-package errors are the known worktree-junction `@nibbin/*` false-positives).
- Migration `20260621120000` applied to dev/staging/prod; RPC re-applied with the restored null guard; assertions verified on dev.
