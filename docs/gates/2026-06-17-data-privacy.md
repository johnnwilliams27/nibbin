# Adversarial gate — Data & Privacy panel + contribution opt-out + notification prefs (2026-06-17)

- **Branch / PR:** `pr/data-privacy` → `main` (#118)
- **Reviewed diff:** the web Data & Privacy panel, the C11/D1-A contribution flag + RPC + toggle, the notification-prefs RPC + UI, and the D1-A legal-copy reconciliation — rebased onto current `main`.
- **Gate run by:** Claude Code (adversarial review subagents, one per sub-feature) on 2026-06-17

## CI step
- typecheck: ☑  tests (privacy lib 10; RLS m65 C11 updated to the new schema): ☑  lint: ☑  audit: ☑  SAST: ☑  redaction corpus: ☑  trigger-graph: n/a
- (Fixed in this commit: `tests/rls/m65-budget.test.ts` still referenced the retired `training_opt_in` column.)

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | pass | 0 | 0 | 0 | 1 |
| claims-auditor | pass | 0 | 0 | 0 | 0 |
| logic-skeptic | pass | 0 | 0 | 0 | 0 |
| cost-auditor (≥M2) | pass | 0 | 0 | 0 | 0 |

## Findings (severity-ranked)
- **Security (RLS / cross-account):** the `set_model_contribution` and `set_notification_prefs` RPCs are `security definer` + `private.is_account_member` gated + audited (`account.model_contribution_set` / `account.notification_prefs_set`); `accountId` is server-derived from `appSession()`, never client input; grants are `authenticated`-only (anon/service_role revoked). The panel reads `accounts`/`connections`/`drip_arcs` through the RLS-scoped session client filtered by the user's own account → no cross-account read. `set_notification_prefs` is **UPDATE-only** (cannot create/mis-anchor the drip worker's 14-day `started_at`). **No cross-account write path.**
- **Claims accuracy (C11/D1-A / TC-P1):** in-app + (drafted) legal copy state the truth — Nibbin never trains models on user content; the opt-out governs anonymized, aggregate **structural** signals, default-on. No "personal sites" / latency / OS-flag over-claims. Reconciled `reference/*.html` back to D1-A (superseding the recent opt-in/content copy) while keeping the Gmail-onboarding-sweep disclosure; pages remain unrouted/draft (publication #46-gated).
- **No secrets rendered:** connection scopes shown as a count, never token material; no logging of PII/secrets.
- **F-P3 (non-blocking):** feedback banners key off `searchParams` so they persist on manual refresh until navigation — cosmetic, matches the existing account-page pattern. Tracked, not fixed.

## Disposition
- Blocking (P0/P1) resolved: ☑ (none found)  Non-blocking tracked: ☑ (F-P3)
- **Gate verdict:** PASS
- **Signed:** John (pending) — authored from the adversarial reviews; awaiting human sign-off on the PR. Migrations already applied to dev/staging/prod (idempotent); legal-copy publication remains attorney-review-gated (#46).
