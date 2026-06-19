# Routing Reinforcement Slice A (signal substrate + scoreboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Spec: `docs/superpowers/specs/2026-06-18-routing-reinforcement-sliceA-design.md`. Builds on the router (M6.5) + synthesis arc (#139/#141/#142/#150/#153).

**Goal:** Make per-function model performance visible/queryable — capture 3 missing signals on `model_calls`, an aggregated `model_task_performance` view + staff RPC, and a staff scoreboard. **Pure observability: `route()`/`tiers.ts` are NOT touched.**

**Architecture:** Additive columns on `model_calls` (`outcome`/`degraded`/`latency_ms`) populated by an extended `recordModelCall`; a plain SQL view joining `model_calls ↔ approvals` on `run_id`; a staff-gated read RPC + an admin scoreboard. No routing-behavior change.

**Tech Stack:** TypeScript (apps/web, apps/admin Next 15.3), Supabase (3 DBs), the existing `recordModelCall`/`groveRouter` seam.

## File structure
- **Create** `supabase/migrations/20260618170000_model_call_signals.sql` — the 3 additive columns + the `model_task_performance` view + the staff read RPC. NOT applied by the implementer.
- **Modify** `apps/web/lib/llm/client.ts` — `recordModelCall` gains `{ outcome?, degraded?, latencyMs? }`; `anthropicGenerate` times the call + records an `outcome` row on graceful failure.
- **Modify** the ~7 `recordModelCall` call sites — thread `decision.degraded` + measured latency + outcome.
- **Create** the staff scoreboard read surface in `apps/admin` (a staff-gated page calling the RPC).
- **Create/extend** tests: `apps/web/lib/llm/client.test.ts` (signal recording), a SQL/RPC test for the view (or a vitest against a seeded fixture if the repo tests SQL that way), an admin page/action test.

---

### Task 1: Migration — additive signals + the view + staff RPC

**Files:** `supabase/migrations/20260618170000_model_call_signals.sql` (new, NOT applied)

- [ ] **Step 1 — additive columns** (back-compat; existing rows get defaults):
```sql
alter table public.model_calls
  add column if not exists outcome text not null default 'ok'
    check (outcome in ('ok', 'refusal', 'error')),
  add column if not exists degraded boolean not null default false,
  add column if not exists latency_ms integer;
```
- [ ] **Step 2 — the performance view** (plain view, always-fresh; aggregate-only; join on `run_id`). 30-day rolling window; quality metrics over the subset that has an `approvals` row, volume/cost/outcome over all calls:
```sql
create or replace view public.model_task_performance as
select
  mc.model,
  mc.task,
  mc.tier,
  count(*)                                              as calls,
  count(a.run_id)                                       as decided_calls,
  count(*) filter (where a.decision = 'approved' and a.edit_distance = 0) as approved_unedited,
  count(*) filter (where a.decision = 'edited')         as edited,
  count(*) filter (where a.decision = 'rejected')       as rejected,
  avg(a.edit_distance) filter (where a.decision is not null) as avg_edit_distance,
  count(*) filter (where mc.outcome = 'refusal')        as refusals,
  count(*) filter (where mc.outcome = 'error')          as errors,
  count(*) filter (where mc.degraded)                   as degraded_calls,
  avg(mc.cost_microusd)::bigint                         as avg_cost_microusd,
  sum(mc.cost_microusd)                                 as total_cost_microusd,
  avg(mc.latency_ms)::integer                           as avg_latency_ms,
  max(mc.created_at)                                    as last_call_at
from public.model_calls mc
left join public.approvals a on a.run_id = mc.run_id
where mc.created_at > now() - interval '30 days'
group by mc.model, mc.task, mc.tier;
```
(Rates are computed in the RPC/read layer from these counts — keep the view as raw counts so callers derive `approved_unedited_rate = approved_unedited / nullif(decided_calls,0)` etc.)
- [ ] **Step 3 — staff read RPC** (SECURITY DEFINER, `set search_path=''`; staff-gated; aggregate-only). Match the existing `staff_users` gate pattern (read an earlier migration that gates a staff-only RPC, e.g. how `is_app_admin`/`staff_users` is checked):
```sql
create function public.model_task_performance_read()
returns setof public.model_task_performance
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.staff_users where user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.model_task_performance;
end;
$$;
revoke execute on function public.model_task_performance_read() from public, anon;
grant execute on function public.model_task_performance_read() to authenticated;
```
(Confirm the exact staff-gate predicate against the repo — `staff_users` table shape — and mirror it. If staff reads go through the service role instead, gate to `service_role` and have the admin server action assert staff. Pick whichever matches the existing admin-RPC pattern.)
- [ ] **Step 4** — Do NOT apply (controller applies dev/staging/prod). Commit: `feat(routing): model_calls signal columns + model_task_performance view + staff RPC (migration)`.

