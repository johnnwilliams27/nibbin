# Task 8 — enforcePlatformGate export + beginConnectAction [N] routing

**Date:** 2026-06-23
**Branch:** feature/company-brain-nango
**Status:** COMPLETE — all tests green, lint + typecheck clean

---

## What was built

### (a) `enforcePlatformGate` extracted as standalone export

**File:** `packages/connectors/src/oauth/flow.ts`

- Added `PlatformGateRequest` interface — narrower than `BeginAuthorizationRequest`. Only carries `provider` and optional `tester`. No `clientId` or `redirectUri` (which the gate never reads).
- `BeginAuthorizationRequest` now extends `PlatformGateRequest` (no breaking change — all existing callers still compile).
- `enforcePlatformGate` changed from `function` to `export function`, signature updated to take `PlatformGateRequest` instead of `BeginAuthorizationRequest`. Both the [H] call sites (`beginAuthorization`, `beginConnectAuthorization`, `beginWriteScopeUpgrade`) pass `BeginAuthorizationRequest` which is a subtype — zero changes required at those call sites.

### (b) `buildNangoConnectUrl` + `providerToNangoKey`

**File:** `apps/web/lib/connections/nango-connect.ts` (new)

- `buildNangoConnectUrl` enforces the tester gate by calling `enforcePlatformGate` directly with the narrower type. A `null` userEmail maps to `tester: undefined`, causing `tester-required` to be thrown exactly as on the [H] path.
- `providerToNangoKey` maps `gmail` → `google-mail`, `google-calendar` → `google-calendar`; throws on unknown provider.
- Nango hosted connect URL shape: `${NANGO_HOST}/oauth/connect/${providerConfigKey}?connection_id=nibbin-{accountId}-{provider}&public_key=${NANGO_PUBLIC_KEY}`.
- `returnTo` encoded into `state` query param when present.

### (c) `beginConnectAction` forked on `method === 'N'`

**File:** `apps/web/app/app/connections/actions.ts`

- After resolving the descriptor, forks on `descriptor.method === 'N'`.
- [N] path: loads the tester allowlist, calls `buildNangoConnectUrl`, redirects to Nango's hosted OAuth URL. Returns early.
- [H] path: unchanged — `beginConnect` + existing OAuth flow.
- `beginWriteConnectAction` and `disconnectAction` are untouched (Task 9/10 scope).

---

## Tester-gate invariant verification

The gate cannot be lost:

- `enforcePlatformGate` is called inside `buildNangoConnectUrl` before constructing the URL.
- If `userEmail === null` → `tester: undefined` → `OAuthFlowError('tester-required', ...)` thrown.
- If email is not on the allowlist → `OAuthFlowError('tester-not-allowed', ...)` thrown.
- If count >= cap (100 for gmail) → `OAuthFlowError('tester-cap-reached', ...)` thrown.
- These are identical errors to what the [H] path throws — same `OAuthFlowError` class, same `reason` values.

---

## Tests

### New tests

**`apps/web/test/nango-connect.test.ts`** (10 tests)
- builds gmail URL with correct `providerConfigKey` (`google-mail`)
- builds google-calendar URL
- includes `state` param when `returnTo` is provided
- **tester-required** when `userEmail === null` [N] path gate test
- **tester-not-allowed** when email not on allowlist [N] path gate test
- **tester-cap-reached** when count >= 100 [N] path gate test
- throws for non-N provider (honeybook)
- `providerToNangoKey` maps correctly
- `providerToNangoKey` throws for unknown provider

**Added to `packages/connectors/test/oauth.test.ts`** (6 new tests)
- `enforcePlatformGate` is exported as a named function
- `PlatformGateRequest` type accepted without `clientId`/`redirectUri`
- all three gate error cases tested via the standalone export

### Test results

```
packages/connectors  14 passed | 2 skipped (16 files), 223 passed | 3 skipped (226 tests)
apps/web task-8 scope: 32/32 passed (nango-connect.test.ts + begin-connect.test.ts + oauth.test.ts)
```

Pre-existing failures in `apps/web` (12 tests in gmail-watch-renew, connector-poll, gmail-onboarding-sweep): confirmed pre-existing before Task 8 by stash-check. These are Task 4/5/6 scope — GmailClient/GoogleCalendarClient constructor injection at call sites in cron routes. Not introduced by Task 8.

---

## Type friction fix

`enforcePlatformGate` previously required `BeginAuthorizationRequest` which mandates `clientId` and `redirectUri`. The [N] call site (`buildNangoConnectUrl`) would have had to pass empty strings, which is misleading. The fix:

- `PlatformGateRequest` carries only `{ provider, tester? }`
- `BeginAuthorizationRequest extends PlatformGateRequest` adding `clientId`, `redirectUri`, `loginHint`
- No call site changes needed — subtype compatibility preserved

---

## Files changed

| File | Action |
|---|---|
| `packages/connectors/src/oauth/flow.ts` | Added `PlatformGateRequest`, exported `enforcePlatformGate` with narrower sig |
| `packages/connectors/test/oauth.test.ts` | Added 6 tests for `enforcePlatformGate` + `PlatformGateRequest` |
| `apps/web/lib/connections/nango-connect.ts` | New — `buildNangoConnectUrl`, `providerToNangoKey` |
| `apps/web/test/nango-connect.test.ts` | New — 10 tests |
| `apps/web/app/app/connections/actions.ts` | Fork on `method === 'N'` in `beginConnectAction` |

## Files NOT changed (constraint check)

- `packages/connectors/src/rails/mcp.ts` — untouched
- `packages/connectors/src/connectors/base.ts` — untouched
- `apps/web/lib/connections/begin.ts` — untouched ([H] path unchanged)
- `apps/web/lib/connections/begin-write.ts` — untouched
- `apps/web/lib/connections/revoke-connection.ts` — untouched (Task 10)
- All [H] connector files (honeybook, pixieset, instagram, stripe) — untouched
