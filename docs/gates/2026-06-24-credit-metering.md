# Gate report — usage-based credit metering

Branch: `feat/credit-metering-usage`
Surface: billing ledger (`credit_ledger` / `credit_balances`) + model-call COGS path.
Date: 2026-06-24

## What changed

Today credits decrement ONLY on agent "runs" (a flat weighted `-1/-3/-10` charged at
`run_begin` / `chargeDiagnosis`). Every NON-run model call — chat turns, onboarding
understanding, planner plan synthesis, doc/vision extraction, style/memory derivation —
records a `model_calls` COGS row but charged nothing. Most paid model usage was free.

This change charges those leaked calls:

- New ledger reason **`usage`** (debit; may overdraw — see soft-gate) + a service-role RPC
  `charge_model_usage(account, model_calls.id, credits)` — migration
  `supabase/migrations/20260624130000_credit_usage_metering.sql`.
- `recordModelCall` (apps/web/lib/llm/client.ts) now, after writing the COGS row, calls
  `charge_model_usage` for the call's converted cost — **only for calls with `run_id IS NULL`**.
- Conversion lives in ONE constant: `USD_PER_CREDIT = $0.01` (`MICRO_USD_PER_CREDIT = 10_000`)
  in `packages/shared/src/credits.ts`; `creditsForCostMicroUsd = ceil(cost / 10_000)`.
- Pre-flight gate for STARTING a planner run: `apps/web/lib/credits/gate.ts` →
  `startPlanRun` refuses cleanly at `balance ≤ 0`.

## Rate + free-tier math

`USD_PER_CREDIT = $0.01` is anchored to the EXISTING top-up price (`TOP_UP` = $10 / 1,000
credits = $0.01/credit) — no second, conflicting price. Against real prod COGS (nibbin-prod
`model_calls`, 2026-06-24): chat ≈ 950 µUSD, onboarding ≈ 805 µUSD, plan synthesis ≈ 4,100
µUSD. With `ceil(cost / 10_000)`: a chat turn / onboarding / plan-synthesis call each round to
**1 credit**; the heaviest real account (8 calls, 23,227 µUSD) totals **~3 credits**. The
5,000-credit Canopy grant ($50 of usage) covers thousands of calls; Grove (1,000) ~1,000;
Hatchling (100) ~100. A normal session spends a tiny fraction — results reliably post.
**No grant resize recommended.** Tuning: change only `USD_PER_CREDIT`.

## Double-charge reconciliation

A run is ONE unit of work that the flat run charge already pays for. Its model calls carry the
`run_id`, so `recordModelCall` SKIPS the usage charge for them (`if (rec.runId) return;`).
Non-run calls (run_id null) charge usage. One unit of work → one charge. The flat run-charge
path (run_begin/run_resume/run_finish, InMemoryRunStore) is UNCHANGED — all 105 runtime
invariant tests still pass.

## Soft-gate (protects completed work)

- A usage charge is **post-hoc** for a call that already completed: it ALWAYS lands and the
  result ALWAYS posts, even into a negative balance. `usage` is exempt from the overdraw guard
  in `validateAppend` (like `clawback`) and the RPC inserts unconditionally (no balance check).
- Only STARTING new expensive work checks the balance: `startPlanRun` requires `balance > 0`
  (fail-closed on an unreadable ledger). `respondToPlanRun` (resuming in-flight work) does NOT
  gate — a completed/in-flight run is never aborted. Nibbin runs keep their existing
  `run_begin` pre-flight (queue-at-cap), unchanged.

## Adversarial review

**Can a member over-/under-charge ANOTHER account?**
No. The charge is account-scoped from the trusted server seam: `recordModelCall` passes
`rec.accountId` (set server-side per call, never client-supplied) into
`charge_model_usage(p_account, …)`. The RPC is `security definer`, `search_path=''`,
**service-role only** (`revoke … from public, anon, authenticated`). A member's JWT cannot
invoke it. The amount is derived from the server-recorded `model_calls.cost_microusd`, not from
client input. A member cannot target another account_id (they never call the RPC) nor inflate a
charge (cost is computed from pinned rates over server-measured token usage).

**Is the decrement account-scoped + tamper-resistant (service-role / RPC only, not
client-writable)?**
Yes. `credit_ledger` is append-only (UPDATE/DELETE/TRUNCATE blocked by trigger for ALL roles
incl. service), `authenticated` has no INSERT, `anon` has nothing. The only writer is the
service-role RPC. The new partial unique index `credit_ledger_one_usage_per_call (source_id)
where reason='usage'` makes the charge **idempotent** — a retried `recordModelCall` (or a
double-fired record) can never double-debit (RPC uses `on conflict do nothing`). Sign is
DB-enforced: `usage` must be `delta < 0`.

**Can the soft-gate be abused to run unlimited free work?**
Bounded. The soft-gate only lets ALREADY-STARTED work finish into a negative balance — it does
not let new work START. Concretely:
- Nibbin runs: gated up front by `run_begin` (queues at cap; cannot start broke).
- Planner runs: now gated by `canStartNewWork` (`balance > 0`) — a broke account is refused with
  no run, no model call.
- The remaining always-allowed surface is in-app chat turns, which were ALREADY bounded
  independently of credits by `CHAT_DAILY_CEILING` (150/500/2000 per UTC day by tier) +
  per-account anomaly auto-pause; channel chat by its own dollar spend-cap + anomaly pause. So a
  broke user can drive the balance somewhat negative via cheap chat turns within the daily
  ceiling, but cannot loop unlimited expensive runs. The negative balance then blocks the next
  run start until top-up. This is the intended "never block a finished result, but block new
  expensive work" trade-off. Residual risk: a determined broke user can consume up to the daily
  chat ceiling at ~1 credit/turn before the next run is gated — acceptable and pre-existing
  (the ceiling, not credits, was always the chat backstop).

## Tests

- `packages/shared/test/credits.test.ts` — conversion (proportional, ceil, near-free→0,
  fail-safe), `usage` entry shape, soft-gate overdraw allowed for usage but NOT for run.
- `apps/web/lib/llm/client.test.ts` — usage charged proportional to cost; more cost → more
  credits; run-tagged call NOT charged (no double charge); near-free / no-account not charged;
  result still posts if the charge RPC fails.
- `apps/web/lib/credits/gate.test.ts` — balance sum, negative read, fail-closed.
- `apps/web/app/app/planner/actions.test.ts` — start refused at balance ≤ 0 (no run/model
  call); starts when funded; resume (in-flight) never calls the gate.

Suites run green: shared 47, client/gate/planner/runtime-invariants 152, full apps/web/lib 859
passed (3 skipped). `tsc` clean (shared, web, runtime, tests/rls). `eslint` clean on changed
files.

## Migration (NOT applied — apply to all 3 DBs at merge)

`supabase/migrations/20260624130000_credit_usage_metering.sql` — adds `usage` to the reason +
sign CHECKs, the per-call unique index, and the `charge_model_usage` RPC. Verified the dropped
constraint names (`credit_ledger_reason_check`, `credit_ledger_sign_by_reason`) exist on dev +
prod. Apply to dev (oqnqzytctwlptfdvyagl), staging (swbbydpuiilnamnyhwnr), prod
(oaymttudfazqaqequrke).
