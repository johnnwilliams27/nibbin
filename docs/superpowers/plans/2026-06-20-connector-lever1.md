# Connector Lever 1 — Generic OAuth Callback + Google Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize Nibbin's OAuth-connect infrastructure so any wired connector can complete a connect, then fully light up Google Calendar (connect → diagnosis findings → cron-poll liveness), and unify the scan window to 12 months across all connectors.

**Architecture:** The callback flow is already abstracted behind a provider-agnostic `completeConnection` orchestrator and `makeCreateActiveConnection` already keys connection rows per-provider (Option B). This plan (1) parameterizes the three remaining Gmail-specific pieces — OAuth env config, the `[provider]` callback route, and the post-connect dispatch — by provider; (2) bumps the scan-engine window from 90 days to 12 months with a single source of truth; (3) adds Google Calendar incremental sync (`nextSyncToken`) to the cron poll; (4) flips the wiring flags and adds human-actionable front-end error states.

**Tech Stack:** TypeScript, Next.js 15.3 App Router (`apps/web`), Supabase (service-role RPC + vault), Vitest, npm workspaces monorepo. Connector logic in `packages/connectors`, scan modules in `packages/scan`.

## Global Constraints

- **Branch discipline:** `main` is PR-protected — do all work on `feature/connector-lever1`; land via `gh pr create --base main`. Fetch+rebase before opening the PR.
- **One Google OAuth app:** Google Calendar reuses the existing `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — **no new client credentials**.
- **External prerequisite (human):** the redirect URI `https://nibbin.com/api/connect/google-calendar/callback` (and `http://localhost:3000/api/connect/google-calendar/callback` for dev) must be added to the existing Google OAuth app before the live round-trip works. Code can be built and unit-tested without it.
- **Scopes:** read-only at connect (`calendar.readonly`); write (`calendar.events`) is granted per-Nibbin at runtime, never at connect (C8).
- **Token discipline:** tokens live only in the Supabase Vault (`connection_token_store` RPC) — never in app tables, logs, or redirect URLs (C9).
- **Security gate:** this touches OAuth, the token vault, and an open-redirect surface — the 4-reviewer adversarial gate (red-team / claims-auditor / logic-skeptic / cost-auditor) MUST run before merge, with the report written to `docs/gates/2026-06-20-connector-lever1.md`.
- **Verification before PR:** run `npm run lint`, `npm run typecheck`, the test suite, AND `npm run build` — green on all four. (Local `@nibbin/*` "missing export" tsc errors are usually stale-workspace-dist false positives; confirm with a fresh `npm ci` if they appear.)
- **Window value:** 12 months everywhere — `SCAN_WINDOW_MONTHS = 12` is the single source of truth; no literal `90` or `/3` may remain in scan math.

---

## File Structure

**New files:**
- `apps/web/app/api/connect/[provider]/callback/route.ts` — dynamic OAuth callback for non-Gmail providers.
- `apps/web/lib/connections/callback-core.ts` — shared callback handler core (used by both the legacy Gmail route and the dynamic route).
- `apps/web/lib/connections/oauth-config.ts` — `getOAuthConfigFor(provider)` (generalizes `getGoogleOAuthConfig`).
- `packages/connectors/src/connectors/calendar-delta.ts` — `fetchCalendarDelta` (incremental sync via `nextSyncToken`).

**Modified files:**
- `packages/connectors/src/types.ts` — `SCAN_WINDOW_MONTHS`, window derivation.
- `packages/scan/src/modules/payments.ts` — monthly divisor driven by the constant; copy.
- `packages/scan/src/modules/crm.ts`, `packages/scan/src/engine.ts`, `packages/scan/src/index.ts`, `packages/scan/package.json`, `packages/connectors/src/connectors/google-calendar.ts` — "90 days" copy/comments + a new sync method.
- `apps/web/lib/connections/google-oauth-env.ts` — keep as a thin wrapper over `getOAuthConfigFor('gmail')`.
- `apps/web/app/api/connect/google/callback/route.ts` — delegate to `callback-core`.
- `apps/web/app/app/connections/actions.ts` (or wherever `beginConnectAction` lives) — pass per-provider config.
- `apps/web/app/api/cron/connector-poll/route.ts` — provider switch (gmail | google-calendar).
- `apps/web/lib/connections/providers.ts` — `google-calendar` → `wired: true`.
- `apps/web/lib/connections/catalog.ts` — `google-calendar` → `live`.
- the connections page component — front-end error states.
- `apps/web/test/connect-callback.test.ts` — update import path after the move.

---

## Task 1: Unify the scan window to 12 months

**Files:**
- Modify: `packages/connectors/src/types.ts:27-39`
- Modify: `packages/scan/src/modules/payments.ts` (~lines 109, 118, 144, 145)
- Modify (copy/comments only): `packages/scan/src/modules/crm.ts:137`, `packages/scan/src/engine.ts:3`, `packages/scan/src/index.ts:3`, `packages/scan/package.json:6`, `packages/connectors/src/connectors/google-calendar.ts:36`
- Test: `packages/connectors/test/scan-window.test.ts` (new), extend `packages/scan/test/modules.test.ts`

**Interfaces:**
- Produces: `SCAN_WINDOW_MONTHS: number` (= 12) and unchanged `scanWindowEndingAt(endMs: number): ScanWindow` from `@nibbin/connectors`. Consumed by `payments.ts` for monthly averaging.

- [ ] **Step 1: Write the failing test for the window constant**

Create `packages/connectors/test/scan-window.test.ts`:

