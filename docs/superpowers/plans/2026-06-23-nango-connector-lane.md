# P4 — Nango Connector Lane: TDD Implementation Plan

**Date:** 2026-06-23
**Branch:** `feature/company-brain-nango` (worktree `C:\nib-p4`)
**Design spec:** `docs/superpowers/specs/2026-06-22-nango-connector-lane-design.md`
**Scope:** Gmail + Google Calendar only. Stripe deferred (no Stripe OAuth app yet — spec §P8).

> **For agentic workers:** Use `superpowers:subagent-driven-development`. Execute task-by-task. Do NOT skip to code before reading the full task brief. Commit after every green test run. `cd /c/nib-p4` before all commands.

---

## Goal

Move Gmail and Google Calendar from the hand-built `[H]` OAuth lane onto Nango's OAuth + token-lifecycle machinery while:

- preserving every public method signature on `GmailClient` and `GoogleCalendarClient` unchanged,
- preserving every safety invariant — C8 scope-at-connect, send-velocity caps, tester-allowlist gate, quarantine, egress allowlist re-check, action-level gate,
- leaving `McpRailClient` and all `[G]`/`[H]` (HoneyBook/Pixieset/Instagram-DM) connectors entirely untouched,
- shipping an adversarial gate report before merge.

---

## Architecture

```
[N] Nango lane (this plan)
  NangoConnectorClient  ─── nango.proxy() ──► Nango Cloud ──► Google APIs
    GmailClient (extends NangoConnectorClient)
    GoogleCalendarClient (extends NangoConnectorClient)

[H] Hand-built lane (UNCHANGED)
  HttpConnectorClient  ─── safeFetch ──► vault.read() ──► provider

[G] Generic MCP rail (UNCHANGED)
  McpRailClient
```

`ConnectorDescriptor.method` gains a fourth literal `'N'`. `ConnectorMethod` type broadens from `'A' | 'H' | 'G'` to `'A' | 'H' | 'G' | 'N'`. The registry validator is updated to accept `'N'`; the existing egress-allowlist check for `'A'/'H'` connectors applies to `'N'` too (non-empty allowlist required).

The Nango SDK (`@nangohq/node`) is a server-side-only dependency in `packages/connectors`. No Nango import ever reaches the browser.

Connect-action routing forks on `descriptor.method === 'N'` in `beginConnectAction`. The `[H]` path (`beginConnect`/`beginWriteConnect`) is unchanged.

---

## Global Constraints

1. **Public method signatures on `GmailClient` and `GoogleCalendarClient` are frozen.** Tests that call them must not change — only constructor injection changes.
2. **C8 scope-at-connect is preserved.** Nango integrations are configured with the same full scope lists as the registry descriptors. Scopes are read back from Nango at post-connect and written to `connections.scopes` exactly as before.
3. **Tester-allowlist gate is extracted, not removed.** `enforcePlatformGate` becomes a standalone exported function in `oauth/flow.ts`. The Nango connect action calls it directly — it is NOT removed just because `beginConnectAuthorization` is no longer reached for `[N]` providers.
4. **Egress allowlist re-checked in `NangoConnectorClient.request()` before every proxy call.** Nango proxy does not enforce our allowlist — the re-check is Nibbin-layer defense-in-depth.
5. **Quarantine wraps every proxy response** in `read()` and `readJson()` — identical pattern to `HttpConnectorClient`.
6. **Send-velocity caps run before the proxy call** in `GmailClient.sendMessage()`/`sendMessageDirect()` — unchanged.
7. **Vault rows for `[N]` connections are left null** (`access_token` not populated). Code paths that read the vault must gate on `descriptor.method !== 'N'` to skip vault reads. A vault-read audit is required at build time (Task 5).
8. **`nango.deleteConnection()` is called before row revoke** in the disconnect flow.
9. **MCP rail is untouched.** Do not import anything Nango-related into `rails/mcp.ts`.
10. **Migration applied to dev → staging → prod in the standard three-DB sequence.** Commits are named `migration(<seq>): ...`.
11. **Adversarial gate required.** The gate covers: token-custody change (Nango Cloud holds access tokens), auth-flow change (Nango OAuth, no state/PKCE in Nibbin code), egress-allowlist enforcement shift. Gate report → `docs/gates/2026-06-23-nango-connector-lane.md`.
12. **Straight quotes only in all TS/TSX.** `npm run lint` + `npm run typecheck` + `vitest run` must be green before each commit.
13. **Stripe is deferred.** No Stripe registry change, no Stripe client change.

---

## Preconditions (already done — reflect in task checks, not as build steps)

- Nango Cloud account is live.
- `google-mail` integration configured in Nango dev + prod environments on Google client `308171524847-…` with scopes `gmail.readonly`, `gmail.compose`, `gmail.send`, `openid`, `email`.
- `google-calendar` integration configured in Nango dev + prod environments on same Google client with scopes `calendar.readonly`, `calendar.events`, `openid`, `email`.
- Nango OAuth callback `https://api.nango.dev/oauth/callback` registered on that Google client and verified working.
- DPA with Nango executed (or explicitly accepted as a prereq before go-live).

---

## Env Variables (wire in this plan, never commit to repo)

| Variable | Scope | Value source |
|---|---|---|
| `NANGO_SECRET_KEY` | Server-side only | Nango dashboard → Environment keys → Secret key |
| `NANGO_PUBLIC_KEY` | Client-callable (Nango SDK `nango.auth()`) | Nango dashboard → Environment keys → Public key |
| `NANGO_HOST` | Optional — only for self-hosted | Nango self-hosted URL, default `https://api.nango.dev` |

Wire to: Vercel project env vars (dev/preview/prod) + local `.env.local` (listed in `.gitignore`). Never in the repo.

---

## Mock strategy for tests

All tasks below require a mock `Nango` instance. Define it once in `packages/connectors/test/helpers/mock-nango.ts`:

```ts
// Minimal Nango SDK shape for unit tests — only the methods NangoConnectorClient uses.
export function makeMockNango(overrides?: Partial<{
  proxyResponse: { status: number; data: unknown; headers?: Record<string, string> };
  deleteConnectionResult: void;
  getConnectionResult: { credentials: { raw: { scope: string } } };
}>): MockNango
```

Tests supply `makeMockNango({ proxyResponse: { status: 200, data: {...} } })` and never hit the network.

Vitest test command for all connector tests:

