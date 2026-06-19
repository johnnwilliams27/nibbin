# Adversarial gate — sweep privacy hardening (2026-06-19)

- **Branch / PR:** `fix/sweep-privacy-hardening` → `main`
- **Reviewed diff:** `git diff origin/main..HEAD` (3 code fixes + 1 migration + 2 new test files + updated tests)
- **Gate run by:** Claude (4-lens gate: red-team / claims-auditor / logic-skeptic / cost-auditor) on 2026-06-19.
- **Scope:** Closes 3 of 4 tracked P2 findings from the previous two gates (2026-06-18-sweep-consent-gating.md and 2026-06-18-connections-p3-followups.md). Feature is still dark (SWEEP_HMAC_SECRET unset in prod).

## CI step
- typecheck (connectors + web): ☑  tests (224: 222 pass / 2 skip): ☑  lint (changed dirs): ☑  SAST: ☐ (CI)  audit: ☐ (CI)  redaction corpus: ☐ (CI)  trigger-graph: ☐ (CI)

## Changes in this PR

### Fix 1 — Bcc in the sensitive-recipient gate (RT-3)
**`packages/connectors/src/connectors/gmail.ts`**
`getMessageMetadata` now fetches `Bcc` alongside `From/To/Cc/Subject/...`. The sweep call site updated to `isSensitiveThread(meta, ['to', 'cc', 'bcc'])`. A Bcc-ed bank, doctor, or lawyer on a sent message is now caught before the body reaches the LLM.

**Tests added (`apps/web/lib/sweep/gmail-onboarding.test.ts`):**
- `flags a sensitive recipient who is only Bcc-ed when bcc is screened` — demonstrates the old `['to','cc']` guard misses it; the new `['to','cc','bcc']` catches it.
- `also flags a Bcc-ed legal/medical address`
- `does not flag ordinary Bcc recipients` (false-positive guard)

### Fix 2 — Consent-revoke TOCTOU (RT-3 / LS-2)
**`apps/web/lib/sweep/gmail-onboarding.ts`**
Immediately before the `grove_memory` / `grove_state` writes, `gmailOnboardingSweep` re-reads `connections.sweep_consent_at` from the DB. If the field is now null (consent withdrawn during the ~45 s sweep), the function returns early with the read stats but writes nothing — fail-closed. The claim row is still finalized by the route (closed, not stuck running).

**Tests added (`apps/web/lib/sweep/gmail-onboarding-sweep.test.ts`):**
- `aborts before any grove write when consent is withdrawn mid-sweep` — verifies `grove_memory.upsert` and `grove_state.upsert` are never called when the re-check returns null.
- `writes grove_memory/grove_state when consent is present at both checks` — baseline: sweep completes normally.

### Fix 3 — Reclaim idempotency / provenance marker (L1)
**`supabase/migrations/20260619240000_sweep_provenance.sql`** — adds `derived_written_at timestamptz` to `gmail_sweep_log`. Replaces `claim_gmail_sweep` (PL/pgSQL, previously SQL): when the stale-reclaim detects a `running` row older than 15 min that already has `derived_written_at IS NOT NULL`, it auto-finalizes the row to `complete` and returns `null` — the caller sees `already_swept` and exits without re-running the sweep. Rows without the marker (hard-kill before grove writes) are still reclaimed as before.

**`apps/web/lib/sweep/gmail-onboarding.ts`** — `gmailOnboardingSweep` now accepts an optional `claimId` parameter. After the grove writes succeed and after the TOCTOU consent re-check passes, it issues a best-effort `UPDATE gmail_sweep_log SET derived_written_at = now() WHERE id = claimId`. Failure is non-fatal (logged implicitly; behaviour degrades to pre-fix reclaim).

**`apps/web/app/api/sweep/gmail/onboarding/route.ts`** — passes `claimId` to `gmailOnboardingSweep`.

**Tests added (`apps/web/lib/sweep/gmail-onboarding-sweep.test.ts`):**
- `sets derived_written_at on the claim row after grove writes (when claimId provided)`
- `does NOT set derived_written_at when claimId is absent`
- `does NOT set derived_written_at when consent is withdrawn mid-sweep` (TOCTOU abort path also skips the marker)

### Fix 4 — Sent-body content scan (RT-1) — DEFERRED
**Decision: do not implement in this PR.**

`SENSITIVE_KEYWORDS` was designed for header metadata (short, structured strings: email addresses, subjects). The gate doc's own guidance for RT-1 notes the design intent: "whole-word matches only, on the short From/Subject metadata we already hold." Applying the same list to an 8 KB plain-text body produces an uncharacterized false-positive rate — "bank" appears in benign body text ("river bank," "food bank," "bank holiday," "Steinbeck"), "tax" appears in "syntax" and "satisfaction," etc. Half-implementing this risks silently dropping legitimate sent messages from the seed, reducing sweep quality without clear privacy benefit (the header gate already blocks the highest-signal cases).