```typescript
import { expect, it, describe } from 'vitest';
import { SCAN_WINDOW_MONTHS, scanWindowEndingAt } from '../src/types';

describe('scan window', () => {
  it('is a 12-month lookback', () => {
    expect(SCAN_WINDOW_MONTHS).toBe(12);
  });

  it('spans ~365 days ending at the given instant', () => {
    const end = 1_700_000_000_000;
    const w = scanWindowEndingAt(end);
    expect(w.endMs).toBe(end);
    const days = (w.endMs - w.startMs) / 86_400_000;
    expect(days).toBe(365);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/connectors/test/scan-window.test.ts`
Expected: FAIL — `SCAN_WINDOW_MONTHS` is not exported.

- [ ] **Step 3: Change the window constant**

In `packages/connectors/src/types.ts`, replace lines 27-39:

```typescript
/** The 12-month read-only lookback every scan module computes over. */
export interface ScanWindow {
  /** inclusive, epoch ms */
  startMs: number;
  /** exclusive, epoch ms */
  endMs: number;
}

/** Single source of truth for the lookback. Months → days here, and modules
 *  that average per-month MUST divide by this same constant (see payments.ts)
 *  so the window length and the monthly math can never drift apart. */
export const SCAN_WINDOW_MONTHS = 12;
/** 12 months expressed as days for the epoch-ms math (30.4375 d/mo avg). */
export const SCAN_WINDOW_DAYS = Math.round(SCAN_WINDOW_MONTHS * 30.4375); // 365

export function scanWindowEndingAt(endMs: number): ScanWindow {
  return { startMs: endMs - SCAN_WINDOW_DAYS * 86_400_000, endMs };
}
```

Also update the file-header comment on line 5 (`(connection, 90-day window)` → `(connection, 12-month window)`).

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/connectors/test/scan-window.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the corrected monthly math**

Extend `packages/scan/test/modules.test.ts` — add (import `SCAN_WINDOW_MONTHS` at the top of the file from `@nibbin/connectors`):

```typescript
it('fee-leakage averages fees over the full window, not a hardcoded 3 months', async () => {
  // 12 balance transactions, $10 fee each = $120 total fees over 12 months = $10/mo
  const txns = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, fee: 1000, amount: 50000 }));
  const reader = {
    read: async () => quarantine(JSON.stringify({ data: txns }), 'stripe:c1:/v1/balance_transactions'),
  };
  const conn = { ...baseConn, provider: 'stripe' };
  const out = await paymentsFeeLeakage.run({ connection: conn, window: scanWindowEndingAt(NOW), reader });
  // $120 / SCAN_WINDOW_MONTHS(=12) = $10, NOT $120/3 = $40
  expect(out[0]?.cost.dollarsPerMonth).toBe(1200 / SCAN_WINDOW_MONTHS / 100 * 100 / 100); // = 10
});
```