```bash
cd /c/nib-p4
npx vitest run packages/connectors
```

For web tests:

```bash
npx vitest run apps/web
```

---

## Task List

---

### Task 0 — Env smoke-test + package installation

**Files touched:**
- `packages/connectors/package.json`
- `packages/connectors/src/nango-client.ts` (new, thin re-export)

**Purpose:** Add `@nangohq/node` to the connectors package and confirm the SDK can instantiate against the live Nango Cloud account. This is the only task that requires live env — everything else uses the mock.

**TDD steps:**

1. Write `packages/connectors/test/nango-smoke.test.ts` (skipped unless `NANGO_SECRET_KEY` is set in env):
   ```ts
   import { describe, it, expect } from 'vitest';
   const skip = !process.env.NANGO_SECRET_KEY;
   describe.skipIf(skip)('Nango SDK smoke', () => {
     it('instantiates without throwing', async () => {
       const { Nango } = await import('@nangohq/node');
       const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
       expect(nango).toBeTruthy();
     });
   });
   ```
2. Run `npx vitest run packages/connectors/test/nango-smoke.test.ts` — expect SKIPPED (no key in CI).
3. Add `"@nangohq/node": "^0.43.7"` (pin to current stable) to `packages/connectors/package.json` dependencies.
4. Create `packages/connectors/src/nango-client.ts`:
   ```ts
   // Single import point for the Nango SDK within this package.
   // Never import @nangohq/node directly elsewhere.
   export { Nango } from '@nangohq/node';
   export type { ProxyConfiguration } from '@nangohq/node';
   ```
5. Run `npm install` from the monorepo root. Verify `@nangohq/node` appears in `node_modules`.
6. `npx vitest run packages/connectors` — all existing tests green (smoke test skipped).

**Commit:** `feat(connectors): add @nangohq/node dependency (P4 nango lane)`

---

### Task 1 — Extend `ConnectorMethod` type and update `validateDescriptor`

**Files touched:**
- `packages/connectors/src/registry/types.ts`
- `packages/connectors/test/registry.test.ts` (existing — extend, do not replace)

**Purpose:** `ConnectorDescriptor.method` must accept `'N'`. The validator must enforce the same egress-allowlist rule for `'N'` as for `'A'/'H'`.

**TDD steps:**

1. Open `packages/connectors/test/registry.test.ts`. Add a failing test:
   ```ts
   it('accepts method N with a non-empty egress allowlist', () => {
     const d: ConnectorDescriptor = {
       id: 'test-nango',
       label: 'Test Nango',
       tier: 1,
       method: 'N',
       scopes: { read: ['some.scope'], write: [] },
       webhooks: { supported: false },
       rateLimit: { requests: 60, perSeconds: 60 },
       scanModules: [],
       capabilities: [],
       egressAllowlist: ['api.example.com'],
       availability: 'live',
     };
     expect(validateDescriptor(d)).toEqual([]);
   });

   it('rejects method N with empty egress allowlist', () => {
     const d = { ...validNDescriptor, egressAllowlist: [] };
     expect(validateDescriptor(d)).toContain(expect.stringContaining('egress allowlist'));
   });
   ```
2. Run `npx vitest run packages/connectors/test/registry.test.ts` — RED (type error + logic miss).
3. In `packages/connectors/src/registry/types.ts`:
   - Change `export type ConnectorMethod = 'A' | 'H' | 'G';` → `'A' | 'H' | 'G' | 'N';`
   - In `validateDescriptor`, the existing branch `if (!['A', 'H', 'G'].includes(d.method))` → `if (!['A', 'H', 'G', 'N'].includes(d.method))`
   - Extend the egress-allowlist block: `if (d.method === 'G') { /* empty required */ } else { /* A/H/N: non-empty required */ }`
4. Run tests — GREEN.
5. `npm run typecheck` — green.

**Commit:** `feat(connectors/registry): add method N to ConnectorMethod + validateDescriptor`

---

### Task 2 — `NangoConnectorClient` base class

**Files touched:**
- `packages/connectors/src/connectors/nango-base.ts` (new)
- `packages/connectors/test/helpers/mock-nango.ts` (new)
- `packages/connectors/test/nango-base.test.ts` (new)

**Purpose:** Implement the `[N]`-lane equivalent of `HttpConnectorClient`. Uses `nango.proxy()` instead of `safeFetch + vault.read`. Re-checks egress allowlist before every proxy call. Wraps proxy response in quarantine.

**Mock shape to build first** (`test/helpers/mock-nango.ts`):

```ts
import type { Nango } from '../../src/nango-client';

interface MockNangoOpts {
  proxyStatus?: number;          // default 200
  proxyData?: unknown;           // parsed JSON response body
  proxyHeaders?: Record<string, string>;
  getConnectionScopes?: string;  // e.g. 'https://www.googleapis.com/auth/gmail.readonly'
  deleteConnectionShouldThrow?: boolean;
}

export function makeMockNango(opts: MockNangoOpts = {}): Nango {
  return {
    proxy: vi.fn().mockResolvedValue({
      status: opts.proxyStatus ?? 200,
      data: opts.proxyData ?? {},
      headers: opts.proxyHeaders ?? {},
      // text() helper used by NangoConnectorClient.read()
    }),
    getConnection: vi.fn().mockResolvedValue({
      credentials: { raw: { scope: opts.getConnectionScopes ?? '' } },
    }),
    deleteConnection: opts.deleteConnectionShouldThrow
      ? vi.fn().mockRejectedValue(new Error('delete failed'))
      : vi.fn().mockResolvedValue(undefined),
  } as unknown as Nango;
}
```

**TDD steps:**

