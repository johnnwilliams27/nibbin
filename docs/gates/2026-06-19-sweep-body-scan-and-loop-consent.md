# Adversarial gate — sweep body content-scan + loop-time consent re-check (2026-06-19)

- **Branch / PR:** `feat/sweep-privacy-hardening` → `main`
- **Scope:** `apps/web/lib/sweep/gmail-onboarding.ts` (+ `gmail-onboarding.test.ts`). Code-only, no migration.
- **Builds on:** `2026-06-19-sweep-privacy-hardening.md` (Bcc gate, write-time consent re-check, L1 idempotency — already merged). This PR closes the two items that pass left open.

## Relationship to the prior deferral (important)
The prior gate **deferred Fix 4 (sent-body content scan)** with a specific objection:
reusing the broad `SENSITIVE_KEYWORDS` list on an 8 KB body has an uncharacterized
false-positive rate ("bank" in "river bank", "tax" in "syntax") and would silently drop
legitimate seed messages. **This PR does NOT reuse `SENSITIVE_KEYWORDS` on the body.**
Instead it uses `isSensitiveSample` — the high-precision *pattern* detector already used as
the output guard (13–16-digit card groups, ≥9-digit runs, SSN, IBAN, labelled secrets like
`password:`/`otp:`). It matches secret *values*, not topic words, so the deferral's core FP
objection does not apply.

**Scope statement (in lieu of the deferral's "INVARIANTS C5/C7 decision"):** this body scan
is deliberately narrow — it blocks bodies that contain a detectable secret VALUE from reaching
the LLM. It does NOT attempt to detect sensitive *topics* discussed in prose (that remains the
header gate's job). This is a strict tightening (fewer bodies sent to the LLM), never a
loosening; it cannot send anything the prior code didn't already send.

## Changes
### Change 1 — Pass-1 body content-scan (the deferred Fix 4, correctly scoped)
After `getMessageBody`, the body is run through `isSensitiveSample`; on a hit the message is
skipped (`continue`) so a benign-header sent message that pastes a card / account / routing /
SSN / IBAN / labelled secret in the body is never transmitted to the LLM.

### Change 2 — Loop-time consent re-check (TOCTOU, strengthening prior Fix 2)
The prior write-time re-check blocked the grove writes but only AFTER the ~45 s read+derive
ran. This adds `consentActive()` (re-reads `sweep_consent_at` AND `status='active'`,
fail-closed on error/null) called per page in Pass 1 and every `BATCH_SIZE_PASS2` threads in
Pass 2. On revocation: the read loops break immediately; `runPass1`/`runPass2` are guarded by
`!consentRevoked` so nothing is sent to the LLM after the user said stop; the function returns
`partial` without writing. The pre-existing write-time check remains as the final guard.

## Invariants preserved
- Fail-closed: any consent-read error / missing / null / non-active row ⇒ revoked.
- No writes after revocation: loop break ⇒ derive skipped ⇒ `derived` empty ⇒ write guards
  false; plus an explicit early-return on `consentRevoked`.
- Idempotency (claim / `derived_written_at` / stale-reclaim) untouched.
- Strict tightening only; no schema change; no copy change.

## Tests
`gmail-onboarding.test.ts` — added a body content-scan describe (4 cases): positives
(card/SSN/account/password bodies) and negatives (topic-word prose "bank holiday",
"legal and tax" → NOT skipped, proving recall is preserved). Full sweep suite green
(library + route + dispatch + derive). tsc + eslint clean.

## Known coverage gap (pre-existing)
`gmailOnboardingSweep` has no end-to-end mocked-loop harness (library tests cover pure
utilities; the route test mocks the sweep). The body scan is covered by the detector's own
tests; the loop-time consent re-check is additive on top of the already-tested write-time
guard, so the write-blocking invariant does not depend solely on the new code.

## Verdicts (real 2-reviewer pass, opus, on the diff)
- **Red-team: PASS** — no P1/P2. Confirmed strict-tightening (the body scan can never send a
  body the old code wouldn't), no consent bypass (triple-guarded: loop break + `!consentRevoked`
  derive guards + early-return/write-time guards), `consentActive()` fails closed on error/null,
  no ReDoS. P3 (non-blocking): the body scan catches secret VALUES, not PII-as-prose
  (names/addresses) — pre-existing and beyond this change's stated scope; future broader coverage
  could route bodies through `@nibbin/redaction`.
- **Logic-skeptic: PASS** — no P1/P2 control-flow defects; break/continue targets correct,
  `processed` cadence correct, derive guards + early-return + status finalization consistent.
  Two P3s: (1) small inbox (<BATCH_SIZE_PASS2 threads) + early revoke — the per-batch modulo
  never fires → **FIXED**: added a Pass-2 entry `consentActive()` re-check (symmetric with
  Pass 1). (2) `\d{9,}` over-skip is an accepted precision-over-recall, fail-safe tradeoff.

**Gate verdict: PASS (0 P0; 0 P1; 0 P2).** The one actionable P3 (small-inbox Pass-2 gap) was
fixed; remaining P3s are documented residuals/tradeoffs.