(Adapt `quarantine`, `baseConn`, and the `paymentsFeeLeakage` import to the test file's existing helpers — `modules.test.ts` already imports modules and a quarantine helper; mirror its pattern. The assertion intent: monthly = total_dollars / `SCAN_WINDOW_MONTHS`.)

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run packages/scan/test/modules.test.ts -t "fee-leakage averages"`
Expected: FAIL — current code divides by `3`, yielding 40, not 10.

- [ ] **Step 7: Fix the monthly math + copy in payments.ts**

In `packages/scan/src/modules/payments.ts`:
- Add to the imports from `@nibbin/connectors`: `SCAN_WINDOW_MONTHS`.
- Line ~109: `const feeDollarsMonth = Math.round(txns.reduce((s, t) => s + (t.fee ?? 0), 0) / 100 / SCAN_WINDOW_MONTHS);`
- Line ~118 basis string: `` basis: `fees summed over ${txns.length} balance transactions in 12 months, divided by ${SCAN_WINDOW_MONTHS} months`, ``
- Line ~144: `dollarsPerMonth: Math.round((recurring.reduce((s, i) => s + (i.amount_paid ?? 0), 0) / 100) / SCAN_WINDOW_MONTHS),`
- Line ~145 basis string: `` basis: `${recurring.length} of ${paid.length} paid invoices ride a subscription; amounts from amount_paid over ${SCAN_WINDOW_MONTHS} months`, ``

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run packages/scan/test/modules.test.ts`
Expected: PASS (all module tests — watch for magnitude shifts in other assertions; if any assert a `dollarsPerMonth` magnitude tied to the old 3-month basis, they are now revealing the same bug — update them to the 12-month basis).

- [ ] **Step 9: Sweep remaining "90 days" copy/comments**

Replace literal "90 days" / "90-day" / "in 90 days" with "12 months" / "12-month" in:
- `packages/scan/src/modules/crm.ts:137` basis string (`published in 90 days` → `published in 12 months`).
- `packages/scan/src/engine.ts:3` comment, `packages/scan/src/index.ts:3` comment.
- `packages/scan/package.json:6` description.
- `packages/connectors/src/connectors/google-calendar.ts:36` comment (`90-day window` → `12-month window`).

Verify none remain: `grep -rn "90.day\|90 day\|in 90\|/ 3\b" packages/scan/src packages/connectors/src` returns nothing in scan math/copy.

- [ ] **Step 10: Run full scan + connectors tests**

Run: `npx vitest run packages/scan packages/connectors`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/connectors/src/types.ts packages/connectors/test/scan-window.test.ts packages/scan/
git commit -m "feat(scan): unify lookback window to 12 months (single source of truth)"
```

---

## Task 2: Per-provider OAuth config

**Files:**
- Create: `apps/web/lib/connections/oauth-config.ts`
- Modify: `apps/web/lib/connections/google-oauth-env.ts`
- Test: `apps/web/test/oauth-config.test.ts` (new)

**Interfaces:**
- Produces: `getOAuthConfigFor(provider: string): { clientId: string; clientSecret: string; redirectUri: string }`. `redirectUri` = `${SITE}/api/connect/${callbackPathFor(provider)}/callback`. Consumed by the callback core (Task 3) and the initiate action (Task 5).
- Produces: `callbackPathFor(provider: string): string` — maps `'gmail' → 'google'` (legacy path), every other provider → its own id.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/oauth-config.test.ts`:

```typescript
import { expect, it, describe, beforeEach } from 'vitest';
import { getOAuthConfigFor, callbackPathFor } from '../lib/connections/oauth-config';

describe('getOAuthConfigFor', () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'gsecret';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://nibbin.com';
  });

  it('keeps Gmail on the legacy /google/ callback path', () => {
    expect(callbackPathFor('gmail')).toBe('google');
    expect(getOAuthConfigFor('gmail').redirectUri).toBe('https://nibbin.com/api/connect/google/callback');
  });

  it('google-calendar reuses the Google app creds but its own callback path', () => {
    const cfg = getOAuthConfigFor('google-calendar');
    expect(cfg.clientId).toBe('gid');
    expect(cfg.clientSecret).toBe('gsecret');
    expect(cfg.redirectUri).toBe('https://nibbin.com/api/connect/google-calendar/callback');
  });

  it('throws a clear error when creds are missing', () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(() => getOAuthConfigFor('google-calendar')).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/oauth-config.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `oauth-config.ts`**

Create `apps/web/lib/connections/oauth-config.ts`:

```typescript
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nibbin.com').replace(/\/$/, '');

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** The URL path segment a provider's OAuth callback lands on. Gmail predates
 *  the per-provider scheme and keeps its historical /google/ path; every other
 *  provider uses its own connector id as the segment. */
export function callbackPathFor(provider: string): string {
  return provider === 'gmail' ? 'google' : provider;
}

/** Which env vars hold a provider's OAuth client creds. Google-family providers
 *  (gmail, google-calendar, ...) all share the one Google OAuth app. */
function credEnvFor(provider: string): { id: string; secret: string } {
  if (provider.startsWith('google') || provider === 'gmail') {
    return { id: 'GOOGLE_OAUTH_CLIENT_ID', secret: 'GOOGLE_OAUTH_CLIENT_SECRET' };
  }
  // Future providers map here (e.g. stripe → STRIPE_OAUTH_*). Not used this slice.
  const up = provider.replace(/-/g, '_').toUpperCase();
  return { id: `${up}_OAUTH_CLIENT_ID`, secret: `${up}_OAUTH_CLIENT_SECRET` };
}

export function getOAuthConfigFor(provider: string): OAuthClientConfig {
  const env = credEnvFor(provider);
  const clientId = process.env[env.id];
  const clientSecret = process.env[env.secret];
  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${env.id} / ${env.secret} (see apps/web/.env.local)`);
  }
  return { clientId, clientSecret, redirectUri: `${SITE()}/api/connect/${callbackPathFor(provider)}/callback` };
}
```

- [ ] **Step 4: Make `google-oauth-env.ts` delegate (back-compat)**

Replace the body of `apps/web/lib/connections/google-oauth-env.ts` with:

```typescript
import { getOAuthConfigFor, type OAuthClientConfig } from './oauth-config';

export type GoogleOAuthConfig = OAuthClientConfig;

/** @deprecated use getOAuthConfigFor('gmail'). Kept so existing imports resolve. */
export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  return getOAuthConfigFor('gmail');
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run apps/web/test/oauth-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/connections/oauth-config.ts apps/web/lib/connections/google-oauth-env.ts apps/web/test/oauth-config.test.ts
git commit -m "feat(connections): per-provider OAuth config (getOAuthConfigFor)"
```

---

## Task 3: Shared callback core + dynamic `[provider]` route

**Files:**
- Create: `apps/web/lib/connections/callback-core.ts`
- Create: `apps/web/app/api/connect/[provider]/callback/route.ts`
- Modify: `apps/web/app/api/connect/google/callback/route.ts`
- Modify: `apps/web/test/connect-callback.test.ts` (import path)
- Test: `apps/web/test/dynamic-callback.test.ts` (new)

**Interfaces:**
- Consumes: `getOAuthConfigFor` (Task 2); `completeConnection` (`lib/connections/complete.ts`), `consumePending` / `PendingAuth` (`lib/connections/pending.ts`), `exchangeCode` (`@nibbin/connectors`), `connection_token_store` RPC.
- Produces: `handleConnectionCallback(request: NextRequest, opts: { expectedProvider?: string; postConnect?: (svc, pending, connectionId) => Promise<void> }): Promise<Response>`. Used by both routes.
- Produces: `makeCreateActiveConnection(svc)` and `exchangeViaEngine(pending, code, overrides?)` — **moved here** from the Gmail route (re-exported from the Gmail route for the existing test, or the test import is updated).
- Produces: `writeGrantSpecFor(provider): { capability: string; reason: string } | null` — provider-aware write-grant copy.

- [ ] **Step 1: Write the failing test for provider-allowlist rejection**

Create `apps/web/test/dynamic-callback.test.ts`:

```typescript
import { expect, it, describe } from 'vitest';
import { isWiredProvider } from '../lib/connections/callback-core';

describe('dynamic callback provider guard', () => {
  it('accepts a wired provider', () => {
    expect(isWiredProvider('google-calendar')).toBe(true);
  });
  it('rejects an unknown or un-wired provider', () => {
    expect(isWiredProvider('definitely-not-a-provider')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/dynamic-callback.test.ts`
Expected: FAIL — `callback-core` does not exist.

- [ ] **Step 3: Create `callback-core.ts`**

Create `apps/web/lib/connections/callback-core.ts`. Move `exchangeViaEngine` and `makeCreateActiveConnection` here from the Gmail route (verbatim bodies from `apps/web/app/api/connect/google/callback/route.ts:17-100`), changing `exchangeViaEngine` to use `getOAuthConfigFor(pending.provider)` instead of `getGoogleOAuthConfig()`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exchangeCode, type StoredToken, type UnsafeTestOverrides } from '@nibbin/connectors';
import { serviceClient } from '../supabase/service';
import { getOAuthConfigFor } from './oauth-config';
import { consumePending, type PendingAuth } from './pending';
import { completeConnection } from './complete';
import { adoptTemplate } from '../runtime/adopt';
import { createWriteGrant } from './grants';
import { CONNECTABLE_PROVIDERS } from './providers';

export function isWiredProvider(provider: string): boolean {
  return CONNECTABLE_PROVIDERS.some((p) => p.id === provider && p.wired);
}

/** Per-provider write-grant copy + capability for the per-Nibbin write upgrade.
 *  Returns null for providers with no write capability wired yet. */
export function writeGrantSpecFor(provider: string): { capability: string; reason: string } | null {
  switch (provider) {
    case 'gmail':
      return { capability: 'email.draft', reason: 'Maya will create a Gmail draft for your review.' };
    case 'google-calendar':
      return { capability: 'calendar.event-create', reason: 'Your Nibbin will add calendar events you approve.' };
    default:
      return null;
  }
}

export async function exchangeViaEngine(
  pending: PendingAuth,
  code: string,
  overrides?: UnsafeTestOverrides,
): Promise<StoredToken> {
  const cfg = getOAuthConfigFor(pending.provider);
  return exchangeCode(
    {
      provider: pending.provider,
      code,
      redirectUri: cfg.redirectUri,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      codeVerifier: pending.codeVerifier,
      expectedState: pending.state,
      returnedState: pending.state,
      requestedScopes: pending.scopes,
    },
    overrides,
  );
}

export function makeCreateActiveConnection(svc: SupabaseClient) {
  // ... move the verbatim body from the Gmail route (route.ts:48-100) here unchanged ...
}

export interface CallbackOpts {
  expectedProvider?: string; // dynamic route passes the [provider] segment to assert against pending.provider
  postConnect?: (svc: SupabaseClient, pending: PendingAuth, connectionId: string) => Promise<void>;
}

export async function handleConnectionCallback(request: NextRequest, opts: CallbackOpts = {}): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError || !code || !state) {
    return NextResponse.redirect(new URL('/app/connections?error=declined', request.url));
  }

  const svc = serviceClient();
  let createdConnectionId: string | null = null;
  let createdPending: PendingAuth | null = null;

  const { redirectTo } = await completeConnection(
    { code, returnedState: state, nowMs: Date.now() },
    {
      consume: async (s, now) => {
        const p = await consumePending(s, now, svc);
        // Guard: the pending row's provider must match the route it was redeemed on.
        if (p && opts.expectedProvider && p.provider !== opts.expectedProvider) return null;
        if (p) createdPending = p;
        return p;
      },
      exchange: (pending, c) => exchangeViaEngine(pending, c),
      createActiveConnection: async (pending, token) => {
        const id = await makeCreateActiveConnection(svc)(pending, token);
        createdConnectionId = id;
        return id;
      },
      resumeAdopt: async (pending, templateKey) => {
        const r = await adoptTemplate(pending.accountId, pending.userId, templateKey);
        return { ok: r.missingConnectors.length === 0, missing: r.missingConnectors };
      },
      createWriteGrant: async (pending, connectionId) => {
        if (!pending.nibbinId) return;
        const spec = writeGrantSpecFor(pending.provider);
        if (!spec) return;
        await createWriteGrant(
          {
            accountId: pending.accountId,
            nibbinId: pending.nibbinId,
            connectionId,
            capability: spec.capability,
            grantedBy: pending.userId,
            plainLanguageReason: spec.reason,
          },
          svc,
        );
      },
    },
  );

  if (createdConnectionId && opts.postConnect && createdPending) {
    await opts.postConnect(svc, createdPending, createdConnectionId);
  }

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
```

- [ ] **Step 4: Run the guard test to verify it passes**

Run: `npx vitest run apps/web/test/dynamic-callback.test.ts`
Expected: PASS.

- [ ] **Step 5: Slim the Gmail route to delegate**

Replace `apps/web/app/api/connect/google/callback/route.ts` with a thin delegate that preserves the Gmail-only sweep dispatch:

```typescript
import { type NextRequest } from 'next/server';
import { handleConnectionCallback, makeCreateActiveConnection, exchangeViaEngine } from '../../../../../lib/connections/callback-core';
import { siteOrigin } from '../../../../../lib/site-url';
import { onGmailConnected } from '../../../../../lib/sweep/dispatch';

