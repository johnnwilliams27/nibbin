# Adversarial Gate — Stripe connectable as a read-only OAuth connector (`feature/stripe-connectable`)

**Date:** 2026-06-22
**Range:** `4598234e..3f795475` (1 commit, 7 files, 41 lines)
**Plan:** `docs/superpowers/plans/2026-06-22-connector-batch-plan.md` (Phase 2 / Task 5)
**Reviewers:** red-team (opus), claims+logic (sonnet). Cost: N/A — no execution/runtime path changed (connect-wiring only).
**Sensitive surface:** `packages/connectors/` — opens a new OAuth connection path.

## Change

Make Stripe connectable as a **read-only** OAuth connector: add `stripe` to `CONNECTABLE_PROVIDERS` (`wired:true`) + catalog status `live`; set the registry stripe `scopes.write` to `[]` so connect requests only `read_only` (Option B — overdue-invoice nudges ride `email.send` via Gmail; Stripe is never written to); add `STRIPE_OAUTH_CLIENT_ID/_SECRET` to the refresh-credential resolver. The account-scoped Stripe Connect access token is self-contained (Bearer, no `Stripe-Account` header), so the generic callback + client need zero Stripe-specific handling (`stripe_user_id` not captured — verified safe).

## Verdicts

| Reviewer | Verdict | P0 | P1 | P2 |
|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 1 |
| claims+logic | PASS | 0 | 0 | 1 |

**Overall: PASS** (no P0/P1; 2 advisory P2s, both fail-closed and moot — accepted).

## Positive confirmations (red-team)

- **Stripe can NEVER request or obtain a write scope** — four independent walls: `beginConnectAuthorization` concatenates `read` + empty `write` → `['read_only']` (asserted by the new test); `beginWriteScopeUpgrade` rejects any scope outside the empty declared-write set; `setNibbinActionLevel('act')` filters grant reconciliation to `['gmail','google-calendar']` only; `writeGrantSpecFor('stripe')` returns null. The vestigial `invoice.nudge` capability is inert metadata read by no scope/grant path.
- **The Stripe access token (a live restricted key) is vault-only** — sealed via `connection_token_store`; surfaces only in the `authorization` header to egress-pinned `api.stripe.com`; connection rows persist scope strings, not the token; `STRIPE_OAUTH_CLIENT_SECRET` is read from env only and never logged (token-endpoint errors carry status codes, not bodies).
- **Unconfigured creds fail closed** — `getOAuthConfigFor` throws "Missing STRIPE_OAUTH_*" before any redirect/DB write/token issuance; refresh-on-401 falls through to a reconnect prompt when the refresh token/creds are absent. Callback gated by `isWiredProvider` + `expectedProvider`. Not capturing `stripe_user_id` is safe (account-scoped token).

## Positive confirmations (claims+logic)

- All comments/copy accurate: the providers/registry read-only rationale and the catalog `whatItDoes` ("draft a personal reminder email") correctly describe the cross-resource `nudge.overdue-invoice` primitive (reads Stripe, drafts via Gmail). `status:'live'` is consistent with Gmail/Calendar's identical credential-gated pattern (not a misrepresentation). No copy claims a Stripe-native send.
- `scopes.write = []` is logically safe at all 5 call sites — `beginConnectAuthorization` degrades to `['read_only']`; nothing indexes `write[0]`; the validator for-loop is a no-op over an empty array. Tests are real (read_only scope + live listing), not weakened.

## P2 findings — accepted (advisory, fail-closed, moot)

- **P2 (red-team): begin-side `isWiredProvider` gate asymmetry.** `beginConnectAction` lacks the begin-side wired gate present on the callback. Moot for stripe (it is wired) and fail-closed for non-wired providers via the missing-creds throw. Optional defense-in-depth follow-up.
- **P2 (claims+logic): `beginWriteConnect('stripe')` throws** (`invalid-write-request: no write scopes requested`) because stripe's declared write set is empty. No current UI path reaches it; `provider` is client-supplied, so it's a reachable but **fail-closed** error surface (a clean throw, not a leak). This is actually the *correct* read-only behavior — Stripe cannot be made to request write. Optional: a covering test to make the fail-closed contract explicit.

Both are fail-closed and do not weaken the "Stripe can never write" invariant, which is already enforced by four independent walls + the read-only scope test. Accepted; tracked for an optional defense-in-depth follow-up.

## Verification

Full suite **2156 passed** (only the 3 pre-existing `@sparticuz/chromium` env tests fail; green in CI); full `npm run typecheck` clean on touched files; lint clean. New tests: stripe begins `read_only` only (no `read_write`); stripe listed live in providers + catalog.

**Gate status: PASS.** Live prereq (not code): owner's Stripe Connect OAuth app + `STRIPE_OAUTH_*` in Vercel + redirect URI `https://nibbin.com/api/connect/stripe/callback` + `tester_allowlist` seed for stripe.
