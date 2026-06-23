# P3 Task 9 — RLS End-to-End Propose→Ratify Test + Adversarial Gate

**Date:** 2026-06-23  
**Branch:** `feature/company-brain-capture-propose`

---

## Status

DONE. The RLS end-to-end test suite (`tests/rls/company-brain-capture-propose.test.ts`) was already committed in Task 4 with 6 tests. All 6 pass against the live DB. The adversarial gate report is written at `docs/gates/2026-06-23-capture-propose.md`. The `recordModelCall` carried-forward fix is wired and tested (3 new tests in `propose-from-capture.test.ts` + 4 updated in `derive-proposals.test.ts`).

---

## Task 9a — RLS test coverage

**File:** `tests/rls/company-brain-capture-propose.test.ts`

**6 tests — full capture→propose→ratify chain:**

| # | Test | What it verifies |
|---|------|-----------------|
| 1 | `service-role inserts observation source; member A reads it, member B cannot` | Cross-account isolation on `sources(kind='observation')` |
| 2 | `service-role propose_memory_change(origin=capture) creates pending proposal + review_item` | P3-specific proposal + notification creation |
| 3 | `member A approving a capture proposal writes grove_memory + history + evidence + audit` | Full F2 ratification chain: grove_memory append, history row (change_source='proposal'), field_evidence link, audit_log, notification resolved |
| 4 | `member B cannot decide_memory_proposal for account A` | Cross-account decision isolation |
| 5 | `proposals.origin='capture' is accepted by the CHECK constraint (no migration needed)` | Regression guard that F1/F2 already allows `origin='capture'` |
| 6 | `authenticated clients and anon cannot call propose_memory_change` | Service-role-only RPC enforcement |

**Run command:**
```
npx vitest run tests/rls/company-brain-capture-propose.test.ts
```

**Result:** 6/6 pass. Self-skips when no DB (`describe.skipIf(!dbAvailable)`).

---

## Carried-forward fix — `recordModelCall` wiring

### Problem

`derive-proposals.ts` (`deriveProposalsFromObservation`) made a T0/Haiku-class model call with no COGS ledger. The Task 3 → Task 4 boundary was noted as a TODO in `propose-from-capture.ts` but never implemented.

### Solution

**`apps/web/lib/brain/derive-proposals.ts`:**
- Added `DeriveProposalResult` interface: `{ proposals: CaptureProposal[], model: string | null, usage: TokenUsage | null }`.
- `deriveProposalsFromObservation` now returns `DeriveProposalResult` instead of `CaptureProposal[]`.
- All early-exit paths (no model, thin data, throw) return `NO_CALL` sentinel `{ proposals: [], model: null, usage: null }`.
- Successful call paths return `{ proposals, model: raw.model, usage: raw.usage }` — even on parse failure, model/usage are surfaced (tokens were spent).

**`apps/web/lib/brain/propose-from-capture.ts`:**
- `proposeFromCaptureCore` accepts optional `recordCall?: RecordCall` parameter (DI'd for testability).
- After deriving proposals, if `model !== null && usage !== null`, calls `recordCall({ accountId, userId: null, runId: null, tier: 't0', task: 'capture_propose', model, usage, origin: 'pipeline' })` fire-and-forget.
- Backward-compatible: existing tests that omit `recordCall` continue to pass.

**`apps/web/app/api/brain/propose-from-capture/route.ts`:**
- Imports `recordModelCall` from `lib/llm/client`.
- Passes `recordModelCall` as the `recordCall` argument to `proposeFromCaptureCore`.

### Privacy invariant preserved

The no-key path (`generate === null`) returns `NO_CALL` immediately — `model` and `usage` are null — so `recordModelCall` is never invoked. The "no key → no record" invariant holds.

### Tests added/updated

**`apps/web/lib/brain/derive-proposals.test.ts`** (7 tests, all updated for new return shape):
- `'returns { proposals: [], model: null, usage: null } when no model is configured'` — no-key sentinel.
- `'surfaces model + usage metadata for COGS ledgering on a successful call'` — new test asserting model/usage are non-null.
- `'returns null model/usage on a thin/empty summary (no events) — no call made'` — thin-data path.
- `'returns null model/usage (no-call sentinel) when generate throws'` — throw path.
- `'returns null model/usage … on a non-JSON / garbage model response — caller ledgers nothing'` — parse-fail path still surfaces model/usage (call was made).

**`apps/web/lib/brain/propose-from-capture.test.ts`** (3 new COGS tests added):
- `'calls recordModelCall with task=capture_propose when a model call is made'` — asserts `recorded.length === 1`, correct `task`, `origin`, `model`, `accountId`.
- `'does NOT call recordModelCall when generate is null (no API key path)'` — asserts `recorded.length === 0`.
- `'does NOT call recordModelCall when recordCall is omitted (backward compat)'` — no throw.

---

## Adversarial gate

**Report:** `docs/gates/2026-06-23-capture-propose.md`

**Verdict: PASS** — all 4 lenses clear.

Key findings:
- **Red-team:** Zod `.strict()` + battery boundary scan enforce no-extra-fields and no-content-smuggling. All three attack vectors (extra-field, content-embedding in allowed fields, model-proposed PII) are blocked and test-covered. Cross-account RLS verified.
- **Claims-auditor:** `ObservationSummary` carries only structural derivations (app names, aggregate timing, transition patterns). Per-field review confirms no raw AX/window/URL content. The "no new migration" claim is verified by the RLS test.
- **Logic-skeptic:** Source insert before proposal loop is correct. Full ratification chain (grove_memory + history + evidence + audit + notification resolved) verified end-to-end by RLS test 3. Double-decide guard is inherited from F2 and already covered.
- **Cost-auditor:** One T0/Haiku call per completed study, `maxTokens: 600`, fire-and-forget. COGS ledgering now wired (previously missing).

Open notes (non-blocking):
- Battery false-positives on legitimate app names: acceptable (errs toward drop, not leak).
- Task 5 (Rust) deferred: must receive the red-team lens (no raw fields in Rust serialization) before desktop release.

---

## Test counts

| Suite | Before | After |
|-------|--------|-------|
| `derive-proposals.test.ts` | 5 | 7 |
| `propose-from-capture.test.ts` | 5 | 8 |
| `company-brain-capture-propose.test.ts` | 6 | 6 (unchanged) |

Full suite: **2215+ tests pass, 3 pre-existing DB-level failures** (unrelated to P3: `model_calls` table missing in test-DB migration order, `public` schema init race). These were present before this task.

---

## Files modified / created

| File | Action |
|------|--------|
| `apps/web/lib/brain/derive-proposals.ts` | Modified — new `DeriveProposalResult` type + updated return |
| `apps/web/lib/brain/derive-proposals.test.ts` | Modified — 2 new tests + 5 updated for new return shape |
| `apps/web/lib/brain/propose-from-capture.ts` | Modified — `recordCall` DI param + COGS wiring |
| `apps/web/lib/brain/propose-from-capture.test.ts` | Modified — 3 new COGS tests |
| `apps/web/app/api/brain/propose-from-capture/route.ts` | Modified — pass `recordModelCall` to core |
| `tests/rls/company-brain-capture-propose.test.ts` | Already committed (Task 4); unchanged |
| `docs/gates/2026-06-23-capture-propose.md` | Created — adversarial gate report |
| `.superpowers/sdd/task-9-report.md` | Created — this file |
