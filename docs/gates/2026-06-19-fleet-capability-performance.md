# Adversarial gate — Tier-2 fleet learning Slice 2: capability performance aggregate

- **Branch / PR:** `feat/fleet-capability-aggregate` → `main`
- **Scope:** `capability_task_performance` view + `capability_task_performance_read` RPC
  (migration `20260619410000`); admin scoreboard consumer (`apps/admin/lib/scoreboard/read.ts`
  `loadCapabilityScoreboard`, `apps/admin/app/scoreboard/page.tsx` panel); RLS + unit tests.
- **This is the first NEW Tier-2 fleet aggregate** (§12B / R48). The opt-out gap fix (#197) and the
  model×task×tier aggregate already shipped; this adds capability-level performance.

## What it does
An anonymized, cross-account aggregate of how each capability's drafts fare across the fleet
(approved-unedited / edited / rejected counts + avg edit distance), to inform the shared
capability-library / Composer / shop roadmap (§12B "statistics about the system, not users").
**Structural only:** capability id + decision counts. No content, no per-user data, no automated
consumer (pure staff observability, like `model_task_performance`).

## Privacy controls (the load-bearing part — design decisions, John-delegated)
1. **Opt-out** — both the aggregate joins `accounts` and requires `model_contribution_enabled`
   (same toggle as #197). An opted-out account contributes nothing and does NOT count toward the
   cohort.
2. **k-anonymity (k=5)** — a capability row is exposed ONLY when `count(distinct account_id) >= 5`
   (HAVING). Capability keys are granular enough to otherwise narrow toward one user; the
   model×task×tier view didn't need this (system-level key), this one does. On a small/young fleet
   most capabilities are suppressed — correct (privacy over signal until the cohort is large).
3. **Staff-only** — `security_invoker` view, `revoke all` from public/anon/authenticated; read via a
   SECURITY DEFINER RPC granted to service_role only; the admin page asserts `getStaff()` +
   `redirect('/login')` BEFORE building the service client, and logs `staff_log_access`. Triple gate.
4. **No automated behavior change** — nothing routes/composes on this yet; it's an insight signal.
   (If a future slice auto-feeds it into library defaults, that slice re-gates.)

## Aggregate logic
`run_steps` (kind='draft', tool=capability) JOIN `approvals` (run's decision) JOIN `accounts`
(opt-out filter); 30-day window on `decided_at`; group by capability; HAVING distinct accounts ≥5.

## Tests
- `tests/rls/fleet-capability-performance.test.ts` (live PG): exposes a capability with ≥5 opted-in
  contributors (correct counts); suppresses <5; an opted-out account does NOT count toward the
  cohort (drops a 5-contributor cap below k); RPC + view are service-role/staff only.
- `apps/admin/lib/scoreboard/read.test.ts`: `deriveCapabilityRates` math + null-when-zero,
  `isCapabilityRow` shape guard, `loadCapabilityScoreboard` maps/throws-on-drift.

## CI / local
Migration applied + verified on dev (columns, security_invoker, service_role-only RPC, auth denied).
Repo-wide `npm run lint` clean; apps/admin tsc clean; 21 scoreboard tests pass.

## Open / deferred (still need John)
Further fleet signals (demand gaps, shop adoption, blocker patterns), whether to ever auto-consume
these into library/Composer defaults, and analytics-vs-contribution toggle separation.

## Verdicts
(appended after the reviewer pass)