---

### Task 2: Extend `recordModelCall` + capture the signals at the seam

**Files:** `apps/web/lib/llm/client.ts`; test `apps/web/lib/llm/client.test.ts`

- [ ] **Step 1 — failing test** (`client.test.ts`): `recordModelCall({..., outcome:'error', latencyMs:1234, degraded:true})` writes those three columns (assert the insert payload via a mocked supabase client). A call with none of the three writes `outcome:'ok'`, `degraded:false`, `latency_ms:null` (back-compat). A simulated `anthropicGenerate` provider failure records a row with `outcome:'error'`, zero tokens, and NO prompt/response content in the payload.
- [ ] **Step 2 — extend `recordModelCall`** (`client.ts`): add optional `outcome?: 'ok'|'refusal'|'error'` (default `'ok'`), `degraded?: boolean` (default `false`), `latencyMs?: number | null` (default `null`) to its input type, and include them in the insert (`outcome`, `degraded`, `latency_ms`). No other behavior change.
- [ ] **Step 3 — time + record failures in `anthropicGenerate`**: wrap the provider call with a start timestamp (`const t0 = Date.now()` — note: `Date.now` is fine in app code, NOT in workflow scripts) and compute `latencyMs = Date.now() - t0` for the success path, passing it where the caller records. On the GRACEFUL-FAILURE path (today returns `null` on a provider error / refusal / rate-limit), additionally call `recordModelCall` with `outcome:'error'` (or `'refusal'` when the provider signals a content stop/decline), zero tokens, the resolved tier/task/model, and NO content fields — so the failure is ledgered. (If `anthropicGenerate` itself doesn't have the accountId/task to record, surface the latency + an `outcome` discriminator in its return so the caller records it; pick the cleaner of the two — recording at the existing caller seam is preferred since that's where `recordModelCall` already lives.)
- [ ] **Step 4** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web && npx vitest run apps/web/lib/llm` → green. Commit: `feat(llm): recordModelCall captures outcome/degraded/latency_ms (+ ledger graceful failures)`.

---

### Task 3: Thread the signals through the call sites

**Files:** `apps/web/lib/llm/drafting.ts`, `apps/web/lib/llm/synthesis.ts`, `apps/web/lib/llm/understanding.ts`, `apps/web/lib/diagnosis/label.ts`, `apps/web/lib/memory/extract.ts`, `apps/web/lib/composer/compose.ts`, `apps/web/lib/planner/{run.ts,crystallize.ts}` (the soft-layer + picker calls), the keeper chat action — wherever `groveRouter.route()` + `recordModelCall` are paired.

- [ ] **Step 1** — at each site that already calls `recordModelCall` after a `route()` + model call: pass `degraded: decision.degraded` and `latencyMs: <measured>` (from Task 2's timing) and `outcome: 'ok'`. Where the call can fail gracefully (returns null), record the `outcome:'error'/'refusal'` row per Task 2. Keep each diff minimal — just add the three fields; no logic change.
- [ ] **Step 2 — confirm no routing change:** none of these edits touch `route()` or `tiers.ts`; they only enrich what's recorded. (A grep confirming `tiers.ts`/`router.ts` are unmodified in the diff is part of verification.)
- [ ] **Step 3** — `npx tsc --noEmit -p apps/web && npx vitest run apps/web/` → green. Commit: `feat(llm): thread degraded + latency + outcome into model-call recording at all sites`.

---

### Task 4: Staff scoreboard read surface (admin)

**Files:** a staff-gated page + read action in `apps/admin` (match the admin app's existing structure — find an existing staff-gated admin page/route and mirror it); test alongside.

- [ ] **Step 1 — read action**: a server action / loader that calls the `model_task_performance_read` RPC (via the service-role or staff-authed client the admin app already uses) and returns the rows, deriving the rates (`approved_unedited_rate = approved_unedited / decided_calls`, `refusal_rate = refusals / calls`, `degradation_rate = degraded_calls / calls`). Account-/staff-scoped exactly like the existing admin reads.
- [ ] **Step 2 — page**: a staff-gated route (reuse the admin app's staff gate) rendering a table grouped by `task`, one row per `model`, columns: calls, approved-unedited %, edited %, rejected %, avg edit-distance, refusal %, error %, degradation %, avg/total cost, avg latency, last call. Sortable by approved-unedited / refusal / cost / volume. Read-only; brand voice; no actions (Slice A changes no routing). If the admin app has an analytics section, slot it there.
- [ ] **Step 3 — test**: the read action rejects a non-staff caller (mirror an existing admin-auth test); rate derivation handles `decided_calls=0` (no division by zero → null/0).
- [ ] **Step 4** — `npx tsc --noEmit -p apps/admin` (and `-p apps/web` if shared libs touched) → 0. Commit: `feat(admin): staff model-performance scoreboard (read-only)`.

---

### Task 5: Tests + full verification

**Files:** the test files above + a view-behavior test

- [ ] **Step 1 — view behavior** (a SQL-level or seeded-fixture test, matching how the repo tests RPCs/views — check for an existing pattern, e.g. a pgTAP file or a vitest integration against a test DB; if none, a focused unit test of the rate-derivation in the read layer over a hand-built rows fixture): seed `model_calls` rows for two models on one task — some with an `approvals` row (`approved`/`edited`/`rejected`), some with NO `run_id` (diagnosis/chat-style); assert: no-run_id calls count in `calls` but NOT in `decided_calls`/quality; approved-unedited/refusal/degradation/cost computed correctly; the 30-day window excludes older rows.
- [ ] **Step 2 — privacy + non-routing assertions:** a failure-path `recordModelCall` row carries NO prompt/response content (only model/task/outcome/tier, tokens 0); the staff RPC rejects a non-staff caller; `route()` returns the same model for the same input as before this slice (a test importing `route` and asserting the model id is unchanged for a representative task — proves pure observability); the no-key path records cleanly (`outcome:'ok'` or a clean error row, null latency).
- [ ] **Step 3 — full verification** (from `/c/Nibbin`):
  - `npx tsc --noEmit -p apps/web && npx tsc --noEmit -p apps/admin` → exit 0 (stale `.next/types` for untouched routes are pre-existing — `rm -rf apps/web/.next/types apps/admin/.next/types` + re-run).
  - `npx vitest run apps/web/ packages/` → green (all prior suites stay green; `packages/router` tests unchanged — proves no routing change).
  - `npx eslint apps/web/lib/llm apps/web/lib/diagnosis apps/web/lib/memory apps/web/lib/composer apps/web/lib/planner apps/admin` → clean.
  - `npm run build -w @nibbin/web` (and the admin build if it has one) → Compiled successfully (grep the log; don't trust the trailing echo).
- [ ] **Step 4** — Commit: `test(routing): signal recording + performance view + staff-gate + route-unchanged`.

---

### Task 6: Verify (controller checklist before the gate)
- [ ] tsc (web + admin) 0; vitest green; eslint clean; next build ✓.
- [ ] Confirm: `route()`/`tiers.ts`/`router.ts` are UNMODIFIED (pure observability — `git diff --stat origin/main...HEAD` shows no router-package change); the 3 columns are additive + back-compat; the failure-path row carries no content; the view/RPC are aggregate-only + staff-gated; the no-key path records cleanly.
- [ ] Migration `20260618170000` NOT applied by the implementer (controller applies dev/staging/prod after the gate).

## Self-review
- **Spec coverage:** §2 signals → Tasks 1,2,3; §3 view → Task 1; §4 scoreboard → Task 4; §5 boundaries (no route change) → Task 3 step 2 + Task 6; §6 tests/privacy/gating → Tasks 5,6. All covered.
- **No routing change** is asserted explicitly (Task 3 step 2, Task 5 step 2, Task 6) — the load-bearing "pure observability" property.
- **Back-compat:** the 3 columns have defaults; `recordModelCall`'s new fields are optional → existing callers compile + behave unchanged. Migration additive.
- **Type consistency:** `outcome`/`degraded`/`latencyMs` (camel in TS) ↔ `outcome`/`degraded`/`latency_ms` (snake in SQL) used consistently; the view's raw counts + read-layer rate derivation named consistently across Tasks 1/4/5.
- **Privacy:** aggregate-only view, staff-gated RPC, no content on failure rows — asserted in Task 5.