1. Write `packages/connectors/test/nango-base.test.ts` with the following failing tests (run before writing the implementation):

   a. **Active-connection guard:**
   ```ts
   it('throws connection-state error when connection is revoked', async () => {
     const conn = makeConnection({ status: 'revoked', provider: 'gmail' });
     const client = new NangoConnectorClient(conn, makeMockNango(), 'gmail', 'nango-conn-id-1');
     await expect(client.read('/test')).rejects.toMatchObject({ kind: 'connection-state' });
   });
   ```

   b. **Egress allowlist re-check:**
   ```ts
   it('throws before proxy call when path host is outside allowlist', async () => {
     // gmail descriptor allowlist does not include 'evil.com'
     const conn = makeConnection({ status: 'active', provider: 'gmail' });
     const mock = makeMockNango();
     const client = new NangoConnectorClient(conn, mock, 'gmail', 'nango-conn-id-1');
     // The base URL for gmail is 'https://gmail.googleapis.com' — allowlist passes.
     // Simulate an out-of-band host injection attempt by spying:
     await expect(
       // @ts-expect-error: testing internals
       client['assertEgress']('evil.com')
     ).rejects.toThrow('outside its egress allowlist');
     expect(mock.proxy).not.toHaveBeenCalled();
   });
   ```

   c. **401 from proxy → ConnectorRequestError 'auth':**
   ```ts
   it('throws auth error on proxy 401', async () => {
     const conn = makeConnection({ status: 'active', provider: 'gmail' });
     const mock = makeMockNango({ proxyStatus: 401 });
     const client = new NangoConnectorClient(conn, mock, 'gmail', 'nango-conn-id-1');
     await expect(client.read('/gmail/v1/users/me/profile')).rejects.toMatchObject({
       kind: 'auth',
       status: 401,
     });
   });
   ```

   d. **429 → ConnectorRequestError 'rate-limit':**
   ```ts
   it('throws rate-limit error on proxy 429', async () => {
     const conn = makeConnection({ status: 'active', provider: 'gmail' });
     const mock = makeMockNango({ proxyStatus: 429 });
     const client = new NangoConnectorClient(conn, mock, 'gmail', 'nango-conn-id-1');
     await expect(client.read('/gmail/v1/users/me/profile')).rejects.toMatchObject({
       kind: 'rate-limit',
     });
   });
   ```

   e. **Successful read() returns QuarantinedContent:**
   ```ts
   it('returns quarantined content on successful proxy response', async () => {
     const conn = makeConnection({ status: 'active', provider: 'gmail' });
     const mock = makeMockNango({ proxyStatus: 200, proxyData: { emailAddress: 'user@example.com' } });
     const client = new NangoConnectorClient(conn, mock, 'gmail', 'nango-conn-id-1');
     const result = await client.read('/gmail/v1/users/me/profile');
     expect(result.label).toContain('gmail:');
     expect(result.content).toContain('emailAddress');
   });
   ```

   f. **readJson() returns parsed data AND QuarantinedContent:**
   ```ts
   it('readJson returns parsed data and quarantine wrapper', async () => {
     const conn = makeConnection({ status: 'active', provider: 'gmail' });
     const mock = makeMockNango({ proxyStatus: 200, proxyData: { historyId: '12345' } });
     const client = new NangoConnectorClient(conn, mock, 'gmail', 'nango-conn-id-1');
     // @ts-expect-error: testing protected method
     const { data, quarantined } = await client['readJson']('/gmail/v1/users/me/profile');
     expect(data.historyId).toBe('12345');
     expect(quarantined.label).toContain('gmail:');
   });
   ```

2. Run `npx vitest run packages/connectors/test/nango-base.test.ts` — all RED (file does not exist).

3. Implement `packages/connectors/src/connectors/nango-base.ts`:

   ```ts
   import { getConnector } from '../registry/registry';
   import type { ConnectorDescriptor } from '../registry/types';
   import { quarantine, type QuarantinedContent } from '../quarantine';
   import type { Nango } from '../nango-client';
   import type { Connection, ConnectorClient } from '../types';
   import { ConnectorRequestError } from './base';

   function hostMatches(host: string, pattern: string): boolean {
     const h = host.toLowerCase();
     const p = pattern.toLowerCase();
     if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1));
     return h === p;
   }

   export class NangoConnectorClient implements ConnectorClient {
     readonly descriptor: ConnectorDescriptor;

     constructor(
       readonly connection: Connection,
       private readonly nango: Nango,
       private readonly providerConfigKey: string,
       private readonly nangoConnectionId: string,
     ) {
       this.descriptor = getConnector(connection.provider);
     }

     get provider(): string {
       return this.connection.provider;
     }

     /** Re-check target hostname against descriptor.egressAllowlist before proxy. */
     private assertEgress(targetHost: string): void {
       if (!this.descriptor.egressAllowlist.some((p) => hostMatches(targetHost, p))) {
         throw new ConnectorRequestError(
           this.provider, 0, 'connection-state',
           // Abuse connection-state kind for egress — or introduce a new kind 'egress'.
           // Design choice: introduce 'egress' as a new kind value (see Task 2 note below).
         );
       }
     }

     protected async request(
       path: string,
       init: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
     ): Promise<{ status: number; json(): unknown; text(): string }> {
       if (this.connection.status !== 'active') {
         throw new ConnectorRequestError(this.provider, 0, 'connection-state');
       }
       // Resolve the target host from the path.
       // Paths are relative to the provider's API base — the first path segment
       // determines the host from the descriptor allowlist (first entry is canonical base).
       // For allowlist enforcement we derive the host from the full URL if absolute,
       // or trust the connector's declared allowlist canonical host otherwise.
       const targetHost = path.startsWith('https://')
         ? new URL(path).hostname
         : this.descriptor.egressAllowlist[0] ?? '';
       this.assertEgress(targetHost);

       const proxyConfig = {
         providerConfigKey: this.providerConfigKey,
         connectionId: this.nangoConnectionId,
         endpoint: path,
         method: (init.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
         headers: init.headers,
         data: init.body ? JSON.parse(init.body) as unknown : undefined,
         responseType: 'json' as const,
       };

       const res = await this.nango.proxy(proxyConfig);

       if (res.status === 401 || res.status === 403) {
         throw new ConnectorRequestError(this.provider, res.status, 'auth');
       }
       if (res.status === 429) {
         throw new ConnectorRequestError(this.provider, res.status, 'rate-limit');
       }
       if (res.status >= 400) {
         throw new ConnectorRequestError(this.provider, res.status, 'provider');
       }

       const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
       return {
         status: res.status,
         json: () => res.data as unknown,
         text: () => raw,
       };
     }

     async read(path: string): Promise<QuarantinedContent> {
       const res = await this.request(path);
       return quarantine(res.text(), `${this.provider}:${this.connection.id}:${path.split('?')[0]}`);
     }

     protected async readJson<T>(path: string, signal?: AbortSignal): Promise<{ data: T; quarantined: QuarantinedContent }> {
       const res = await this.request(path, { signal });
       const text = res.text();
       return {
         data: res.json() as T,
         quarantined: quarantine(text, `${this.provider}:${this.connection.id}:${path.split('?')[0]}`),
       };
     }
   }
   ```

   **Note on `assertEgress`:** `ConnectorRequestError` currently takes `kind: 'auth' | 'rate-limit' | 'provider' | 'connection-state'`. Add `'egress'` to the union in `base.ts` so egress violations have their own kind. Update the existing test for `ConnectorRequestError` to cover `'egress'`.

