# Independent adversarial gate — usage-based credit metering

- **Date:** 2026-06-24
- **Branch:** `feat/credit-metering-usage`
- **PR:** #259
- **Surface:** BILLING — `credit_ledger` append-only ledger + model-call COGS path + planner pre-flight gate.
- **Reviewer:** Independent gate (did NOT trust the implementer's self-report `docs/gates/2026-06-24-credit-metering.md`; every claim re-verified against source).

## Verdict: CHANGES-REQUIRED

One **Important** billing-correctness defect (a money leak the PR *claims to close* but does not), plus one **Important** migration-idempotency defect that is dangerous given this repo's documented migration-tracker drift. No Critical money-theft / cross-account / overdraw defects found — the core charge path, authz, rate math, and overdraw exemption are sound and well-tested.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Important | 2 |
| Minor | 2 |

---

## Focus-area findings (all 6)

### 1. Idempotency / double-charge — HOLDS (with one real leak under #2-style framing)
- **Run-skip guard is airtight for its type.** `chargeUsage` (`apps/web/lib/llm/client.ts:128-129`) does `if (rec.runId) return;`. `runId` is typed `string | null | undefined`; `''`/`null`/`undefined` are all falsy so they correctly *do* charge, and any truthy run id skips. No `undefined`-vs-`null` hole.
- **Per-call idempotency is correct.** The partial unique index `credit_ledger_one_usage_per_call (source_id) where reason='usage'` (migration line 45) + `insert … on conflict do nothing` (RPC) means one `model_calls.id` can debit at most once. `source_id` is the globally-unique `model_calls.id` UUID, so a replayed RPC can never double-debit.
- **No escape on the error path.** If the COGS insert fails, `recordModelCall` returns *before* `chargeUsage` (client.ts:94-97) — a call with no COGS row is never charged. `recordModelCall` is invoked exactly once per completed model call at all 19 callsites (verified), so the "distinct row id per retry" concern is not reachable in practice.
- **BUT:** the "no double charge" reconciliation rests on a false premise for the planner — see Finding A below. That is a *missing* charge, not a double charge, but it lives in this focus area's reconciliation logic.

### 2. Cross-account / authz — HOLDS
- **RPC is strictly service-role.** Migration line 80-81: `revoke execute … from public, anon, authenticated;` then `grant execute … to service_role;`. `security definer`, `set search_path=''`. A member JWT cannot invoke it. ✓
- **Account is server-derived.** `chargeUsage` passes `rec.accountId` (set server-side per call, never client-supplied) as `p_account`. The credit amount is computed server-side from `model_calls.cost_microusd` (pinned rates × server-measured tokens), never from client input. A member cannot target another account or inflate a charge. ✓
- **`source_id` index has no `account_id` term**, so a given call id resolves to exactly one usage row across the whole table — member A's call can never be made to debit member B. ✓
- **Gate reads the right account.** `startPlanRun` → `appSession()` returns `accountId` server-side; `canStartNewWork(accountId)` → `readBalance` filters `.eq('account_id', accountId)` and sums `credit_ledger.delta`. Reads the live append-only ledger, not a cached balance. ✓

### 3. Overdraw exemption — HOLDS (scoped + tested)
- The `validateAppend` switch (`packages/shared/src/credits.ts:204-243`) exempts only `usage` and the pre-existing `clawback`. `run` still calls the overdraw check (`balance + delta < 0` throws); `topup`/`grant`/`refund` keep their own guards. The exemption does **not** bleed to other debit reasons. ✓
- DB mirror is correct: `credit_ledger_sign_by_reason` puts `usage` in the `delta < 0` group; the RPC inserts unconditionally (no balance check) so a completed call always posts. ✓
- **Soft-gate genuinely fail-closes.** `canStartNewWork` returns `bal !== null && bal > 0`; `readBalance` returns `null` on a read error → start refused. `startPlanRun` returns `OUT_OF_CREDITS_MESSAGE` *before* `store.create` / `runPlan`, so a broke account provisions no run and fires no model call. Tested in `gate.test.ts` (positive admits / zero / negative / unreadable all refuse) and `actions.test.ts` (broke → no `create`, no `runPlan`). ✓
- **"Completed work always posts" is real.** `respondToPlanRun` (resuming in-flight work) does not call the gate (verified in source + asserted in `actions.test.ts`), and the usage charge is exempt from overdraw, so an in-flight/finishing result lands even at a negative balance. ✓

### 4. Rate math — HOLDS
- Units verified end-to-end: `costMicroUsd` (`packages/router/src/pricing.ts:75-88`) returns integer **micro-USD**; `creditsForCostMicroUsd = ceil(cost / 10_000)` (credits.ts:131-134). `USD_PER_CREDIT = $0.01` ⇒ `MICRO_USD_PER_CREDIT = 10_000`.
- **No 100× error.** `TOP_UP` is $10 (1000¢) per 1000 credits = $0.01/credit, which equals `USD_PER_CREDIT`. The test asserts `(TOP_UP.priceUsdCents/100)/TOP_UP.credits === USD_PER_CREDIT`. ✓
- Boundaries: `0 → 0` (no phantom charge), `1 → 1`, `10_000 → 1`, `10_001 → 2`, `50_000 → 5`. Garbage fails safe to `0`: `NaN → 0`, `+Infinity → 0`, negative → 0 (credits.ts:132). All tested in `credits.test.ts`. A genuinely-free call never charges; a tiny real cost rounds up to 1 credit by design. ✓

### 5. Migration safety — DOES NOT FULLY HOLD (see Finding B)
- Constraint names are real: base migration `20260610170000` defines `credit_ledger_sign_by_reason` (named) and the inline `reason` check whose auto-name is `credit_ledger_reason_check`. No intervening migration (m4/m5) re-creates either — verified. So a *first clean apply* should succeed.
- Type-consistent: `p_call_id uuid` cast to `text` into `source_id text`. ✓
- **But the migration is not idempotent / replay-safe** (Finding B): a bare `drop constraint` (no `if exists`), a bare `create unique index` (no `if not exists`), and a bare `create function` (not `create or replace`). Given this repo's documented `schema_migrations` drift across dev/staging/prod, a partial re-apply will error.

### 6. Test hollowness — HOLDS (tests are real)
- Ran the four focused suites: **93 passed**. They assert the substance, not shape:
  - `client.test.ts` — charge fires once with correct `p_account`/`p_call_id`/`p_credits`; proportional (1 vs 20 credits); **run-tagged call writes COGS but does NOT charge**; near-free/no-account not charged; COGS-insert-failure ⇒ no charge; charge-RPC-failure still resolves (result posts).
  - `credits.test.ts` — rate boundaries, fail-safe, `usage` entry shape, **usage may overdraw but `run` still throws `/overdraw/`**.
  - `gate.test.ts` — balance sum incl. negative, fail-closed on read error, >0 admits / ≤0 refuses.
  - `actions.test.ts` — broke ⇒ no run/model call; funded ⇒ starts; resume never calls the gate.

---

## Important findings

### Finding A (Important) — planner ReAct-loop model calls are charged NOTHING (the leak the PR claims to close is still open on the planner surface)
**Files:** `apps/web/lib/llm/client.ts:128-129` (`if (rec.runId) return;`); `apps/web/lib/planner/run.ts:481-509` (loop calls pass `runId: runId ?? null`); `apps/web/lib/planner/run.ts:619-630` (`plan_run_create`); `supabase/migrations/20260618060000_plan_runs.sql` (no `credit_ledger` write).

**Reasoning.** The usage-skip's stated contract is: *"calls that carry a run_id are covered by the flat run charge the run already paid"* (client.ts:108-110; migration header). That premise is only true for **Nibbin runs** (the `runs` table → `run_begin` RPC posts `reason='run'`, `packages/runtime/src/stores.ts:187,212`) and **diagnosis** (`chargeDiagnosis`, `apps/web/lib/llm/diagnosis-entitlement.ts:114`).

The **planner is a third run surface** (`plan_runs` table, `SupabasePlanRunStore`). Every model call inside the planner ReAct loop tags `runId = plan_runs.id` (run.ts:484), so `chargeUsage` **skips** it. But `plan_run_create` (and the whole planner path) **never posts any `credit_ledger` charge** — confirmed: zero `credit_ledger` references in the planner migration or planner code, and no `chargeForRun`/`run_begin` in `actions.ts`/`run.ts`. Result: **every model call in a planner run — the most expensive frontier/`computer_use` (10×) multi-step loop in the product — is billed zero**, neither flat nor usage.

This is not a regression (planner-loop calls were already free pre-PR), but it directly contradicts the PR's headline claim ("usage-based metering so every model call charges credits") and its own gate's "one unit of work → one charge." The single most expensive surface remains free. The new `canStartNewWork` gate only blocks *starting* a planner run at balance ≤ 0; once started, an arbitrarily long/expensive loop bills nothing, and because the start gate only needs `balance > 0`, an account with 1 credit can launch a full frontier run for free.

**Fix direction (pick one):** either (a) post a flat `reason='run'` charge for planner runs at `plan_run_create` (mirror `run_begin`), so the skip premise becomes true; or (b) stop tagging planner-loop calls with `runId` for billing purposes so they usage-charge like every other ad-hoc call; or (c) explicitly document planner runs as a known-unmetered surface and narrow the PR's claims. (a) or (b) is required to actually close the leak.

### Finding B (Important) — migration is not idempotent / replay-safe; risky against the known tracker drift
**File:** `supabase/migrations/20260624130000_credit_usage_metering.sql:36, 45, 54.`
- Line 36: `alter table … drop constraint credit_ledger_sign_by_reason;` — **no `if exists`** (line 31 *does* use `if exists` for the sibling constraint — inconsistent). On any DB where this constraint name has drifted or a prior partial apply ran, the migration aborts.
- Line 45: `create unique index credit_ledger_one_usage_per_call …` — **no `if not exists`**; replay collides.
- Line 54: `create function public.charge_model_usage …` — **not `create or replace`**; replay errors with "function already exists."

MEMORY explicitly warns that `schema_migrations` is unreliable across the 3 DBs and that one must "apply only the missing delta with idempotent DDL." This migration violates that. A first clean apply should succeed (constraint names verified real), so this is Important rather than Critical — but it should be made replay-safe before applying anywhere: add `if exists` on line 36, `if not exists` on line 45, and `create or replace function` on line 54 (then re-issue the `revoke`/`grant`, which are already idempotent).

---

## Minor findings

### Minor 1 — `on conflict do nothing` has no explicit conflict target
RPC line 76-77 relies on Postgres inferring the partial unique index for `ON CONFLICT DO NOTHING`. This works (no-target form catches any unique violation), but an explicit `on conflict (source_id) where reason='usage'` would be clearer and guard against a future second partial index on the table silently swallowing an unintended conflict. Cosmetic/defensive only.

### Minor 2 — full-retry double-charge is theoretically possible but not reachable
Because each `recordModelCall` mints a fresh `model_calls.id`, the per-call idempotency index does not protect against the *same logical model call* being recorded twice (it would be two rows → two charges). Verified that no callsite invokes `recordModelCall` twice for one completion, so this is not exploitable today; worth a comment so a future refactor doesn't introduce a retry wrapper around `recordModelCall`.

---

## Summary for dispatch
- **Important / Finding A:** planner ReAct-loop calls (`runId`-tagged, but no flat charge exists for `plan_runs`) escape both flat and usage charging → the most expensive surface bills $0. Fix: post a flat run charge at `plan_run_create`, OR usage-charge planner-loop calls, OR scope the claims.
- **Important / Finding B:** make the migration replay-safe — `drop constraint if exists` (line 36), `create unique index if not exists` (line 45), `create or replace function` (line 54) — before applying to dev/staging/prod given the tracker drift.
- Rate math, authz, overdraw exemption, the soft-gate fail-closed behavior, and the test suite are all sound and verified (93 focused tests green).