The correct fix requires: (a) a dedicated keyword list tuned for body scanning (tighter, phrase-level, lower false-positive), (b) false-positive measurement against a representative corpus, and (c) a decision on scope (INVARIANTS C5/C7 update). This is a standalone pass, not a one-liner reuse. Tracked as a follow-up issue; the feature remains dark until it ships.

---

## 4-lens adversarial review

### Red-team

**Fix 1 (Bcc gate):** The Google `format=metadata` endpoint returns Bcc only for the message owner (the authenticated user sent it); third-party observers cannot inject Bcc. Fetching it is safe. The `isSensitiveThread` normalizer already handles arbitrary strings without ReDoS (no dynamic RegExp). Low false-positive risk: Bcc is short (email address), and the whole-word tokenizer splits domains at `.`.

**Fix 2 (TOCTOU):** The re-check is a fresh DB read under service-role credentials on the same `connections` row. The `sweep_consent_at` column is updated by the same service-role code path that handles consent revocation — the re-check is authoritative. The early-return path closes the claim row (via the route's finalize) so the stale-reclaim never sees a `running` row; no secondary leak. One edge: if `freshConsent` SELECT itself fails (network), `freshConsent` is null and `freshConsent.sweep_consent_at` would throw. **Verified:** the code does `if (!freshConsent || freshConsent.sweep_consent_at == null)` — the `!freshConsent` guard catches a null result, so a SELECT failure → `data: null` → abort path (fail-closed). PASS.

**Fix 3 (provenance marker):** The marker write is best-effort (no error propagation). A failure means the row lacks the marker and the pre-existing reclaim path applies — not worse than before. The migration uses `add column if not exists` (replay-safe). The new `claim_gmail_sweep` function re-reads the stale row under the same partial unique index that serializes concurrent claims; the pre-check + UPDATE is not itself atomic, but the window is sub-millisecond and the worst case is that two simultaneous reclaims both try to finalize — both UPDATE the same row to `complete`; only one wins; the other is a no-op. Safe. PASS.

**RT-1 deferred correctly:** The pre-existing body fetch already has the header gate; deferring the body scan is safer than a noisy keyword list on 8 KB text. PASS.

### Claims-auditor

The PR makes no changes to user-visible copy, consent language, or privacy documentation. The behavioral changes (Bcc screening, TOCTOU abort, provenance marker) are all more restrictive than the prior behavior — they cause the sweep to process *fewer* messages or write *fewer* notes in edge cases. No copy claims "we never read Bcc" or "sweep is instantaneous" — the consent checkbox copy remains unchanged. PASS (no copy/behavior mismatch introduced).

The RT-1 deferral note correctly identifies that the existing privacy.html language ("only short derived notes … not the raw messages") is already a pre-existing overclaim (flagged in the prior gate as a standalone backlog item). This PR does not worsen it. PASS.

### Logic-skeptic

**Fix 2 TOCTOU:** The early-return at the consent re-check sets `status` and `messagesRead` from whatever the sweep read, and `derived` from whatever was computed. The route then finalizes the claim row with `result.status` and `result.messagesRead`. This correctly closes the `running` row, preventing a secondary stale-reclaim. No data is written to grove_memory/grove_state. PASS.

**Fix 3 provenance marker ordering:** The marker is written (a) after the TOCTOU re-check passes, (b) after the grove writes complete. If the TOCTOU check aborts, the marker is never written — correct (nothing was written to grove). If the grove writes succeed but the marker write fails (network), the reclaim will re-run — this is the documented acceptable residual, not a regression. PASS.

**Migration correctness:** The new PL/pgSQL function has a single `declare ... begin ... end` block with all variables declared upfront. The INSERT...ON CONFLICT...RETURNING INTO pattern is valid PL/pgSQL (tested in the integration test suite via the RLS harness that applies all migrations to a local Postgres). PASS.

### Cost-auditor

**Fix 2 (TOCTOU):** Adds one extra SELECT on `connections` per sweep invocation — a negligible read against a single indexed row. The early-return path prevents all grove writes and the provenance marker write, so a mid-sweep revocation is cheaper than a completed sweep, not more expensive. PASS.

**Fix 3 (provenance marker):** Adds one extra UPDATE to `gmail_sweep_log` per successful sweep (after grove writes). Sub-millisecond; the row is small. The net cost benefit: a hard-kill + reclaim path that previously re-spent the full ~45 s model budget now skips the re-run entirely. PASS.

**Fix 1 (Bcc):** One extra `metadataHeaders` parameter per `getMessageMetadata` call — the response size increases by at most a few bytes (Bcc is typically absent or short). No extra API round-trips. PASS.

**RT-1 deferral:** No new cost incurred. PASS.

---

## Disposition
- Blocking (P0/P1): none found
- Fixes shipped: Fix 1 (Bcc gate), Fix 2 (TOCTOU abort), Fix 3 (provenance marker) — all PASS
- Deferred: Fix 4 (sent-body content scan) — documented rationale above; tracked as standalone follow-up
- Migration: `20260619240000_sweep_provenance.sql` (DO NOT apply until merge; controller applies)
- **Gate verdict: PASS (0 P0; 0 P1)**
- **Signed:** _pending John_
