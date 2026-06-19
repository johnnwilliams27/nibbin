# Adversarial Gate Report — Training Mode (§18.1)

**Date:** 2026-06-19
**Branch:** `feat/training-mode` (rebased onto main incl. router #158 / browser #159 / memory #160)
**Surface:** an opt-in acceleration window on top of Agent School (§4.7) — autonomy/trust-load-bearing. Migration `20260619200000_training_sessions.sql` (new `training_sessions` table + 3 RPCs).
**Reviewers (4 lenses):** red-team · logic-skeptic · claims-auditor · cost-auditor.
**Verdict: PASS** — no P0/P1 from any reviewer. Four P2/P3s found and fixed in-branch (`c7f3180`).

## What it is
A member can opt one of their agents into a **time-boxed + budget-bounded** window during which the scheduler MAY sample extra triggers, so the agent surfaces more drafts-for-approval and accumulates School's approval signal faster. It is **strictly additive to School** — it never loosens the M4 gate:
- **No autonomy granted.** A window's only effect is that the scheduler may admit extra *supervised* runs; each still rides the unchanged runner gates (`gateSideEffect`, approval). `school.ts` / `runner.ts` / `planner.ts` / the gate path have a **0-line diff** — the non-loosening invariant holds *structurally*, not by assertion (`gateSideEffect` has no training parameter to pass).
- **Hard bounds.** Each window has a HARD time box (`expires_at`, SQL-clamped to [1h, 14d]) AND a HARD run budget (`max_runs`, clamped [1,100]); auto-expires (no row extends itself); opt-in (only a member opens it). Sampling is **service-role-only** (`training_sample` REVOKEd from authenticated) — a client can never accelerate its own sampling.
- **Scheduler not yet wired** — this builds the bounded substrate; `training_sample` is the seam a future scheduler calls. Infra-ahead-of-scheduler by design.

## Findings — no P0/P1
All four reviewers PASS. The headline non-loosening claim is verified structurally (no diff to the gate/School code; the only DB writes are to the new table). Hard bounds verified at three layers (TS `clampWindow`, SQL `greatest/least` clamps, table CHECK constraints).

### P2/P3s fixed (`c7f3180`)
| Lens | Issue | Fix |
|------|-------|-----|
| logic-skeptic | **Re-open lockout (P2).** With no sweep/cron, a window past its time box but not yet closed (`ended_at IS NULL`) was invisible to the idempotency SELECT (`now() < expires_at`) yet still held the `training_sessions_one_open` partial unique index → the INSERT raised `unique_violation` and locked the user out of re-opening training for that agent. | `training_open` now closes stale expired-but-open rows FIRST (`ended_reason='expired'`), under the `nibbins` row lock (`FOR UPDATE`, race-free per agent), before the idempotency SELECT + INSERT. |
| cost-auditor | **No per-account cap (P2).** Aggregate training cost (N agents × up-to-100 extra runs) was unbounded ahead of the scheduler wiring. | Per-account cap `max_open_per_account=3` on the INSERT path only (idempotent re-open of an existing agent's window still succeeds, so the cap never strands an already-open agent). |
| red-team | **Raw PG error leak (P3).** `openTrainingAction`/`closeTrainingAction` surfaced raw Postgres exception strings to the client. | `trainingErrorCopy()` maps limit-reached / unknown-nibbin / not-a-member / not-authenticated to human copy; falls back to a per-action generic. Raw PG strings no longer leak. |
| claims-auditor | **`recordSample` mislabel (P3).** The NULL (not-sampled) path fabricated `endedReason:'budget'` + forced `runsUsed:maxRuns`, mislabeling an *expiry* as budget. | NULL path now returns a closed, neutral window (`endedAtMs` set, no reason); `trainingClosedBy` reads a non-budget/undefined reason as the conservative `'time_box'`. Store test updated to assert closed-without-reason. |

### Carry-forward (non-blocking, tracked)
- **Scheduler wiring:** `training_sample` is unconsumed until the scheduler calls it; Training Mode surfaces extra drafts only once that seam is wired. No behavior change in production today.
- The per-account cap (3) and the [1,100]/[1h,14d] clamps are conservative defaults — revisit when the scheduler is live and real volume is observed.

## Verification (post-rebase + fixes)
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run packages/runtime/test apps/web/lib/runtime apps/web/app/app/nibbins` → **263 passed** (existing School/promotion/training suites green)
- `eslint …` → clean · `npm run build -w @nibbin/web` → Compiled successfully (24/24 static pages)

## Migration
`20260619200000_training_sessions.sql` — new `training_sessions` table (account-scoped, RLS member-read; INSERT/UPDATE/DELETE REVOKEd from authenticated) + `training_open` / `training_sample` (service-role-only) / `training_close` security-definer RPCs under `search_path=''`. No public VIEW. **Applied to dev / staging / prod** 2026-06-19.