4. Run `npx vitest run packages/connectors/test/nango-base.test.ts` — GREEN.
5. `npm run typecheck` — green.

**Commit:** `feat(connectors): NangoConnectorClient base class with egress re-check + quarantine`

---

### Task 3 — Migration: add `nango_connection_id` + `nango_provider_config_key` to `connections`

**Files touched:**
- `supabase/migrations/<next_seq>_nango_connection_cols.sql` (new)

**Purpose:** The `connections` table needs two nullable text columns to store Nango's opaque identifiers. Backfill is nulls — existing `[H]` rows are unaffected.

**TDD steps (migration file is the artifact; SQL is the test):**

1. Determine the next migration sequence number:
   ```bash
   ls /c/nib-p4/supabase/migrations/ | tail -5
   ```
2. Write the migration. Example if next seq is `20260623000000`:
   ```sql
   -- P4 Nango connector lane: store Nango's connection identifiers on the connections row.
   -- For [N] providers these are non-null; for [H]/[G]/[A] rows both columns are null.
   alter table connections
     add column if not exists nango_connection_id text,
     add column if not exists nango_provider_config_key text;

   comment on column connections.nango_connection_id is
     'Nango opaque connection identifier — non-null for method=N connectors only.';
   comment on column connections.nango_provider_config_key is
     'Nango integration key (e.g. ''google-mail'') — non-null for method=N connectors only.';
   ```
3. Verify the SQL is valid against dev DB (apply locally via Supabase CLI or psql):
   ```bash
   npx supabase db push --db-url "$SUPABASE_DEV_DB_URL" --include-all
   ```
   Alternatively apply directly with `psql`:
   ```bash
   psql "$SUPABASE_DEV_DB_URL" -f supabase/migrations/<seq>_nango_connection_cols.sql
   ```
4. Verify: `select column_name from information_schema.columns where table_name = 'connections' and column_name like 'nango%';` returns 2 rows.
5. Do NOT apply to staging or prod yet — that is Task 10 (final migration sweep).

**Commit:** `migration(<seq>): add nango_connection_id + nango_provider_config_key to connections`

---

### Task 4 — Update `GmailClient` to extend `NangoConnectorClient`

**Files touched:**
- `packages/connectors/src/connectors/gmail.ts`
- `packages/connectors/test/gmail.test.ts` (existing — update constructor injection only)

**Purpose:** `GmailClient` extends `NangoConnectorClient` instead of `HttpConnectorClient`. All public methods (`listMessages`, `getMessageMetadata`, `getProfile`, `historyList`, `watch`, `createDraft`, `deleteDraft`, `sendDraft`, `sendMessage`, `sendMessageDirect`, `getMessageBody`, `listThreads`) are unchanged in signature and behavior.

**TDD steps:**

1. Read the existing `packages/connectors/test/gmail.test.ts` to understand the current mock setup (vault-based).
2. Identify every test that constructs `new GmailClient(connection, vault, ...)`. These are the tests to update — their assertions must not change.
3. In each test file, replace vault injection with `makeMockNango`:
   ```ts
   // Before:
   const client = new GmailClient(conn, mockVault);
   // After:
   const client = new GmailClient(conn, makeMockNango({ proxyData: gmailProfileResponse }), 'nango-conn-id');
   ```
4. Run `npx vitest run packages/connectors/test/gmail.test.ts` — RED (constructor mismatch).
5. Update `packages/connectors/src/connectors/gmail.ts`:
   - Change `import { HttpConnectorClient } from './base';` → `import { NangoConnectorClient } from './nango-base';`
   - Remove `import type { TokenVault } from '../vault';`
   - Change `export class GmailClient extends HttpConnectorClient {`  →  `export class GmailClient extends NangoConnectorClient {`
   - Change constructor:
     ```ts
     constructor(
       connection: Connection,
       nango: Nango,
       nangoConnectionId: string,
       unsafeTestOverrides?: never, // retained in signature for smooth refactor; unused
     ) {
       super(connection, nango, 'google-mail', nangoConnectionId);
     }
     ```
   - Remove the `unsafeTestOverrides` forwarding (Nango proxy has no equivalent — tests use the mock instead).
   - The `requireGrantedScope` private method remains identical (`this.connection.scopes.includes(scope)`).
   - The `SendVelocityLimiter` import and usage in `sendMessage` remains identical.
   - All method bodies remain identical — they call `this.request(...)` or `this.readJson(...)` which now route through `NangoConnectorClient`.

6. Run `npx vitest run packages/connectors/test/gmail.test.ts` — GREEN.
7. `npm run typecheck` — green.

**Important audit (before commit):** Grep for every call site of `makeGmailClient` or `new GmailClient` across the monorepo:
```bash
grep -r 'GmailClient\|makeGmailClient' /c/nib-p4/apps /c/nib-p4/packages --include='*.ts' -l
```
For each call site in `apps/web`: these will be updated in Task 6 (factory injection). Mark them as TODO but do not edit yet.

**Commit:** `feat(connectors/gmail): extend NangoConnectorClient; vault dep removed`

---

### Task 5 — Update `GoogleCalendarClient` to extend `NangoConnectorClient`

**Files touched:**
- `packages/connectors/src/connectors/google-calendar.ts`
- `packages/connectors/test/google-calendar.test.ts` (existing — update constructor injection only)

**Steps are identical to Task 4, substituting:**
- `GmailClient` → `GoogleCalendarClient`
- `'google-mail'` → `'google-calendar'`
- vault tests → mock-nango tests

The `createEvent` scope check (`this.connection.scopes.includes(SCOPE_EVENTS)`) remains identical.

**Vault-read audit:** After updating `GoogleCalendarClient`, do a global audit of all call sites that previously passed a `TokenVault` to either client. Produce a list of files (do not fix yet — that is Task 6):
```bash
grep -r 'TokenVault\|vault\.read\|vault\.store' /c/nib-p4/apps --include='*.ts' -l
```
Verify none of these are gated on `method !== 'N'` yet. Note which files will need the guard in Task 6.

