# Free first field-study diagnosis — build report

Branch `feat/free-study` (worktree `C:/nib-free-study`). 3 commits:
- 5b6622f5 — migration + cost-cap constant
- bfb2a38b — entitlement + credit gate + cost cap in the diagnosis path
- 1bb21f83 — tests + cap adjustment ($0.05 -> $0.30)

## What's free vs charged
- First ever diagnosis (per account): FREE — accounts.first_diagnosis_consumed flips false->true atomically; no credit charge.
- Subsequent with credits: charged frontier weight (3 credits) via a `run` ledger debit.
- Subsequent out of credits: REFUSED before any model call (needs_credits); no spend.
- Hard per-diagnosis cost cap DIAGNOSIS_MAX_MICRO_USD = $0.30 bounds even the free one.

## 1. Migration
supabase/migrations/20260620170000_free_first_diagnosis.sql
- alter table public.accounts add column if not exists first_diagnosis_consumed boolean not null default false;
- partial index accounts_first_diagnosis_unconsumed_idx on (id) where not first_diagnosis_consumed.
- Controller applies to dev/staging/prod after review — NOT applied locally.

## 2. Entitlement + gate seam
apps/web/lib/llm/diagnosis-entitlement.ts
resolveDiagnosisEntitlement(accountId) -> { kind:'free' | 'charge' | 'needs_credits', message? }
- Atomic consume (service client): update accounts set first_diagnosis_consumed=true where id=? and first_diagnosis_consumed=false then .select('id'). Returned row => owns the free run. Race-safe: under two concurrent firsts only one update returns a row.
- Credit gate (fall-through): reads credit_ledger deltas, balance(), requires canRun(balance,'frontier'); insufficient => needs_credits with Nibbin-voice copy, no model call.
- Fail-closed: consume error -> credit gate (never infinite free); unreadable ledger -> refuse.
- chargeDiagnosis(accountId, runId): appends chargeForRun('frontier', runId) (-3 run debit), paid path only.

Wired in apps/web/lib/llm/synthesis.ts diagnosisSynthesis(accountId,userId,packet,generateOverride?,runId?):
- Return type widened to DiagnosisResult = ok|needs_credits|unavailable.
- Gate resolved BEFORE routing/model call; needs_credits short-circuits (no spend).
- Free run tagged channel='free_first' on recordModelCall (no meta slot; channel is the honest tag).
- Charge appended only when !free; no charge on model failure.
- Caller updated: tests/evals/live-stack.eval.ts.

## 3. Hard cost cap (anti-runaway)
packages/shared/src/credits.ts: DIAGNOSIS_MAX_MICRO_USD=300_000 ($0.30) + withinDiagnosisCostCap() (fail-closed on NaN/Inf/neg).
- Pre-spend: FREE path projects worst-case cost and REFUSES if over cap.
- Post-spend: every path logs LOUD "cost cap BREACHED" if recorded cost > cap.
- DIAGNOSIS_MAX_TOKENS=2500 bounds output; cap is the cost-side backstop.
- Sizing: $0.05 sat UNDER a real 2,500-output-token Opus diagnosis (output alone $0.0625) and would refuse every legit free run; $0.30 clears worst-case (~$0.11-0.15) and still trips a ~2x runaway.

## 4. Tests
- apps/web/lib/llm/diagnosis-entitlement.test.ts (9): free consumes flag; consumed+zero refused; consumed+credits->charge; below-weight refused; race (one free, one falls through); fail-closed consume-error->gate; fail-closed unreadable-ledger->refuse; chargeDiagnosis writes frontier debit.
- apps/web/lib/llm/synthesis.test.ts diagnosis block: first=free routes Opus pin no charge; second+no credits refused WITHOUT model call; second+credits proceeds+charges; loud cap breach on over-cap usage; empty packet/completion->unavailable.
- packages/shared/test/credits.test.ts: withinDiagnosisCostCap bounds + fail-closed.

## Verification
- npx vitest run on the 3 changed files: 53 passed.
- npm run lint: clean.
- npx tsc -p apps/web: zero errors in changed files. The 33 remaining errors are pre-existing on the base commit (C:/Nibbin junction / stale-workspace @nibbin/* noise).

## Product decision
Subsequent-diagnosis pricing = frontier weight (3 credits) per the existing WEIGHTS table; this establishes the FIRST credit gate in the web app (none existed). Tunable via DIAGNOSIS_WEIGHT in diagnosis-entitlement.ts. A consumed free entitlement is NOT auto-restored on a failed run (no charge either) — reveal-side retry is M7's concern.
