# Gate — Bug cleanup: runtime (#43, #44, #47)

**Date:** 2026-06-20
**Branch:** `fix/bug-runtime`
**Sensitive paths:** `packages/runtime/`, `apps/web/lib/runtime/`, `supabase/migrations/` (nibbin_demote RPC) → gate required.

## Verdict: PASS (controller review)

270/270 runtime tests pass; lint clean; no new tsc errors.

- **#43 — just-demoted/paused Nibbin still executed mid-run.** `dispatchStep` now re-reads fresh stage+status (new `deps.runs.getNibbin()`) immediately before the execute decision; a Nibbin demoted/paused/sleeping after admission drafts-not-executes. `stage_changed_at` threaded through `NibbinRef`/loaders. Tests: demote-mid-run → draft, pause-mid-run → draft, control grad run still executes.
- **#44 — routine-pattern trust never reset on demotion.** `RoutineStore.approvedCount` gained a `sinceMs` param (= `stage_changed_at`), filtering approvals to `decided_at >= stage_changed_at`, so demotion truly resets the pattern climb (§4.7). Test: pre-demotion approvals don't count.
- **#47a — `nibbin_demote` member-callable griefing — NOT FIXED HERE (escalated).** The proposed owner/admin role gate directly contradicts an explicit M4 design encoded in the RLS attack suite: *"demotion is one click for a member, floors at student, and resets the climb"* (`tests/rls/m4-runtime.test.ts`). The role gate was built + applied, then **reverted** (migration removed; original `is_account_member`-based `nibbin_demote` restored on dev/staging/prod) because flipping a deliberate spec behavior is a product decision, not a gate auto-fix. #47 stays OPEN for John: keep member self-demote (current/spec) vs. gate it (anti-griefing) vs. the richer per-Nibbin ownership check.
- **#47b** — addressed structurally by #43 + #44 (stage re-read + stage-scoped approvals); no standalone change.
- **#47 cosmetic P3s** — noted, not fixed (non-blocking observations; listed in REPORT.md).

## Scope note
This PR ships only #43 and #44 (unambiguous correctness fixes). #47's authorization change is escalated (see above) — the original member-callable `nibbin_demote` is preserved, so the M4 RLS suite passes unchanged.
