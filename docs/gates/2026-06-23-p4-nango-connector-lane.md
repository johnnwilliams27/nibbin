# Adversarial gate — P4 Nango connector lane (Gmail + Google Calendar) (2026-06-23)

- **Branch / PR:** `feature/company-brain-nango` → `main` (#243)
- **Reviewed diff:** `git diff origin/main...HEAD` at `1a360b0c` (base `a75a0da7`)
- **Gate run by:** Claude Opus 4.8 (adversarial gate) on 2026-06-23

## Scope

P4 moves Gmail + Google Calendar from the hand-built `[H]` OAuth lane to a
Nango-managed `[N]` lane: token custody is Nango Cloud, requests route through
`nango.proxy()`, and a new Nango auth-webhook activates the connection. Sensitive
surfaces in the diff:

- `apps/web/app/api/connect/nango/callback/route.ts` — Nango auth webhook receiver
- `apps/web/lib/connections/nango-connect.ts` — connect-URL builder + tester gate
- `apps/web/app/app/connections/actions.ts` — `[N]` connect / disconnect actions
- `apps/web/lib/connections/revoke-connection.ts` — `[N]` disconnect (Nango delete)
- `apps/web/lib/connectors/nango.ts` — Nango SDK singleton (env-keyed)
- `packages/connectors/src/connectors/nango-base.ts` + gmail/calendar clients
- `supabase/migrations/20260623000000_nango_connection_cols.sql` — schema
- cron/webhook consumers swapped `new GmailClient(conn, vault)` → `makeGmailClient(conn, getNango())`

## CI step
- typecheck: ☑ (apps/web + packages/connectors clean; known-acceptable `.next/types` / `@vercel/analytics` / `@sparticuz/chromium` not chased)
- tests (count): ☑ 307 passed / 3 skipped (DB-gated RLS) across connectors + connect/cron/webhook suites
- lint: ☑ (`eslint .` clean)
- audit: ☐ (not run in gate; no new runtime deps beyond `@nangohq/*` already in lock)
- SAST: ☑ semgrep `p/default` (pinned image `sha256:f4791a5…`) — **0 findings (0 blocking)** on the 9 P4 source files + the callback test
- redaction corpus: n/a (no redaction surface touched)
- trigger-graph: n/a

## Adversarial reviewers
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | FAIL→PASS (after fix) | 0 | 1 (fixed) | 0 | 0 |
| claims-auditor | PASS | 0 | 0 | 0 | 0 |
| logic-skeptic | PASS | 0 | 0 | 0 | 1 |
| cost-auditor | PASS | 0 | 0 | 0 | 0 |

## Findings (severity-ranked)

### C-1 — Cross-account connection takeover via forged `connection_id` (Critical / red-team) — FIXED

**File:** `apps/web/app/api/connect/nango/callback/route.ts` (pre-fix lines 207–284),
`apps/web/app/app/connections/actions.ts` (`[N]` branch).

**Impact.** The pre-fix callback derived the owning `accountId` purely by
string-parsing the inbound `connectionId` (`nibbin-{accountId}-{provider}`) and
then **INSERTed a brand-new active `connections` row** for that account when no
matching row existed (the "C1 first-time connect" path). The `connection_id` is a
query parameter on the Nango hosted-OAuth URL, and `NANGO_PUBLIC_KEY` is
browser-exposed by design — so an authenticated, tester-allowlisted user could
start a Nango connect with `connection_id=nibbin-{VICTIM_ACCOUNT}-gmail`, complete
OAuth with **their own** Google account, and Nango would fire a correctly-HMAC-signed
webhook. The callback would then create/overwrite the victim account's gmail (or
calendar) connection row, binding the victim's Nibbins to an **attacker-controlled
mailbox/calendar** (integrity + confidentiality: victim agents read/act on the
attacker's data; victim's drafted sends route through the attacker's token custody).
The HMAC check did **not** mitigate this — the webhook is genuine; the problem is
that nothing bound the `connectionId` to the account that actually initiated the
connect. The `[H]` lane is not vulnerable because it binds the flow to the
authenticated account via a server-stored single-use `state` nonce
(`oauth_pending_authorizations`); the `[N]` lane had no equivalent binding.

**Fix.** Establish the account↔connectionId binding **server-side at connect time**
and require it at activation:
- `beginConnectAction` (`[N]` branch) now pre-issues a `connections` row bound to
  the **session** `accountId` (from `appSession()`), `method='N'`,
  `status='pending'`, `nango_connection_id = <the id we hand to Nango>`, before
  redirecting. Reconnect reuses/refreshes the existing non-revoked row.
- The callback no longer parses-and-trusts the account, and no longer INSERTs. It
  looks up the **pre-issued** row by `(account_id, provider, nango_connection_id,
  status<>revoked)` and only **activates** that row. A forged/never-initiated
  `connectionId` matches no pre-issued row → the callback returns `400
  connection_not_pre_issued` and writes nothing.

**Tests.** `apps/web/app/api/connect/nango/callback/route.test.ts` rewritten:
the former "INSERT when no row" case now asserts **400 + no insert/update** (the
forgery path); reconnect + first-activate + idempotent-replay cases assert
activation of the pre-issued row. 29/29 pass.

**Status:** RESOLVED.

### M-1 — No dedicated webhook replay record (Minor / logic-skeptic, P3) — accepted, tracked

**File:** `apps/web/app/api/connect/nango/callback/route.ts`.

The auth-webhook handler does not write a `webhook_events` idempotency row, so a
replayed (captured) signed webhook re-runs the handler. Post-C-1 the impact is
limited: the handler is idempotent (re-activates the same pre-issued row) and is
now account-bound (a replay cannot bind a different account), so the worst case is
a redundant `getConnection()` + a duplicate fire-and-forget watch registration
(which the Gmail/Calendar `watch` APIs treat as a renew). No state corruption.
**Follow-up (non-blocking):** consider recording `(provider, connectionId,
operation)` in `webhook_events` for exactly-once parity with the Gmail push lane.

## Surfaces reviewed with NO issues found (explicit)

- **Webhook HMAC verification.** `route.ts` reads the **raw** body, verifies via
  the Nango SDK `verifyIncomingWebhookRequest(rawBody, headers)` (SDK does the
  constant-time HMAC-SHA256 compare), and is **fail-closed**: absent or bad
  signature → 401; an unset `NANGO_WEBHOOK_SIGNING_KEY` makes the SDK return
  `false` → 401 (covered by 3 signature tests). Signing key is read from env
  (`nango.ts`), never hardcoded. No issue.
- **Token / secret handling.** No raw OAuth tokens are stored in Nibbin's DB on the
  `[N]` lane — only Nango's opaque `nango_connection_id` + `nango_provider_config_key`
  (custody is Nango Cloud, per design §76/§201). `NANGO_SECRET_KEY` /
  `NANGO_WEBHOOK_SIGNING_KEY` / `NANGO_PUBLIC_KEY` are all env-sourced; only the
  public key reaches the browser. Grepped the full diff for `console.*` logging of
  `token|secret|credential|accessToken|apiKey|signingKey` — **none**. No issue.
- **Open-redirect.** `returnTo` is encoded into Nango's `state`; the only `[N]`
  route in this PR is the server-to-server webhook, which returns JSON and never
  consumes `state` as a redirect target. The post-OAuth browser redirect is handled
  by Nango against its server-side integration redirect-URI config. No Nibbin-side
  redirect sink consumes attacker input. No issue. (`returnTo` is effectively inert
  on the `[N]` side — noted, not a vuln.)
- **Disconnect / `deleteConnection` arg order.** `revoke-connection.ts` calls
  `nango.deleteConnection(providerConfigKey, connectionId)` — matches the
  `@nangohq/node` signature (the design doc comment had the args reversed; the
  **code is correct**), is **fail-open** (a Nango error never blocks the local
  revoke per Global Constraint 8), and runs **before** the `connection_revoke` RPC.
  Disconnect lookup is account-scoped (`.eq('account_id', accountId)`), so a request
  can only revoke the caller's own connection. Covered by `nango-disconnect.test.ts`
  (arg order + ordering + fail-open). No issue.
- **Egress allowlist (proxy).** `NangoConnectorClient.assertEgress()` re-checks the
  target host against `descriptor.egressAllowlist` **before every** `nango.proxy()`
  call (Nango does not enforce Nibbin's per-connector allowlist). Absolute URLs are
  parsed and host-checked; relative paths trust the connector's own allowlist base.
  Connection must be `active` or the request throws. Defense-in-depth intact. No issue.
- **RLS / authz on the migration.** `20260623000000` adds two **nullable** text
  columns and extends the `method` CHECK to accept `'N'`; it does not touch RLS or
  policies. `tests/rls/nango-connection-cols.test.ts` asserts the columns exist +
  are nullable, existing `[H]` rows are unaffected, `[N]` rows store the identifiers
  and are readable **only by the owning account**, and account B cannot read account
  A's connections. No issue.
- **`makeGmailClient`/`makeGoogleCalendarClient` factories.** Validate provider
  match and throw a typed `NangoConnectionMissingError` when a `method='N'`
  connection has a null `nangoConnectionId` (prevents silently proxying with an
  empty id → "reconnect required"). All cron/webhook/sweep call sites swapped to the
  factories. No issue.
- **Dev seed mismatch (claims-auditor).** `lib/scan/run.ts` intentionally seeds
  gmail/calendar as `method:'H'` (not `'N'`) so the dev fixture reader is used and
  `makeGmailClient` doesn't throw on a null id; gated behind `NIBBIN_DEV_SEED` and
  never touches real OAuth. Documented in-code. Legitimate, no issue.
- **Cost (cost-auditor).** No new model calls, no new always-on polling. `[N]`
  swaps vault reads for Nango proxy calls on the same cron cadence; the callback
  adds one `getConnection()` per connect. Negligible. No issue.

## Disposition
- Blocking (P0/P1) resolved: ☑ (C-1 fixed + tests)
- Non-blocking tracked: ☑ (M-1 webhook replay record — follow-up)
- **Gate verdict:** PASS (after C-1 fix)
- **Signed:** Claude Opus 4.8 (adversarial gate) on 2026-06-23
