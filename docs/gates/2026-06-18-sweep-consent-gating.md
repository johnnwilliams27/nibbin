# Adversarial gate — sweep consent-gating (2026-06-18)

- **Branch / PR:** `feature/sweep-consent-gating` → `main`
- **Reviewed diff:** `git diff 5eb2841..7403ce3` (the feature branch); P1 fixes applied in a follow-up commit (`105b31e`) and re-verified.
- **Gate run by:** Claude (multi-agent gate via Workflow — the 4 `.claude/agents/*` reviewer personas over the branch diff, each finding adversarially verified by an independent skeptic) on 2026-06-18.

## CI step
- typecheck (connectors + web): ☑  tests (1031: 1028 pass / 3 skip): ☑  lint: ☑  SAST (semgrep p/default, changed dirs): ☑  audit: ☐ (CI)  redaction corpus: ☐ (CI)  trigger-graph: ☐ (CI)

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | reviewed | 0 | 1 (RT-2) | 2 (RT-1, RT-3) | 2 (RT-4, RT-5) |
| claims-auditor | PASS (copy = behavior) | 0 | 0 | 0 | 2 (CA-1, CA-2) |
| logic-skeptic | reviewed | 0 | 1 (LS-1) | 2 (LS-2, LS-3) | 3 (LS-3b, LS-4, LS-5) |
| cost-auditor (≥M2) | reviewed | 0 | 0 | 1 (COGS-1) | 1 (COGS-2) |

**Result: 15 confirmed (0 P0, 2 P1, 5 P2, 8 P3).** Both P1s + two cheap P3s **fixed in this PR** (commit `105b31e`); the P2s and remaining P3s are tracked (P2/P3 do not block per docs/AGREEMENTS.md).

**Claims-auditor PASS (the central TC-P1 check):** the connect checkbox + Data & Privacy copy accurately state sent-message bodies are *processed by the model* and the inbox is reduced to subjects/previews; the known #132 overclaim ("…never the raw mail") was genuinely removed and not reintroduced; consent is affirmative (checkbox unchecked, default off everywhere); no copy promises a "forget" the code doesn't do.

## Findings

### P1 — FIXED in this PR
- **RT-2 [security] host-header poisoning of the internal sweep POST — FIXED.** The callback dispatched the HMAC-bearing worker POST using `request.url` (derives from the attacker-influenceable Host/`x-forwarded-host` on Vercel). Now uses `siteOrigin()` (the pinned trusted origin), matching the panel path; the user-facing redirect still uses `request.url`. (`callback/route.ts`.) Resolves the LS-3b duplicate too.
- **LS-1 [correctness] dispatch fired on pre-existing consent regardless of the flow's choice — FIXED.** `onGmailConnected` dispatched whenever the connection already had `sweep_consent_at`, ignoring the `sweepConsent` argument — so a write-scope upgrade (which reuses the connection row) re-fired the sweep with no consent input. Now dispatch happens **only on an affirmative opt-in in the current flow**; a prior stamp is preserved and does not re-trigger. (`dispatch.ts`; test updated.)

### P3 — FIXED in this PR (cheap)
- **LS-5** dropped the `createdPendingUserId ?? ''` fallback (a `''` would corrupt the uuid consent stamp); dispatch now guards on a real userId.
- **LS-4** updated stale "~90 day" sweep comments to "~12 months".

### P2 — tracked (non-blocking; feature is dark — `SWEEP_HMAC_SECRET` unset)
- **RT-1 [privacy] sent-mail sensitive pre-filter is header-only.** Pass-1 gates on `isSensitiveThread(meta,['to','cc'])` (To/Cc + Subject) but never content-scans the fetched sent **body** before sending it to the LLM; the 90→365 widening enlarges the exposure window. Follow-up: content-scan the sent body (reuse `SENSITIVE_KEYWORDS`) before batching, or scope INVARIANTS C5/C7 explicitly. (Pre-existing filter design; widened here.)
- **RT-3 / LS-2 [privacy] TOCTOU — consent revoke mid-sweep doesn't stop an in-flight sweep.** The worker reads `sweep_consent_at` once before the ~45s sweep; turning off during that window doesn't abort the derive/persist. Follow-up: re-check consent immediately before the `grove_memory`/`grove_state` writes and abort if withdrawn.
- **LS-3 [correctness] stale consent on connection-row reuse** — a write-upgrade reusing a previously-consented row keeps the old consent. Decision: **preserve** (consent survives a write-upgrade; the user opted in once) — and the LS-1 fix ensures it no longer re-dispatches. Documented; no code change beyond LS-1.
- **COGS-1 [cost] low-volume mailboxes spend more with the 365 window** (more messages clear the caps). Accepted: bounded, one-time, and the explicit product goal of a 12-month seed. Follow-up: confirm p95 sweep cost post-rollout via `model_calls`.

### P3 — tracked
- **RT-4** disable doesn't delete already-derived notes (no "forget") — **by design** (decided in the spec); copy does not claim erasure. Optional future "forget" action.
- **RT-5** consent-state is boolean-presence (nulled-after-revoke == never-consented) — consider an audit row for grant/revoke history.
- **CA-1** panel toggle is reversible in label only (re-enable after a completed sweep → worker returns `already_swept`); consider a one-line hint when `consentedAt` exists.
- **CA-2** landing page (`app/page.tsx`) still says "scan of the last 90 days" — generic, out of this branch's scope; reconcile separately.
- **COGS-2** re-enable after a swept connection dispatches a wasted (zero-spend) round-trip; optional SELECT-guard.

## Disposition
- Blocking (P0/P1) resolved: ☑ (both P1s fixed + re-verified: 1028 tests, tsc, eslint, SAST clean)
- Non-blocking: 2 cheap P3s fixed; 5 P2 + 6 P3 tracked (filed as follow-up issues).
- **Gate verdict:** PASS (0 P0; 0 P1 remaining)
- **Signed:** _pending John_