**Commit:** `feat(connectors/google-calendar): extend NangoConnectorClient; vault dep removed`

---

### Task 6 — Factory functions and call-site injection (vault guard)

**Files touched:**
- `packages/connectors/src/connectors/gmail.ts` (add `makeGmailClient`)
- `packages/connectors/src/connectors/google-calendar.ts` (add `makeGoogleCalendarClient`)
- Every call site in `apps/web` that constructs `GmailClient`/`GoogleCalendarClient` (identified in Tasks 4–5)
- `packages/connectors/test/factories.test.ts` (new)

**Purpose:** Add typed factory functions that accept a Nango instance (or a mock). Update call sites in `apps/web` to inject Nango from a shared singleton. Gate vault reads on `descriptor.method !== 'N'`.

**Nango singleton** (`apps/web/lib/connectors/nango.ts`, new):
```ts
import { Nango } from '@nangohq/node';

let _nango: Nango | null = null;

export function getNango(): Nango {
  if (!_nango) {
    const secretKey = process.env.NANGO_SECRET_KEY;
    if (!secretKey) throw new Error('NANGO_SECRET_KEY is not set');
    _nango = new Nango({ secretKey, host: process.env.NANGO_HOST });
  }
  return _nango;
}
```

**Factory functions:**
```ts
// gmail.ts
export function makeGmailClient(
  connection: Connection,
  nango: Nango,
  nangoConnectionId: string,
): GmailClient {
  if (connection.provider !== 'gmail') throw new Error('provider mismatch');
  return new GmailClient(connection, nango, nangoConnectionId);
}

// google-calendar.ts
export function makeGoogleCalendarClient(
  connection: Connection,
  nango: Nango,
  nangoConnectionId: string,
): GoogleCalendarClient {
  if (connection.provider !== 'google-calendar') throw new Error('provider mismatch');
  return new GoogleCalendarClient(connection, nango, nangoConnectionId);
}
```

**TDD steps:**

1. Write `packages/connectors/test/factories.test.ts`:
   ```ts
   it('makeGmailClient throws on provider mismatch', () => {
     const conn = makeConnection({ provider: 'google-calendar' });
     expect(() => makeGmailClient(conn, makeMockNango(), 'id')).toThrow('provider mismatch');
   });
   it('makeGoogleCalendarClient constructs successfully', () => {
     const conn = makeConnection({ provider: 'google-calendar', status: 'active' });
     const client = makeGoogleCalendarClient(conn, makeMockNango(), 'id');
     expect(client.provider).toBe('google-calendar');
   });
   ```
2. Run — RED. Implement factories. Run — GREEN.
3. For each call site in `apps/web` that previously called `new GmailClient(conn, vault)`:
   - Replace with `makeGmailClient(conn, getNango(), conn.nango_connection_id!)`.
   - Guard vault reads that remain for `[H]` connectors with `if (descriptor.method !== 'N')`.
4. `npm run typecheck` — green.
5. `npx vitest run packages/connectors` — green.

**Commit:** `feat(connectors): factory functions + Nango singleton + vault-read guard`

---

### Task 7 — Update registry: `gmail` and `google-calendar` descriptors to `method: 'N'`

**Files touched:**
- `packages/connectors/src/registry/registry.ts`
- `packages/connectors/test/registry.test.ts` (existing — verify method is now N)

**Purpose:** Flip `method` from `'H'` to `'N'` on the two descriptors. This is the routing key that `beginConnectAction` will use in Task 8.

**TDD steps:**

1. Add a test assertion in `packages/connectors/test/registry.test.ts`:
   ```ts
   it('gmail and google-calendar use method N', () => {
     expect(getConnector('gmail').method).toBe('N');
     expect(getConnector('google-calendar').method).toBe('N');
   });
   ```
2. Run — RED.
3. In `registry.ts`:
   - Change `gmail` descriptor: `method: 'H'` → `method: 'N'`
   - Change `google-calendar` descriptor: `method: 'H'` → `method: 'N'`
4. Run — GREEN.
5. Verify `validateDescriptor` passes for both updated entries:
   ```ts
   it('gmail descriptor is valid after method N change', () => {
     expect(validateDescriptor(getConnector('gmail'))).toEqual([]);
   });
   ```
6. `npm run typecheck` — green.

**Commit:** `feat(connectors/registry): gmail + google-calendar method H → N`

---

### Task 8 — Extract `enforcePlatformGate` and route `beginConnectAction` on method N

**Files touched:**
- `packages/connectors/src/oauth/flow.ts` (extract and export `enforcePlatformGate`)
- `apps/web/lib/connections/begin.ts` (or wherever `beginConnect` lives)
- `apps/web/app/app/connections/actions.ts`
- `apps/web/lib/connections/nango-connect.ts` (new — Nango connect action logic)
- `apps/web/test/connections/nango-connect.test.ts` (new)

**Purpose:** `enforcePlatformGate` must be callable from the Nango connect path without going through `beginConnectAuthorization`. Extract it as a named export. Wire `beginConnectAction` to fork on `descriptor.method === 'N'`.

**TDD steps:**

1. Verify `enforcePlatformGate` is currently a private function in `flow.ts` (it is — line 103). Write a failing test in `packages/connectors/test/flow.test.ts` that imports it:
   ```ts
   import { enforcePlatformGate } from '../src/oauth/flow';
   // ...
   it('enforcePlatformGate is exported and throws tester-required for pending providers without tester', () => {
     const descriptor = getConnector('gmail'); // method: pending
     expect(() =>
       enforcePlatformGate(descriptor, { provider: 'gmail', clientId: 'x', redirectUri: 'y' })
     ).toThrow('tester-required');
   });
   ```
