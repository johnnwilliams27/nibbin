# Gate — Free first field-study diagnosis (anti-runaway cost bound)

**Date:** 2026-06-20
**Branch:** `feat/free-study`
**Sensitive paths:** `supabase/migrations/`, `apps/web/lib/llm/` (model spend path), credit ledger → gate required.

## Verdict: PASS (after fixes)

Gives every account its first 14-day field-study diagnosis free, while making it impossible to turn that into runaway cost. Reviewers: red-team (abuse) + logic-skeptic (correctness). Both returned **no P1**; two convergent P2/P3 findings fixed in `9c9f0386`.

### What this ships
- **Free first diagnosis, per account.** `accounts.first_diagnosis_consumed` flips `false→true` atomically (WHERE-guarded UPDATE … `.select('id')`); only the row that flips it owns the free run. Subsequent diagnoses charge the frontier weight (3 credits) or, with no balance, are refused **before** any model call.
- **Primary cost bound = 100k input tokens.** `buildTruncatedBody` adds packet sections in order until the next would exceed `DIAGNOSIS_MAX_INPUT_TOKENS`, then stops — the study still gets a diagnosis on what fit. Never refuses for size.
- **Dollar backstop = $1, log-only.** `DIAGNOSIS_MAX_MICRO_USD = 1_000_000`; any path logs a LOUD "cost cap BREACHED" if recorded cost exceeds $1 but does **not** fail the study (per John: "$1 and 100k cap but not fail a study, just stop adding to it if it hits the cap"). A real diagnosis is ~$0.06 output + capped input, so it should never fire — it's a drift tripwire.

### Abuse surface (red-team) — CLEAN
- **No unlimited free:** the free entitlement is consumed atomically and burned even on a failed run, so it can't be replayed. Concurrent "firsts" race to one winner; the loser falls through to the credit gate.
- **No pay-bypass / free-rider:** entitlement is resolved before routing; `needs_credits` short-circuits with zero spend; charge is appended only on a paid, successful run.
- **Fail-closed everywhere:** consume error → credit gate (never infinite free); unreadable ledger → refuse.
- **Not client-writable:** `first_diagnosis_consumed` is only mutated via the service client; RLS gives no user-facing write path.

### Findings fixed (commit `9c9f0386`)
- **P2 (red-team + logic, convergent):** a single oversized **first** section was force-kept past the 100k cap (the `kept.length > 0` guard), so for that one case the "primary bound" leaked an uncapped payload. **Fixed:** the first section's content is now clipped to the remaining budget — the payload reaching the model is a hard bound even for one giant section, and the study still runs (clipped, never refused). New test: an 8M-char single section → body sent to the model < 500k chars.
- **P2-B (logic):** `dropped` read 0 in the force-keep case. **Fixed:** computed after the loop unconditionally.
- **P3 (logic):** the credit-gate balance was summed by fabricating `LedgerEntry` rows all labelled `reason:'run'` (harmless — `balance()` only sums deltas — but misleading). **Fixed:** sum deltas directly; dropped the now-unused imports.

### Accepted / non-blocking
- **estimateTokens ≈ chars/4** can undercount dense content (CJK/code), so 100k *estimated* could be up to ~2× real tokens. With the clip in place the worst case is bounded and the $1 backstop logs it; tightening the estimator is a follow-up, not a blocker.
- Consumed free entitlement is not auto-restored on a failed run (no charge either) — reveal-side retry is M7's concern.

## Verification
- `vitest` on the changed files: 17 passed (9 entitlement + 8 synthesis incl. truncate + clip).
- lint clean on changed files; `tsc -p apps/web` zero errors in changed files.
- Migration `20260620170000_free_first_diagnosis.sql` applied to dev/staging/prod.
