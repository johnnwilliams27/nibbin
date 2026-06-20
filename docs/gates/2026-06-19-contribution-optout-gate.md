# Adversarial gate — Tier-2 contribution opt-out gap fix

- **Branch / PR:** `fix/contribution-optout-gap` → `main`
- **Scope:** recreate the `model_task_performance` view to honor
  `accounts.model_contribution_enabled` (migration `20260619320000`); INVARIANTS.md C11 fix;
  RLS test. No app-code change (the view's column list/order is unchanged, so the
  `model_task_performance_read` RPC + `pgPerformanceSource` reinforcement read path are untouched).

## Problem
The Data & Privacy "Model improvement" toggle (`model_contribution_enabled`, opt-out / default-on)
was a **no-op**: `model_task_performance` aggregated EVERY account's `model_calls`, including
accounts that had opted out — contradicting the UI copy ("Nibbin learns from anonymized, aggregate
signals about how its capabilities and models perform … when this is on"). The toggle was stored,
surfaced, and audited, but no code path read it.

## Fix
Both CTEs in the view now `join public.accounts acc on acc.id = mc.account_id and
acc.model_contribution_enabled`. Effect:
- An opted-out account's `model_calls` no longer flow into the cross-account aggregate.
- Account-less system calls (`model_calls.account_id` is nullable) are also excluded — the
  privacy-safe direction: no consenting account ⇒ not aggregated. (Minor reinforcement-signal loss
  for pre-account calls; account-attributed calls are the overwhelming majority.)
- Column list/order unchanged → `model_task_performance_read` RPC and the router's
  `pgPerformanceSource` snapshot are unaffected.

## Scope note (deliberate, per the Tier-2 decision)
This fix ONLY closes the opt-out gap on the existing model-performance aggregate. It does NOT add
new fleet signals, a min-cohort/k-anonymity threshold, or separate analytics-vs-contribution
toggles — those are the deferred Tier-2 product/privacy decisions. The model×task×tier key is
system-level (many contributing accounts), so it's defensible without min-cohort; granular
capability-level aggregates (Slice 2) WILL need a cohort threshold.

## INVARIANTS.md
C11 updated from "model training on user data is opt-in" to the shipped reality: never train on
content; anonymized aggregate STRUCTURAL contribution is opt-out (default-on,
`model_contribution_enabled`), honored everywhere (the aggregate now filters to contributing
accounts).

## Tests
`tests/rls/contribution-optout.test.ts` (live PG): an opted-in account is aggregated; an opted-out
account (via `set_model_contribution(acct,false)`) and account-less calls are excluded;
re-enabling lets the account flow back in.

## CI / local
Migration `create or replace view` applied + valid on dev. Repo-wide `npm run lint` clean.

## Verdicts
(appended after the reviewer pass)
