# Free first field-study diagnosis — build report

Branch `feat/free-study` (worktree `C:/nib-free-study`). 5 commits:
- 5b6622f5 — migration + cost-cap constant
- bfb2a38b — entitlement + credit gate + cost cap in the diagnosis path
- 1bb21f83 — tests + cost-cap coverage
- 777713e0 — cap = $1 backstop + 100k-input truncate-don't-fail (per John)
- 9c9f0386 — clip oversized first section to a hard input bound + honest ledger sum

## What's free vs charged
- First ever diagnosis (per account): FREE — accounts.first_diagnosis_consumed flips false->true atomically; no credit charge.
- Subsequent with credits: charged frontier weight (3 credits) via a `run` ledger debit.
- Subsequent out of credits: REFUSED before any model call (needs_credits); no spend.
- Cost is bounded by the 100k INPUT-token packet cap (primary) plus a $1 log-only dollar backstop (DIAGNOSIS_MAX_MICRO_USD) — neither ever fails a study.

## 1. Migration
supabase/migrations/20260620170000_free_first_diagnosis.sql
- alter table public.accounts add column if not exists first_diagnosis_consumed boolean not null default false;
- partial index accounts_first_diagnosis_unconsumed_idx on (id) where not first_diagnosis_consumed.
- APPLIED to dev/staging/prod.

## 2. Entitlement + gate seam
apps/web/lib/llm/diagnosis-entitlement.ts
resolveDiagnosisEntitlement(accountId) -> { kind:'free' | 'charge' | 'needs_credits', message? }
- Atomic consume (service client): update accounts set first_diagnosis_consumed=true where id=? and first_diagnosis_consumed=false then .select('id'). Returned row => owns the free run. Race-safe: under two concurrent firsts only one update returns a row.
- Credit gate (fall-through): sums credit_ledger deltas, requires canRun(balance,'frontier'); insufficient => needs_credits with Nibbin-voice copy, no model call.
- Fail-closed: consume error -> credit gate (never infinite free); unreadable ledger -> refuse.
- chargeDiagnosis(accountId, runId): appends chargeForRun('frontier', runId) (-3 run debit), paid path only.

Wired in apps/web/lib/llm/synthesis.ts diagnosisSynthesis(accountId,userId,packet,generateOverride?,runId?):
- Return type widened to DiagnosisResult = ok|needs_credits|unavailable.
- Gate resolved BEFORE routing/model call; needs_credits short-circuits (no spend).
- Free run tagged channel='free_first' on recordModelCall (no meta slot; channel is the honest tag).
- Charge appended only when !free; no charge on model failure.
- Caller updated: tests/evals/live-stack.eval.ts.

## 3. Hard cost bound (anti-runaway) — per John: "$1 and 100k cap but not fail a study, just stop adding to it if it hits the cap"
packages/shared/src/credits.ts:
- DIAGNOSIS_MAX_INPUT_TOKENS = 100_000 — PRIMARY bound. buildTruncatedBody() (synthesis.ts) adds packet sections in order until the next would exceed it, then stops. A single oversized FIRST section is CLIPPED to the remaining budget so the payload reaching the model is a HARD bound even for one giant section. Never refuses, never fails a study.
- DIAGNOSIS_MAX_MICRO_USD = 1_000_000 ($1) — log-only dollar tripwire. Every path logs LOUD "cost cap BREACHED" if recorded cost > $1, but does NOT fail the study (a real diagnosis is ~$0.06 output + capped input, so it should never fire). It exists to catch pricing/usage drift.
- DIAGNOSIS_MAX_TOKENS=2500 bounds output.

## 4. Tests
- apps/web/lib/llm/diagnosis-entitlement.test.ts (9): free consumes flag; consumed+zero refused; consumed+credits->charge; below-weight refused; race (one free, one falls through); fail-closed consume-error->gate; fail-closed unreadable-ledger->refuse; chargeDiagnosis writes frontier debit.
- apps/web/lib/llm/synthesis.test.ts diagnosis block (8): first=free routes Opus pin no charge; second+no credits refused WITHOUT model call; second+credits proceeds+charges; loud cap breach on over-cap usage; oversized packet TRUNCATED (runs, not refused); single giant first section CLIPPED to a hard bound; empty packet/completion->unavailable.
- packages/shared/test/credits.test.ts: withinDiagnosisCostCap bounds + fail-closed.

## Verification
- npx vitest run on the changed files: 17 passed.
- npm run lint: clean on the changed files.
- npx tsc -p apps/web: zero errors in changed files (remaining errors are pre-existing C:/Nibbin junction / stale-workspace @nibbin/* noise; CI fresh npm ci resolves them).

## Product decision
Subsequent-diagnosis pricing = frontier weight (3 credits) per the existing WEIGHTS table; this establishes the FIRST credit gate in the web app (none existed). Tunable via DIAGNOSIS_WEIGHT in diagnosis-entitlement.ts. A consumed free entitlement is NOT auto-restored on a failed run (no charge either) — reveal-side retry is M7's concern.