export const dynamic = 'force-dynamic';

// Re-export for the existing unit test import path.
export { makeCreateActiveConnection, exchangeViaEngine };

export async function GET(request: NextRequest): Promise<Response> {
  return handleConnectionCallback(request, {
    // Gmail's pending.provider is 'gmail' though the path segment is 'google'; no expectedProvider guard here.
    postConnect: async (svc, pending, connectionId) => {
      await onGmailConnected(svc, siteOrigin(), connectionId, pending.sweepConsent ?? false, pending.userId);
    },
  });
}
```

- [ ] **Step 6: Create the dynamic route**

Create `apps/web/app/api/connect/[provider]/callback/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { handleConnectionCallback, isWiredProvider } from '../../../../../lib/connections/callback-core';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  // 'google' is the Gmail legacy path and has its own dedicated route; a wired
  // provider id (e.g. 'google-calendar') is required here.
  if (provider === 'google' || !isWiredProvider(provider)) {
    return NextResponse.redirect(new URL('/app/connections?error=unavailable', request.url));
  }
  return handleConnectionCallback(request, { expectedProvider: provider });
}
```

- [ ] **Step 7: Update the existing test import**

In `apps/web/test/connect-callback.test.ts` line 2, the import of `makeCreateActiveConnection` still resolves via the Gmail route's re-export (Step 5), so no change is required. Verify by running it:

Run: `npx vitest run apps/web/test/connect-callback.test.ts`
Expected: PASS (the re-export keeps the import path valid).

- [ ] **Step 8: Run typecheck + the callback tests**

Run: `npm run typecheck && npx vitest run apps/web/test/connect-callback.test.ts apps/web/test/dynamic-callback.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/connections/callback-core.ts apps/web/app/api/connect/
git commit -m "feat(connections): shared callback core + dynamic [provider] callback route"
```

---

## Task 4: Generalize the initiate action to per-provider config

**Files:**
- Modify: the server action that calls `beginConnect` (find via `grep -rn "beginConnect\|getGoogleOAuthConfig" apps/web/app`) — per the extraction, `apps/web/app/app/connections/actions.ts`.
- Test: `apps/web/test/begin-connect.test.ts` (new or extend existing begin test)

**Interfaces:**
- Consumes: `getOAuthConfigFor` (Task 2), `beginConnect` (`lib/connections/begin.ts`).
- Behavior change: the authorize URL's `redirect_uri` becomes per-provider (`/api/connect/<callbackPath>/callback`), matching the callback route the code will land on.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/begin-connect.test.ts`:

