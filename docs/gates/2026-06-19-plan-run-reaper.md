# Adversarial Gate Report — Plan-run reaper cron

**Date:** 2026-06-19
**Branch:** `fix/plan-run-reaper`
**Surface:** `supabase/migrations/20260619230000_reap_stale_plan_runs.sql` (new RPC) + `apps/web/app/api/cron/plan-run-reaper/route.ts` (new cron endpoint) + `apps/web/vercel.json` (cron registration). Closes a known HIGH reliability gap: a crashed executor never flips its plan_run to a terminal status, permanently consuming one of the per-account 3-concurrent-run slots.
**Reviewers:** red-team · cost · claims · logic (all four lenses — this PR touches both `supabase/migrations/` and `apps/web/app/api/`)
**Verdict: PASS** — no P0/P1/P2 findings from any lens.

---

## Red-team

**Claim:** the cron endpoint is only callable by Vercel Cron (or an operator with the secret); the SQL reaper only touches genuinely-stale rows.

- The route guards via `isAuthorizedCronRequest` — the same shared helper used by every other cron (account-purge, connector-poll, gmail-watch-renew). It uses `timingSafeEqual` with padding, so length-mismatch attacks don't short-circuit. Fail-closed when `CRON_SECRET` is unset.
- The RPC is `security definer` with `set search_path = ''`. `REVOKE EXECUTE` from `public`, `anon`, and `authenticated`; `GRANT EXECUTE` to `service_role` only. No authenticated client can call it directly.
- The `UPDATE` is constrained to `status = 'running' AND updated_at < now() - 15 min`. A row can only be reaped if it has been stuck for 15 minutes without a `plan_run_save` write. It cannot reap `needs_input`, `done`, `failed`, or `killed` rows.
- **No new attack surface.** The RPC has no `p_account` parameter — it is not account-scoped by the caller; it sweeps the entire table by design (service-role operation). There is no IDOR risk because there is no identity context to exploit.

**Finding:** none.

---

## Cost

**Claim:** the reaper frees concurrency slots at negligible cost with no model calls.

- The cron runs every 15 minutes. Each invocation is a single SQL `UPDATE` (one round-trip to Supabase via the service client). No model inference, no email, no downstream side effects.
- Freeing a stuck `running` slot unblocks new plan runs for the account — a net positive on resource utilisation.
- The RPC does not write to `audit_log` (by design — a reaped run already has a `killed` artifact; the `plan_run_save` RPC audits terminal transitions when called from the executor, but the reaper writes directly to bypass that path intentionally to avoid double-auditing).

**Finding:** none. The cost impact is positive (slot reclamation).

---

## Claims

**Claim:** the RPC kills exactly the stale rows it says it does, with the correct terminal artifact shape.

- `status = 'killed'` matches the `status` check constraint (`'running','needs_input','done','failed','killed'`). ✓
- `pending = null` clears any stale pending request. ✓
- `artifact = jsonb_build_object('terminal','killed','reason','no_progress','reaped',true)` matches the `TerminalArtifact` union in `run.ts` (`{ terminal: 'killed'; reason: KillReason }`). `'no_progress'` is a valid `PlanKillReason` — confirmed by `run.ts:114` (`const reason = rec && rec.terminal === 'killed' ? rec.reason : 'no_progress'`). ✓
- `GET DIAGNOSTICS v_count = row_count` correctly counts reaped rows and returns the integer to the caller. ✓
- The 15-minute threshold is safe: the executor bumps `updated_at` on every `plan_run_save` call; the 60-second wall-clock cap means a live run touches the row at most every few seconds. 15 min gives a 15× safety margin.

**Finding:** none.

---

## Logic

**Claim:** the reaper is idempotent, correct at the threshold boundary, and does not interfere with live runs or the resume path.

- **Idempotent:** re-running the RPC on an already-reaped row is a no-op (the row is `status='killed'`, which the `WHERE status='running'` clause skips).
- **Threshold boundary:** a live executor bumps `updated_at` on every `plan_run_save`. Even at the 60-second max turn (the wall-clock cap kills the run loop before that), `updated_at` advances well within the 15-minute window. No live run can have `updated_at < now() - 15 min`.
- **`needs_input` runs are safe:** a paused run has `status='needs_input'`, not `'running'`. The reaper never touches it. The concurrency cap (`countRunning`) counts only `status='running'`; a `needs_input` row doesn't consume a slot, so there is no reason to reap it.
- **Resume path:** `plan_run_resolve` (the CAS) flips `needs_input→running`. If a run is simultaneously being reaped and resumed, the SQL `UPDATE` on one path will observe the row in the wrong status and skip it. The two paths are safe to interleave — there is no double-flip risk.
- **No new enum value:** `'no_progress'` is reused from the existing `KillReason` union; the `status` check constraint is unchanged.

**Finding:** none.

---

## Verification

- `npm run typecheck` → exit 0
- `npm run lint` → exit 0
- `npx vitest run apps/web/app/api/cron/plan-run-reaper` → all tests pass (401 without secret, 401 wrong secret, 401 no env, count returned, zero count, RPC error handled, unexpected exception handled)

## Migration

`supabase/migrations/20260619230000_reap_stale_plan_runs.sql` — not applied (controller applies at merge).
