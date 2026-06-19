# Adversarial Gate Report — Routing Reinforcement Slice A (signal substrate + scoreboard)

**Date:** 2026-06-18
**Branch:** `feat/routing-reinforcement-sliceA`
**Surface:** sensitive (touches `supabase/migrations/`) but **pure observability** — adds model-performance signals + an aggregate scoreboard; does NOT change routing. Migration `20260618170000_model_call_signals.sql`.
**Spec:** `docs/superpowers/specs/2026-06-18-routing-reinforcement-sliceA-design.md` · **Plan:** `docs/superpowers/plans/2026-06-18-routing-reinforcement-sliceA.md`
**Reviewers (4 lenses):** red-team · logic-skeptic · claims-auditor · cost-auditor
**Verdict: PASS** — no surviving P0/P1. The gate found NO P0; one **P1 (a SQL fan-out join corrupting quality metrics)** + several P3s were fixed in-branch. The P1 fix was verified against a real database (below).

## What this slice is (and isn't)
Adds three additive `model_calls` signals (`outcome` incl. ledgering previously-invisible model failures, `degraded`, `latency_ms`), an aggregate `model_task_performance` view + a staff-gated read RPC, and a read-only admin scoreboard — the foundation a future reinforcement *policy* (Slice B) will read, and immediately useful for the team's manual eval-gated model choices + provider-churn detection. **`route()`/`tiers.ts`/`router.ts` are untouched** (`git diff packages/router/src` empty; a `route-unchanged` test pins the real config) — zero routing-behavior change.

## Findings & dispositions
| # | Lens | Sev | Finding | Fix |
|---|------|-----|---------|-----|
| 1 | logic-skeptic | **P1** | **Fan-out join.** `approvals.run_id` is UNIQUE (one decision per run) but `model_calls` has MANY rows per `run_id` (runner: one per prompted compose step; planner: one per ReAct iteration). The naive `LEFT JOIN approvals ON run_id` multiplied the single approval by the run's model_call count → `decided_calls`/`approved_unedited`/`edited`/`rejected` over-counted, `avg_edit_distance` model_call-weighted. A truly-50%-approved model could read as 80% — corrupting the exact quality signal Slice B reinforces on. | The view is now two CTEs joined per `(model,task,tier)`: a **volume** CTE over all model_calls (cost/outcome/latency — unchanged) and a **quality** CTE that aggregates over `select distinct run_id, model, task, tier` BEFORE joining the unique approval, so one decided run counts once. **Verified on a real DB** (dev fixture, 3 model_calls sharing one run_id + 1 approval): naive → `decided_calls=4, approved_unedited=3`; fixed → `decided_calls=2, approved_unedited=1`. ✅ |
| 2 | logic-skeptic | P3 | Chat `degraded` read post-reset (`chat.ts` resets `decision` to the floor on failure, dropping `degraded`) → a degraded-then-failed chat call ledgered `degraded:false`. | Capture `dispatchedDegraded` in `chat.ts` (alongside `dispatchedTier`) + thread to both failure-ledger sites. +2 keeper tests. |
| 3 | logic-skeptic | P3 | Genuine model throws in `extract.ts`/`learned-note.ts` unledgered (broad catch covers DB writes too) — contradicts the "no longer invisible" framing. | Narrow inner try around just the `llm(...)` call records an `outcome:'error'` content-free row, then re-throws into the broad catch — a provider throw is ledgered; a DB-write failure isn't mis-attributed. |
| 4 | red-team | P3 | `read.ts` unchecked `as PerformanceRow[]` cast (NaN on shape drift); `compose.ts` failure row omitted `degraded`. | Added `isPerformanceRow` shape guard (throws on drift, not NaN); `compose.ts` threads `degraded:false` explicitly. |
| 5 | cost-auditor | P3 | The view's window + group-by could scan heavily as `model_calls` grows. | Added covering index `model_calls (created_at, model, task, tier)` to the migration (free — not yet applied at the time). |
| — | claims-auditor | P3 | The admin scoreboard test might be skipped if admin CI ran vitest scoped to the admin root. | Verified moot: CI runs `npm test` → `vitest run` from the **repo root** (`ci.yml`), which picks up the test (passes 8/8). No action. |

### Verified clean (not findings)
- **Red-team: no P0/P1** — no content path into failure-ledger rows (only model/task/tier/outcome + zero tokens; `err.message`→`console.error` only); the view/RPC are aggregate-only with no identifiers; the view itself is revoked from `authenticated`; the RPC is `security definer`/service-role-only; the staff page gates before any read + rethrows on RPC error; SQL is fully static; the ledger insert is try/catch-swallowed (can't crash a real run).
- **Cost-auditor: PASS** — pure observability; bounded 1:1 writes (one ledger row per call); no success-path round-trip regression; negligible timing overhead; zero new model calls; recording path can't throw.
- **Claims-auditor: PASS** — all five headline claims TRUE (no-routing-change via real router import; failure-row content allowlist; staff gate at all three layers; schema-correct staff predicate; `staff_log_access` is a real audit RPC). No tautological tests, no overclaims, no stray files.

## Verification (post-fix)
- `npx tsc --noEmit -p apps/web && -p apps/admin` → exit 0
- `npx vitest run apps/web/ apps/admin/ packages/` → **1073 passed (2 skipped)**; `packages/router` suite **47 passed, unchanged** (no routing change)
- `npx eslint …` → clean · `npm run build -w @nibbin/web && -w @nibbin/admin` → both Compiled successfully
- `git diff --stat origin/main...HEAD -- packages/router/src` → empty
- **P1 fix verified on a real DB** (dev seeded-fixture query — see Finding 1).

## Migration
`20260618170000_model_call_signals.sql` — 3 additive `model_calls` columns + the covering index + the two-CTE `model_task_performance` view + the staff read RPC. **Applied to dev / staging / prod** (dev fan-out-fix verified by fixture query before staging/prod).

## Deferred — arc state
**Slice B (the reinforcement policy)** reads this substrate: candidate sets per task = the eval-cleared allowlist; a deterministic weighting that shifts traffic among pre-vetted models by quality-within-budget, with min-volume floors — gated by the eval-suite decision. Plus the other remaining synthesis-adjacent pieces (browser/`computer_use`, Training Mode, the two Planner follow-ups). All separate, larger designs.