```typescript
import { expect, it, describe, beforeEach } from 'vitest';
import { beginConnect } from '../lib/connections/begin';
import { getOAuthConfigFor } from '../lib/connections/oauth-config';

describe('beginConnect per-provider redirect', () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'gsecret';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://nibbin.com';
  });

  it('builds the Google Calendar authorize URL with the calendar callback redirect_uri', async () => {
    const saved: unknown[] = [];
    const { url } = await beginConnect(
      { provider: 'google-calendar', accountId: 'a', userId: 'u', userEmail: 'x@y.z' },
      {
        config: getOAuthConfigFor('google-calendar'),
        allowlistFor: async () => ({ emails: ['x@y.z'] }) as never,
        save: async (i) => { saved.push(i); },
        nowMs: 1_700_000_000_000,
      },
    );
    expect(url).toContain(encodeURIComponent('https://nibbin.com/api/connect/google-calendar/callback'));
    expect((saved[0] as { provider: string }).provider).toBe('google-calendar');
    // read-only scope at connect (C8)
    expect(url).toContain(encodeURIComponent('calendar.readonly'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/begin-connect.test.ts`
Expected: FAIL — the action still passes the Gmail config, so the redirect_uri is the `/google/` path (or the scope assertion fails if the registry read scope differs).

First confirm the registry read scope for `google-calendar` is `calendar.readonly`: `grep -n "calendar.readonly\|google-calendar" packages/connectors/src/registry/registry.ts`. If it is not present in `scopes.read`, fix the registry descriptor's `scopes.read` to `['https://www.googleapis.com/auth/calendar.readonly']` as part of this step.

- [ ] **Step 3: Pass per-provider config in the action**

In `apps/web/app/app/connections/actions.ts`, change the `beginConnect` call site to build config from the requested provider:

```typescript
import { getOAuthConfigFor } from '../../../lib/connections/oauth-config';
// ...
const { url } = await beginConnect(
  { provider, accountId, userId, userEmail, returnTo, resumeTemplate, sweepConsent },
  {
    config: getOAuthConfigFor(provider),
    allowlistFor,
    save: (i) => storePending(i),
    nowMs: Date.now(),
  },
);
```