2. Run — RED (not exported).
3. In `flow.ts`: change `function enforcePlatformGate` → `export function enforcePlatformGate`. No other change.
4. Run — GREEN.
5. Write `apps/web/lib/connections/nango-connect.ts`:

   ```ts
   /**
    * Nango [N] connect action logic.
    * Enforces the tester-allowlist gate (same invariant as [H] path),
    * then redirects to Nango's hosted OAuth URL.
    *
    * Nango hosted connect URL shape (Nango v0.43+):
    *   https://api.nango.dev/oauth/connect/{providerConfigKey}?connection_id=...&public_key=...
    * The public key is NANGO_PUBLIC_KEY (browser-safe; never the secret key).
    */
   import { enforcePlatformGate } from '@nibbin/connectors/oauth/flow';
   import type { TesterAllowlist } from '@nibbin/connectors/oauth/flow';
   import { getConnector } from '@nibbin/connectors/registry/registry';

   export interface NangoConnectInput {
     provider: string;
     accountId: string;
     userEmail: string | null;
     testerAllowlist: TesterAllowlist;
     returnTo?: string;
   }

   export interface NangoConnectResult {
     /** Redirect the user to this URL to start the Nango hosted OAuth flow. */
     url: string;
     /** The connection_id we passed to Nango — write to connections row on callback. */
     nangoConnectionId: string;
   }

   export function buildNangoConnectUrl(input: NangoConnectInput): NangoConnectResult {
     const descriptor = getConnector(input.provider);
     if (descriptor.method !== 'N') throw new Error(`provider ${input.provider} is not a Nango connector`);

     // Enforce tester gate — same invariant as [H] path.
     enforcePlatformGate(descriptor, {
       provider: input.provider,
       clientId: '',   // not used by enforcePlatformGate; only platform.verification matters
       redirectUri: '',
       tester: input.userEmail
         ? { email: input.userEmail, allowlist: input.testerAllowlist }
         : undefined,
     });

     const providerConfigKey = providerToNangoKey(input.provider);
     const nangoConnectionId = `nibbin-${input.accountId}-${input.provider}`;
     const publicKey = process.env.NANGO_PUBLIC_KEY ?? '';
     const nangoHost = process.env.NANGO_HOST ?? 'https://api.nango.dev';

     const url = new URL(`${nangoHost}/oauth/connect/${encodeURIComponent(providerConfigKey)}`);
     url.searchParams.set('connection_id', nangoConnectionId);
     url.searchParams.set('public_key', publicKey);
     if (input.returnTo) url.searchParams.set('state', encodeURIComponent(input.returnTo));

     return { url: url.href, nangoConnectionId };
   }

   export function providerToNangoKey(provider: string): string {
     const MAP: Record<string, string> = {
       gmail: 'google-mail',
       'google-calendar': 'google-calendar',
     };
     const key = MAP[provider];
     if (!key) throw new Error(`no Nango provider config key for ${provider}`);
     return key;
   }
   ```

6. Write `apps/web/test/connections/nango-connect.test.ts`:
   ```ts
   import { buildNangoConnectUrl, providerToNangoKey } from '../../lib/connections/nango-connect';

   const mockAllowlist = { isAllowed: () => true, count: () => 0 };

   it('builds Nango connect URL for gmail', () => {
     const result = buildNangoConnectUrl({
       provider: 'gmail',
       accountId: 'acc-123',
       userEmail: 'test@example.com',
       testerAllowlist: mockAllowlist,
     });
     expect(result.url).toContain('/oauth/connect/google-mail');
     expect(result.url).toContain('connection_id=nibbin-acc-123-gmail');
     expect(result.nangoConnectionId).toBe('nibbin-acc-123-gmail');
   });

   it('throws tester-required when userEmail is null for pending provider', () => {
     expect(() =>
       buildNangoConnectUrl({ provider: 'gmail', accountId: 'acc-1', userEmail: null, testerAllowlist: mockAllowlist })
     ).toThrow('tester-required');
   });

   it('throws tester-not-allowed when email is not on allowlist', () => {
     const restrictive = { isAllowed: () => false, count: () => 0 };
     expect(() =>
       buildNangoConnectUrl({ provider: 'gmail', accountId: 'acc-1', userEmail: 'x@y.com', testerAllowlist: restrictive })
     ).toThrow('tester-not-allowed');
   });

   it('throws tester-cap-reached when allowlist count >= cap', () => {
     const full = { isAllowed: () => true, count: () => 100 }; // gmail cap = 100
     expect(() =>
       buildNangoConnectUrl({ provider: 'gmail', accountId: 'acc-1', userEmail: 'x@y.com', testerAllowlist: full })
     ).toThrow('tester-cap-reached');
   });

   it('throws for non-N provider', () => {
     expect(() =>
       buildNangoConnectUrl({ provider: 'honeybook', accountId: 'a', userEmail: 'x@y.com', testerAllowlist: mockAllowlist })
     ).toThrow('is not a Nango connector');
   });

   it('providerToNangoKey maps correctly', () => {
     expect(providerToNangoKey('gmail')).toBe('google-mail');
     expect(providerToNangoKey('google-calendar')).toBe('google-calendar');
     expect(() => providerToNangoKey('honeybook')).toThrow();
   });
   ```
7. Run `npx vitest run apps/web/test/connections/nango-connect.test.ts` — GREEN after implementing the file above.
8. Update `apps/web/app/app/connections/actions.ts` `beginConnectAction`:
   ```ts
   // After resolving the descriptor, fork:
   const descriptor = getConnector(provider);
   if (descriptor.method === 'N') {
     const allowlist = await loadTesterAllowlist(provider, svc);
     const { url } = buildNangoConnectUrl({ provider, accountId, userEmail: user.email ?? null, testerAllowlist: allowlist, returnTo });
     redirect(url);
     return;
   }
   // [H] path — unchanged below:
   const { url } = await beginConnect(...)
   ```
9. `npm run typecheck` — green.

**Commit:** `feat(connections): export enforcePlatformGate; route method N to Nango hosted connect URL`

---

### Task 9 — Post-connect callback: write `nango_connection_id` + scopes; webhook re-registration

**Files touched:**
- `apps/web/app/api/connect/nango/callback/route.ts` (new — Nango post-connect webhook receiver)
- `apps/web/test/api/nango-callback.test.ts` (new)

**Purpose:** After the user completes OAuth on Nango's hosted UI, Nango fires a webhook (or the client-side SDK resolves). This route receives Nango's event, reads the scopes back from `nango.getConnection()`, writes `nango_connection_id` + `nango_provider_config_key` + `scopes` to the `connections` row, sets `status = 'active'`, and triggers Gmail Pub/Sub `watch()` / Calendar `watchEvents()` if applicable.

**Design note on Nango webhooks vs. polling:** Nango can call a registered webhook URL after a successful OAuth connect. The recommended approach is to register `POST /api/connect/nango/callback` in the Nango dashboard as the webhook URL. This avoids a client-side polling loop.

**TDD steps:**

