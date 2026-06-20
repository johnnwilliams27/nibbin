# Gate — Bug cleanup: runtime (#43, #44, #47)

**Date:** 2026-06-20
**Branch:** `fix/bug-runtime`
**Sensitive paths:** `packages/runtime/`, `apps/web/lib/runtime/`, `supabase/migrations/` (nibbin_demote RPC) → gate required.

## Verdict: PASS (controller review)

270/270 runtime tests pass; lint clean; no new tsc errors.

- **#43 — just-demoted/paused Nibbin still executed mid-run.** `dispatchStep` now re-reads fresh stage+status (new `deps.runs.getNibbin()`) immediately before the execute decision; a Nibbin demoted/paused/sleeping after admission drafts-not-executes. `stage_changed_at` threaded through `NibbinRef`/loaders. Tests: demote-mid-run → draft, pause-mid-run → draft, control grad run still executes.
- **#44 — routine-pattern trust never reset on demotion.** `RoutineStore.approvedCount` gained a `sinceMs` param (= `stage_changed_at`), filtering approvals to `decided_at >= stage_changed_at`, so demotion truly resets the pattern climb (§4.7). Test: pre-demotion approvals don't count.
- **#47a — `nibbin_demote` member-callable griefing.** Migration `20260620200000_nibbin_demote_role_gate.sql` requires the authenticated caller hold `owner`/`admin` (active membership); service-role (the runtime's own auto-demotion) bypasses, consistent with sibling RPCs. Signature/return/SECURITY DEFINER/search_path=''/stage logic/audit_log all preserved. Applied dev/staging/prod.
- **#47b** — addressed structurally by #43 + #44 (stage re-read + stage-scoped approvals); no standalone change.
- **#47 cosmetic P3s** — noted, not fixed (non-blocking observations; listed in REPORT.md).

## Behavior note (accepted)
The #47a gate means a `member`-role user can no longer demote (only owner/admin). For the current single-owner accounts this is transparent and closes the intra-account griefing hole. If member self-service "Back to drafts" on *their own* Nibbins is later desired in multi-member accounts, the richer fix is a per-Nibbin ownership check rather than widening the role gate. The runtime's automatic trust-drop demotion is unaffected (service-role path).