(Preserve the existing `allowlistFor` / `storePending` wiring already in the file; only the `config` source changes from `getGoogleOAuthConfig()` to `getOAuthConfigFor(provider)`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run apps/web/test/begin-connect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/app/connections/actions.ts apps/web/test/begin-connect.test.ts packages/connectors/src/registry/registry.ts
git commit -m "feat(connections): per-provider redirect_uri on connect initiate"
```

---

## Task 5: Flip the wiring flags + catalog status

**Files:**
- Modify: `apps/web/lib/connections/providers.ts:1-11`
- Modify: `apps/web/lib/connections/catalog.ts` (`google-calendar` entry)
- Test: `apps/web/test/catalog-live.test.ts` (new)

**Interfaces:**
- Behavior: `google-calendar` becomes `wired: true` (interactive connect) and `live` in the user-facing catalog.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/catalog-live.test.ts`:

```typescript
import { expect, it, describe } from 'vitest';
import { CONNECTABLE_PROVIDERS } from '../lib/connections/providers';
import { CONNECTOR_CATALOG } from '../lib/connections/catalog'; // adjust to the real export name

describe('google-calendar is lit up', () => {
  it('is wired in CONNECTABLE_PROVIDERS', () => {
    expect(CONNECTABLE_PROVIDERS.find((p) => p.id === 'google-calendar')?.wired).toBe(true);
  });
  it('shows live in the user-facing catalog', () => {
    const entry = CONNECTOR_CATALOG.flatMap((c) => c.connectors ?? c.items ?? []).find((x) => x.id === 'google-calendar');
    expect(entry?.status).toBe('live');
  });
});
```

(Adjust `CONNECTOR_CATALOG` / `.connectors` / `.status` to the catalog's actual export and field names — confirm with `grep -n "google-calendar\|status\|coming_soon\|live" apps/web/lib/connections/catalog.ts`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/catalog-live.test.ts`
Expected: FAIL — currently `wired: false` and `coming_soon`.

- [ ] **Step 3: Flip the flags**

- `apps/web/lib/connections/providers.ts`: change the `google-calendar` line to `{ id: 'google-calendar', label: 'Google Calendar', wired: true },`.
- `apps/web/lib/connections/catalog.ts`: change the `google-calendar` entry's status from `coming_soon` to `live`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run apps/web/test/catalog-live.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/connections/providers.ts apps/web/lib/connections/catalog.ts apps/web/test/catalog-live.test.ts
git commit -m "feat(connections): light up Google Calendar (wired + catalog live)"
```

---

## Task 6: Calendar incremental sync in the cron poll

**Files:**
- Modify: `packages/connectors/src/connectors/google-calendar.ts` (add `listEventsSync`)
- Create: `packages/connectors/src/connectors/calendar-delta.ts`
- Modify: `apps/web/app/api/cron/connector-poll/route.ts:57-78`
- Test: `packages/connectors/test/calendar-delta.test.ts` (new)

**Interfaces:**
- Produces: `GoogleCalendarClient.listEventsSync(calendarId: string, syncToken?: string, pageToken?: string): Promise<{ items?: CalendarEvent[]; nextSyncToken?: string; nextPageToken?: string }>`.
- Produces: `fetchCalendarDelta(connectionId, accountId, webhookState, deps): Promise<{ events: DispatchEvent[]; newSyncToken: string }>` — mirrors `fetchGmailDelta`. On first run (no `syncToken` in `webhookState`) it performs an initial sync to establish the baseline token and emits no events.

- [ ] **Step 1: Write the failing test for the delta**

Create `packages/connectors/test/calendar-delta.test.ts`:

```typescript
import { expect, it, describe } from 'vitest';
import { fetchCalendarDelta } from '../src/connectors/calendar-delta';

describe('fetchCalendarDelta', () => {
  it('bootstraps a sync token on first run and emits no events', async () => {
    const r = await fetchCalendarDelta('c1', 'a1', {}, {
      listSync: async () => ({ items: [{ id: 'e1' }], nextSyncToken: 'tok1' }),
    });
    expect(r.newSyncToken).toBe('tok1');
    expect(r.events).toHaveLength(0);
  });

  it('emits events for changes on a subsequent run', async () => {
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'tok1' }, {
      listSync: async () => ({ items: [{ id: 'e2', status: 'confirmed' }], nextSyncToken: 'tok2' }),
    });
    expect(r.newSyncToken).toBe('tok2');
    expect(r.events.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/connectors/test/calendar-delta.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Add the sync method to the client**

In `packages/connectors/src/connectors/google-calendar.ts`, add:

```typescript
  /** Incremental sync via Google's nextSyncToken (poll-friendly; no webhook). */
  async listEventsSync(
    calendarId: string,
    syncToken?: string,
    pageToken?: string,
  ): Promise<{ items?: CalendarEvent[]; nextSyncToken?: string; nextPageToken?: string }> {
    const params = new URLSearchParams({ singleEvents: 'true', maxResults: '250' });
    if (syncToken) params.set('syncToken', syncToken);
    if (pageToken) params.set('pageToken', pageToken);
    const { data } = await this.readJson<{ items?: CalendarEvent[]; nextSyncToken?: string; nextPageToken?: string }>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    );
    return data;
  }
```

- [ ] **Step 4: Implement `fetchCalendarDelta`**

Create `packages/connectors/src/connectors/calendar-delta.ts`:

```typescript
export interface CalendarDeltaDeps {
  /** Wraps GoogleCalendarClient.listEventsSync for 'primary'. */
  listSync: (syncToken?: string) => Promise<{ items?: Array<{ id?: string; status?: string }>; nextSyncToken?: string }>;
}

export interface CalendarDispatchEvent {
  connectionId: string;
  accountId: string;
  kind: 'calendar.changed';
  eventId: string;
}

export async function fetchCalendarDelta(
  connectionId: string,
  accountId: string,
  webhookState: Record<string, unknown>,
  deps: CalendarDeltaDeps,
): Promise<{ events: CalendarDispatchEvent[]; newSyncToken: string }> {
  const prior = typeof webhookState.calendarSyncToken === 'string' ? webhookState.calendarSyncToken : undefined;
  const res = await deps.listSync(prior);
  const newSyncToken = res.nextSyncToken ?? prior ?? '';
  // First run (no prior token) just establishes the baseline — emit nothing.
  if (!prior) return { events: [], newSyncToken };
  const events = (res.items ?? [])
    .filter((e) => e.id)
    .map((e) => ({ connectionId, accountId, kind: 'calendar.changed' as const, eventId: e.id as string }));
  return { events, newSyncToken };
}
```

Export it from `packages/connectors/src/index.ts` (mirror how `fetchGmailDelta` is exported — `grep -n "fetchGmailDelta" packages/connectors/src/index.ts`).

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/connectors/test/calendar-delta.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the poll route**

In `apps/web/app/api/cron/connector-poll/route.ts`, replace the `if (connection.provider !== 'gmail') continue;` block (line ~59) with a provider switch that keeps Gmail's existing path and adds calendar. After the calendar delta, persist `newSyncToken` into `webhookState` and dispatch each event through the SAME path Gmail's events use (find how `events`/`newHistoryId` are persisted + dispatched below the extracted block and mirror it):

```typescript
    if (connection.provider === 'gmail') {
      // ... existing GmailClient + fetchGmailDelta block, unchanged ...
    } else if (connection.provider === 'google-calendar') {
      const client = new GoogleCalendarClient(connection, vault);
      const { events, newSyncToken } = await fetchCalendarDelta(
        connection.id,
        connection.accountId,
        connection.webhookState,
        { listSync: (syncToken) => client.listEventsSync('primary', syncToken).then((r) => ({ items: r.items, nextSyncToken: r.nextSyncToken })) },
      );
      // persist sync token + dispatch `events` using the same persistence/dispatch
      // the Gmail branch uses for newHistoryId/events (mirror lines below the gmail block)
    } else {
      continue;
    }
```

Add the `GoogleCalendarClient` and `fetchCalendarDelta` imports from `@nibbin/connectors` at the top of the route.

- [ ] **Step 7: Run typecheck + connectors tests**

Run: `npm run typecheck && npx vitest run packages/connectors`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/connectors/src/connectors/ packages/connectors/src/index.ts packages/connectors/test/calendar-delta.test.ts apps/web/app/api/cron/connector-poll/route.ts
git commit -m "feat(connectors): Google Calendar incremental sync in the connector poll"
```

---

## Task 7: Calendar findings guard test (engine already generic)

**Files:**
- Test: `packages/scan/test/calendar-findings.test.ts` (new)

**Interfaces:**
- Consumes: `modulesForProvider` (`packages/scan/src/engine.ts:60`), `CALENDAR_MODULES`, `CONNECTOR_REGISTRY`.
- Purpose: lock in that an active `google-calendar` connection resolves its three calendar modules — guards against future registry/engine drift. No production code changes.

- [ ] **Step 1: Write the test**

Create `packages/scan/test/calendar-findings.test.ts`:

```typescript
import { expect, it, describe } from 'vitest';
import { modulesForProvider } from '../src/engine';

describe('google-calendar scan wiring', () => {
  it('resolves the three calendar modules for the provider', () => {
    const ids = modulesForProvider('google-calendar').map((m) => m.id).sort();
    expect(ids).toEqual(['calendar.confirmation-gaps', 'calendar.meeting-load', 'calendar.no-show-churn']);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run packages/scan/test/calendar-findings.test.ts`
Expected: PASS immediately (engine + registry already support this). If it FAILS, the registry's `scanModules` for `google-calendar` is out of sync with the module ids — fix the registry descriptor to list all three ids.

- [ ] **Step 3: Commit**

```bash
git add packages/scan/test/calendar-findings.test.ts
git commit -m "test(scan): lock google-calendar → calendar modules resolution"
```

---

## Task 8: Front-end error states

**Files:**
- Modify: the connections page that reads `searchParams.error` — find via `grep -rn "searchParams\|error=\|?error\|connected=" apps/web/app/app/connections`.
- Create/Modify: a small `ConnectionError` presentational component if one does not already exist.
- Test: `apps/web/test/connection-error-copy.test.ts` (new)

**Interfaces:**
- Consumes: the `?error=<code>` query the callbacks redirect to. Codes emitted by the flow: `declined`, `exchange_failed`, `expired` / `invalid_state`, `save_failed`, `unavailable`, plus the existing tester-allowlist state.
- Produces: `connectionErrorMessage(code: string): { title: string; body: string; action: 'retry' | 'restart' | 'none' }` — pure mapping, unit-testable.

- [ ] **Step 1: Confirm the error codes the flow emits**

`completeConnection` returns `error: 'exchange_failed'` (extraction §1); the callbacks emit `declined` and `unavailable`. For `expired`/`invalid_state` and `save_failed`, the current code funnels a missing/expired pending into `exchange_failed`/`declined`. Add explicit codes: in `callback-core.ts`, when `consumePending` returns null due to expiry/mismatch, redirect to `/app/connections?error=expired`; wrap the vault/insert in a try/catch that redirects to `?error=save_failed`. (Make these edits in `handleConnectionCallback` — they are small additions to Task 3's file; if Task 3 is already merged, this is a follow-up edit committed here.)

- [ ] **Step 2: Write the failing test for the copy map**

Create `apps/web/test/connection-error-copy.test.ts`:

```typescript
import { expect, it, describe } from 'vitest';
import { connectionErrorMessage } from '../app/app/connections/connection-error';

describe('connectionErrorMessage', () => {
  it('declined → retry', () => {
    expect(connectionErrorMessage('declined').action).toBe('retry');
    expect(connectionErrorMessage('declined').title).toMatch(/didn.t finish/i);
  });
  it('expired → restart', () => {
    expect(connectionErrorMessage('expired').action).toBe('restart');
  });
  it('save_failed → retry, generic body, no raw error', () => {
    const m = connectionErrorMessage('save_failed');
    expect(m.action).toBe('retry');
    expect(m.body).not.toMatch(/stack|token|undefined/i);
  });
  it('unknown code → safe generic', () => {
    expect(connectionErrorMessage('xyz').action).toBe('none');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run apps/web/test/connection-error-copy.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement the copy map**

Create `apps/web/app/app/connections/connection-error.ts`:

```typescript
export interface ConnectionErrorView {
  title: string;
  body: string;
  action: 'retry' | 'restart' | 'none';
}

export function connectionErrorMessage(code: string): ConnectionErrorView {
  switch (code) {
    case 'declined':
      return { title: "You didn't finish connecting", body: 'The connection was cancelled before it completed. You can try again whenever you’re ready.', action: 'retry' };
    case 'expired':
    case 'invalid_state':
      return { title: 'That connection link expired', body: 'For your security, connection links are single-use and time-limited. Please start the connection again.', action: 'restart' };
    case 'exchange_failed':
      return { title: 'We couldn’t complete the connection', body: 'The provider didn’t accept the sign-in. Please try connecting again.', action: 'retry' };
    case 'save_failed':
      return { title: 'Something went wrong on our end', body: 'We couldn’t finish saving your connection. Please try again in a moment.', action: 'retry' };
    case 'unavailable':
      return { title: 'That connection isn’t available yet', body: 'This connector isn’t ready to connect. Check back soon.', action: 'none' };
    default:
      return { title: 'We couldn’t complete the connection', body: 'Please try again. If it keeps happening, reach out and we’ll help.', action: 'none' };
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run apps/web/test/connection-error-copy.test.ts`
Expected: PASS.

- [ ] **Step 6: Render the error state on the connections page**

In the connections page component, read `searchParams.error`, and when present render the `connectionErrorMessage(code)` title/body plus the action affordance (`retry` → a "Try again" connect button for the relevant provider; `restart` → same; `none` → dismiss only). Follow the page's existing card/banner styling — do not introduce a new visual primitive. Keep the raw code out of the visible copy.

- [ ] **Step 7: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/app/connections/ apps/web/lib/connections/callback-core.ts apps/web/test/connection-error-copy.test.ts
git commit -m "feat(connections): human-actionable front-end error states for connect failures"
```

---

## Task 9: Full verification + adversarial gate + PR

**Files:** none (process task).

- [ ] **Step 1: Full local verification**

Run, in order, and confirm all green:
```bash
npm run lint
npm run typecheck
npx vitest run
npm run build
```
If any `@nibbin/*` "missing export" tsc errors appear, run a fresh `npm ci` and re-check — they are usually stale-workspace-dist false positives.

- [ ] **Step 2: Run the 4-reviewer adversarial gate**

Run the adversarial gate over the branch diff (red-team / claims-auditor / logic-skeptic / cost-auditor). Focus areas to call out for reviewers: the dynamic `[provider]` route injection guard (`isWiredProvider` + `expectedProvider` match), that tokens never appear in redirect URLs or logs, same-origin `returnTo`, and that the 12-month divisor change didn’t silently scale any other module’s dollar figures. Write the report to `docs/gates/2026-06-20-connector-lever1.md`. Fix any P1/P2 findings and re-run.

- [ ] **Step 3: Rebase + open the PR**

```bash
git fetch origin && git rebase origin/main
gh pr create --base main --title "Connector Lever 1: generic OAuth callback + Google Calendar + 12-month window" --body "<summary + the human prerequisite: add the google-calendar redirect URI to the Google OAuth app + set no new env (reuses GOOGLE_OAUTH_*)>"
```

- [ ] **Step 4: Confirm CI is green**

Wait for the 4 CI checks (lint / typecheck / test / build) + the adversarial-gate workflow. Address failures before requesting merge. Do NOT trust a fix-agent's "tests pass" — verify against CI output directly.

---

## Self-Review

**Spec coverage:**
- §3 generic callback (Approach 1) → Tasks 2, 3, 4. ✓
- §3 separate-connection model (B) → already in `makeCreateActiveConnection` (keyed on provider); preserved in Task 3. ✓
- §5 scope ladder (`calendar.readonly` connect, `calendar.events` per-Nibbin) → Task 4 (read scope at connect) + Task 3 `writeGrantSpecFor` (calendar capability). ✓
- §6 front-end error states → Task 8 (and the explicit `expired`/`save_failed` codes added there). ✓
- §7.1 12-month window unification + payments divisor → Task 1. ✓
- §7.2 calendar findings (derived-only) → Task 7 (engine already generic; guard test). ✓
- §7.3 liveness → **scope-revised with owner to "keep poll in scope"** → Task 6 (incremental sync via `nextSyncToken`; push `watch` still deferred). ✓
- §9 adversarial gate + invariants → Task 9. ✓
- Catalog/flag flips → Task 5. ✓

**Placeholder scan:** Two intentional "mirror the existing pattern" pointers remain (Task 3 Step 3 `makeCreateActiveConnection` body move; Task 6 Step 6 persistence/dispatch mirror) — these reference verbatim existing code the implementer copies, with exact source line ranges given, not invented behavior. No `TBD`/`add error handling`/undefined functions.

**Type consistency:** `getOAuthConfigFor` / `callbackPathFor` (Task 2) used identically in Tasks 3–4. `fetchCalendarDelta` signature (Task 6 Interfaces) matches its test and poll call. `connectionErrorMessage` codes (Task 8) match the codes the callbacks emit (`declined`/`exchange_failed`/`expired`/`save_failed`/`unavailable`). `SCAN_WINDOW_MONTHS` (Task 1) consumed by payments math and asserted in Task 7-adjacent tests.

**Open assumption to verify during execution (flagged, not guessed):** the exact export names/fields in `catalog.ts` (`CONNECTOR_CATALOG`, `.status`, `coming_soon`/`live`) and the precise persistence/dispatch lines below the Gmail block in `connector-poll/route.ts` — each task step says to confirm with a named `grep` before editing.