1. Write `apps/web/test/api/nango-callback.test.ts` with:

   a. **Valid Nango event writes to DB:**
   ```ts
   it('writes nango_connection_id + scopes + active status on valid event', async () => {
     const event = makeNangoWebhookEvent({ type: 'auth', connectionId: 'nibbin-acc-123-gmail', providerConfigKey: 'google-mail', scopes: 'https://www.googleapis.com/auth/gmail.readonly' });
     const response = await POST(makeRequest(event));
     expect(response.status).toBe(200);
     expect(mockSvc.upsert).toHaveBeenCalledWith(expect.objectContaining({
       nango_connection_id: 'nibbin-acc-123-gmail',
       nango_provider_config_key: 'google-mail',
       status: 'active',
       scopes: expect.arrayContaining(['https://www.googleapis.com/auth/gmail.readonly']),
     }));
   });
   ```

   b. **Unknown connectionId → 400:**
   ```ts
   it('returns 400 when connectionId does not match any pending connection', async () => {
     mockSvc.select.mockResolvedValue({ data: null });
     const event = makeNangoWebhookEvent({ connectionId: 'unknown' });
     const response = await POST(makeRequest(event));
     expect(response.status).toBe(400);
   });
   ```

   c. **Nango HMAC signature validation (if Nango signs webhook events):**
   ```ts
   it('returns 401 when Nango signature header is absent or invalid', async () => {
     const event = makeNangoWebhookEvent({ connectionId: 'nibbin-acc-123-gmail' });
     const response = await POST(makeRequest(event, { skipSignature: true }));
     expect(response.status).toBe(401);
   });
   ```

2. Implement `apps/web/app/api/connect/nango/callback/route.ts`:
   - Verify Nango's HMAC signature (Nango signs webhooks with a shared secret from the dashboard).
   - Parse `connectionId`, `providerConfigKey` from the event body.
   - Derive `provider` from `providerConfigKey` (reverse of `providerToNangoKey`).
   - Call `nango.getConnection(connectionId, providerConfigKey)` to retrieve `credentials.raw.scope`.
   - Parse scopes string → string array.
   - Upsert `connections` row: set `nango_connection_id`, `nango_provider_config_key`, `scopes`, `status = 'active'`.
   - For Gmail: call `gmailClient.watch(pubSubTopicName)` via `makeGmailClient(conn, getNango(), connectionId)`.
   - For Google Calendar: call `calendarClient.watchEvents(...)` similarly.
   - Return `{ status: 200 }`.

3. Run tests — GREEN.
4. `npm run typecheck` — green.

**Commit:** `feat(api): POST /api/connect/nango/callback — write nango ids + scopes + trigger watch`

---

### Task 10 — Disconnect flow: call `nango.deleteConnection()` before row revoke

**Files touched:**
- `apps/web/lib/connections/revoke-connection.ts` (existing — add Nango delete call)
- `apps/web/test/connections/revoke.test.ts` (existing or new — add Nango case)

**Purpose:** When the user disconnects a `[N]` provider, call `nango.deleteConnection(nangoConnectionId, providerConfigKey)` before marking the row `revoked`. This removes the token from Nango's vault.

**TDD steps:**

1. Write/extend test:
   ```ts
   it('calls nango.deleteConnection for method N connector before revoking row', async () => {
     const mockNango = makeMockNango();
     const conn = makeConnection({ provider: 'gmail', status: 'active', nango_connection_id: 'n-conn-1', nango_provider_config_key: 'google-mail' });
     await revokeAndSuspend(conn.id, 'user-1', mockSvc, { nango: mockNango });
     expect(mockNango.deleteConnection).toHaveBeenCalledWith('n-conn-1', 'google-mail');
   });

   it('revokes row even when nango.deleteConnection throws (fail-open)', async () => {
     const mockNango = makeMockNango({ deleteConnectionShouldThrow: true });
     const conn = makeConnection({ provider: 'gmail', status: 'active', nango_connection_id: 'n-conn-1', nango_provider_config_key: 'google-mail' });
     await expect(revokeAndSuspend(conn.id, 'user-1', mockSvc, { nango: mockNango })).resolves.toBeUndefined();
     // Row should still be revoked despite the Nango error.
     expect(mockSvc.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'revoked' }));
   });
   ```
2. Run — RED.
3. In `revoke-connection.ts`:
   - Accept optional `{ nango?: Nango }` deps parameter.
   - Before the existing vault revoke + row update: if `conn.nango_connection_id && nango`, call `await nango.deleteConnection(conn.nango_connection_id, conn.nango_provider_config_key).catch(() => {})` (fail-open — the row revoke must still proceed).
4. Update `disconnectAction` in `actions.ts` to pass `getNango()` if the connector is method N.
5. Run — GREEN.
6. `npm run typecheck` — green.

**Commit:** `feat(connections): disconnect calls nango.deleteConnection for [N] providers (fail-open)`

---

### Task 11 — Adversarial gate

**Files touched:**
- `docs/gates/2026-06-23-nango-connector-lane.md` (new)

