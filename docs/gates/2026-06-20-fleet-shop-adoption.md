# Adversarial gate — Tier-2 fleet shop-template adoption aggregate

- **Branch / PR:** `feat/fleet-shop-adoption` → `main`
- **Scope:** `shop_template_performance` view + `_read` RPC (migration `20260620110000`);
  `loadShopScoreboard` + scoreboard panel; RLS + unit tests.
- **Second new Tier-2 fleet signal** (§12B lists shop adoption/abandon explicitly). Direct mirror of
  the gated `capability_task_performance` pattern ([[gate 2026-06-19-fleet-capability-performance]]).

## What it is
Anonymized cross-account view of shop-template adoption: per template_key — nibbins adopted,
distinct contributing accounts, active vs dormant (sleeping/paused), and maturity (senior+/graduated).
Informs the shared shop catalog (promote/retire). Structural-only; staff-read; no automated consumer.

## Privacy controls (same as the capability aggregate)
- **Opt-out:** joins accounts + requires `model_contribution_enabled`; opted-out accounts contribute
  nothing and don't count toward the cohort.
- **k-anonymity:** HAVING `count(distinct n.account_id) >= 5` — only templates with ≥5 distinct
  contributing accounts are exposed.
- **Staff-only:** `security_invoker` view, revoked from product roles; SECURITY DEFINER `_read` RPC
  granted to service_role; scoreboard page behind the existing `getStaff()` gate.

## Aggregate logic (no fan-out)
`nibbins n JOIN agent_specs s ON s.id=n.spec_id AND s.template_key IS NOT NULL JOIN accounts acc
(opt-out)`. Each nibbin → exactly one current spec (1:1 via spec_id), so `count(distinct n.id)` has
no fan-out. Template attribution survives a retune (#193) because `retune_nibbin` copies template_key
onto the new spec version and the nibbin points to it. Composed/crystallized nibbins (template_key
NULL) are correctly excluded.

## Tests
- `tests/rls/fleet-shop-adoption.test.ts` (live PG): exposes a ≥5-account template with correct
  active/dormant/senior_plus splits; suppresses <5; opted-out account excluded from cohort; RPC +
  view service-role/staff only.
- `apps/admin/lib/scoreboard/read.test.ts` (+11): rate math + null-at-zero, shape guard, load/throw.

## CI / local
Migration applied + verified on dev. apps/admin tsc clean; eslint + repo-wide `npm run lint` clean;
33 scoreboard tests pass.

## Deferred (need instrumentation first — no clean data source today)
The other proposed fleet signals are NOT built (would be hollow): **demand gaps** (no "capability
wanted-but-missing" event) and **blocker patterns per connector** (runs don't record which connector
blocked). Both need new instrumentation before an aggregate is meaningful.

## Verdicts
(appended after the reviewer pass)