**Reviewers (per the standard 4-reviewer gate):**
- red-team: attack token-custody (Nango Cloud holds Gmail/Calendar tokens — can Nango be compelled to disclose them? What happens if Nango is breached? Can a Nibbin be tricked into reading a different account's token?)
- claims-auditor: verify every preserved invariant claim (scope-at-connect, tester-allowlist, egress re-check, quarantine, send-velocity, action-level gate) against the actual code, not just the spec prose.
- logic-skeptic: find edge cases in the `assertEgress` path, the `providerToNangoKey` mapping, the post-connect scope-parsing, the fail-open delete.
- cost-auditor: Nango Cloud usage cost at scale (connections × $0.01/month), Nango proxy latency added to every Gmail/Calendar request.

**Gate pass criteria:**
- No P0/P1 findings unresolved.
- Every claimed invariant (§3.4 of the design spec) verified present in code by claims-auditor.
- Token-custody risk formally accepted (DPA executed, subprocessor list updated) or self-hosted Nango confirmed as the path.

**Commit:** `docs(gates): adversarial gate — nango connector lane`

---

### Task 12 — Full regression: run all connector + web tests

```bash
cd /c/nib-p4
npm run lint
npm run typecheck
npx vitest run packages/connectors
npx vitest run apps/web
```

All green. Fix any failures before proceeding to Task 13.

**Commit:** none (this is a check, not a change).

---

### Task 13 — Migration sweep: apply to all three databases

**Apply in order: dev → staging → prod.**

```bash
# Dev
psql "$SUPABASE_DEV_DB_URL" -f supabase/migrations/<seq>_nango_connection_cols.sql

# Staging
psql "$SUPABASE_STAGING_DB_URL" -f supabase/migrations/<seq>_nango_connection_cols.sql

# Prod
psql "$SUPABASE_PROD_DB_URL" -f supabase/migrations/<seq>_nango_connection_cols.sql
```

After each: verify with
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'connections' and column_name like 'nango%';
```
Expected: 2 rows, `is_nullable = YES`.

**Commit:** `migration: apply nango_connection_cols to dev/staging/prod (P4)`

---

### Task 14 — End-to-end smoke test (local, real Nango)

Not a unit test — a manual verification checklist. Run once before raising the PR.

```
[ ] Set NANGO_SECRET_KEY + NANGO_PUBLIC_KEY + NANGO_HOST in .env.local
[ ] `npm run dev` in apps/web
[ ] Navigate to /app/connections
[ ] Click "Connect Gmail" — verify redirect to Nango hosted OAuth (accounts.google.com via Nango)
[ ] Complete Google OAuth consent — verify redirect back to /app/connections?connected=gmail
[ ] Verify `connections` row has nango_connection_id + nango_provider_config_key non-null and status = active
[ ] Verify scopes column populated with gmail.readonly + gmail.compose + gmail.send
[ ] Click "Disconnect Gmail" — verify row status = revoked, nango.deleteConnection called (check Nango dashboard)
[ ] Repeat for Google Calendar
[ ] Confirm [H] connectors (HoneyBook, Pixieset, Instagram-DM) still connect via the original OAuth flow
[ ] Confirm McpRailClient test passes (no Nango imports leaked in)
```

---

## Task Execution Order

```
Task 0  → Task 1 → Task 2 → Task 3 (parallel with Task 2 is fine)
         → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9
         → Task 10 → Task 11 (gate) → Task 12 (regression) → Task 13 (migrations)
         → Task 14 (smoke)
```

Tasks 2 and 3 can run in parallel (base class and migration are independent).
Tasks 4 and 5 can run in parallel (GmailClient and GoogleCalendarClient are independent).
Task 11 (adversarial gate) must not start until Tasks 8–10 are complete and green.
Task 13 (migration sweep) must not start until Task 11 passes.

---

## Risks and Forks

| Risk | Mitigation |
|---|---|
| **Nango proxy response shape differs from spec.** `nango.proxy()` returns an Axios-style `{ data, status, headers }` in `@nangohq/node`. Confirm the exact shape by reading the SDK source before writing `NangoConnectorClient.request()`. If `data` is already parsed JSON, `JSON.stringify(res.data)` is correct. If it's a string, parse it. The mock in Task 2 must match the real shape. | Run Task 0's SDK smoke test against a real Nango connection in dev before writing the mock. |
| **Nango webhook event shape may change between SDK versions.** The callback route (Task 9) parses Nango's webhook body. Pin `@nangohq/node` to an exact version and document the expected event shape. | Do not use a range like `^0.43.7` — use `0.43.7` (exact) in production. |
| **`enforcePlatformGate` uses `req.clientId` and `req.redirectUri` from `BeginAuthorizationRequest`.** These are required fields in the interface but unused by `enforcePlatformGate` itself. Passing empty strings is safe for the gate check but will look odd. Consider extracting a narrower `PlatformGateRequest` type in `flow.ts` that only carries `tester?`. | Add the narrower type in Task 8 alongside the export. |
| **`nango_connection_id` collision.** If the same account disconnects and reconnects, the `nibbin-{accountId}-{provider}` connectionId will be reused. Nango may return an existing connection rather than creating a new one. This is probably desirable (same account, same connection), but verify the Nango behavior. | Document in the callback handler. If Nango errors on duplicate connectionId, append a timestamp suffix: `nibbin-{accountId}-{provider}-{Date.now()}`. |
| **Stripe deferred.** The Stripe registry descriptor remains `method: 'H'` with no Nango wiring. The `disconnectAction` and callback route must not crash on a Stripe disconnect. Stripe is excluded from all Task 7 and Task 8 changes. | Explicit guard in Task 7 (`provider !== 'stripe'`) and in Task 8 routing. |

---

## Files Created / Modified Summary

| File | Task | Action |
|---|---|---|
| `packages/connectors/package.json` | 0 | Add `@nangohq/node` |
| `packages/connectors/src/nango-client.ts` | 0 | New — SDK re-export |
| `packages/connectors/src/registry/types.ts` | 1 | `ConnectorMethod` + `validateDescriptor` |
| `packages/connectors/src/connectors/nango-base.ts` | 2 | New — `NangoConnectorClient` |
| `packages/connectors/test/helpers/mock-nango.ts` | 2 | New — test mock |
| `supabase/migrations/<seq>_nango_connection_cols.sql` | 3 | New migration |
| `packages/connectors/src/connectors/gmail.ts` | 4 | Extend `NangoConnectorClient` |
| `packages/connectors/src/connectors/google-calendar.ts` | 5 | Extend `NangoConnectorClient` |
| `apps/web/lib/connectors/nango.ts` | 6 | New — Nango singleton |
| `packages/connectors/src/registry/registry.ts` | 7 | `method: 'N'` for gmail + google-calendar |
| `packages/connectors/src/oauth/flow.ts` | 8 | Export `enforcePlatformGate` |
| `apps/web/lib/connections/nango-connect.ts` | 8 | New — `buildNangoConnectUrl` |
| `apps/web/app/app/connections/actions.ts` | 8 | Fork on `method === 'N'` |
| `apps/web/app/api/connect/nango/callback/route.ts` | 9 | New — Nango webhook receiver |
| `apps/web/lib/connections/revoke-connection.ts` | 10 | Add `nango.deleteConnection` |
| `docs/gates/2026-06-23-nango-connector-lane.md` | 11 | Adversarial gate report |

**Untouched (must not change):**
- `packages/connectors/src/rails/mcp.ts`
- `packages/connectors/src/connectors/base.ts` (except adding `'egress'` to `ConnectorRequestError.kind`)
- `apps/web/lib/connections/providers.ts`
- `apps/web/app/app/connections/page.tsx`
- All `[H]` connector files (`honeybook.ts`, `pixieset.ts`, `instagram-dm.ts`, `stripe.ts`)
- `packages/runtime/src/primitives/*`
- `packages/scan/src/modules/*`
