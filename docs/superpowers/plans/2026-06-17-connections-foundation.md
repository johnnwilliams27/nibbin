# Connections Foundation (read-only Gmail connect) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make external-account connection work end-to-end for Gmail (read-only), behind a discoverable Connections surface, and wire the Agent Shop adopt flow so "Adopt" never dead-ends.

**Architecture:** A server action begins an OAuth authorization (via the existing `@nibbin/connectors` engine), persists short-lived state in a new service-role-only `oauth_pending_authorizations` table, and redirects to Google. A callback route exchanges the code, inserts an `active` `connections` row, seals the token in the vault, and redirects back — optionally auto-resuming a pending adoption. Core logic lives in injectable, unit-testable functions; the route/action are thin wrappers. The connect requests `gmail.readonly` only (write is Spec 2).

**Tech Stack:** Next.js App Router (server components, route handlers, server actions), Supabase (Postgres + Vault, service-role RPCs), `@nibbin/connectors` OAuth engine, Vitest, CSS Modules.

## Global Constraints

- **First-connect scope is `gmail.readonly`** (full read incl. bodies — the diagnosis needs message contents). No write scopes requested in this spec.
- **Decision A / no draft-only scope:** OAuth gives only a read/write boundary; draft/send/autonomy are runtime-gated (Spec 2). This plan touches only read.
- **Connection writes + token storage are service-role only.** Clients keep read-only RLS on `connections`. New state tables are service-role only (RLS enabled, `revoke all from authenticated, anon`).
- **Token material only in the vault** (`connection_token_store`), never in app tables or logs.
- **Migrations apply to BOTH dev and prod** Supabase projects (repo practice). Naming: `YYYYMMDDhhmmss_<name>.sql`.
- **Provider/redirect values:** redirect URI = `${NEXT_PUBLIC_SITE_URL or https://nibbin.com}/api/connect/google/callback`. Env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.
- **Test runner:** `npx vitest run <path>` (config: `vitest.config.ts`, `fileParallelism: false`). Tests live in `apps/web/lib/**/*.test.ts` or `apps/*/test/**`.
- **Conventional commits**, ending with the `Co-Authored-By` trailer used in this repo.
- **Styling:** token-only (`packages/shared/tokens.css`), reuse `Card`/`Badge`/`InlineFeedback`. No new hex.

---

## File Structure

**Create:**
- `supabase/migrations/20260617000000_connect_oauth_pending_and_tester_allowlist.sql` — two service-role tables.
- `apps/web/lib/connections/google-oauth-env.ts` — `getGoogleOAuthConfig()`.
- `apps/web/lib/connections/tester-allowlist.ts` — `supabaseTesterAllowlist(provider)` implementing `TesterAllowlist`.
- `apps/web/lib/connections/pending.ts` — `storePending`, `consumePending` (service-role).
- `apps/web/lib/connections/begin.ts` — `beginConnect(args, deps)` core.
- `apps/web/lib/connections/complete.ts` — `completeConnection(code, returnedState, deps)` core.
- `apps/web/lib/connections/providers.ts` — `CONNECTABLE_PROVIDERS` (id/label/wired flag) for the surface.
- `apps/web/app/app/connections/actions.ts` — `beginConnectAction` (`'use server'`).
- `apps/web/app/api/connect/google/callback/route.ts` — callback route (wires real deps).
- `apps/web/app/app/connections/page.tsx` — Connections surface.
- `apps/web/app/app/connections/connections.module.css` — styles.
- `apps/web/components/connections/ProviderIcon.tsx` — provider logo SVG by id + fallback.
- Test files alongside each lib (`*.test.ts`).

**Modify:**
- `packages/connectors/src/registry/registry.ts` — gmail `scopes.read` → `gmail.readonly`.
- `packages/connectors/test/registry.test.ts` — assert readonly.
- `apps/web/components/shell/AppShell.tsx` — add `'connections'` to `NavKey` + `NAV`.
- `apps/web/components/settings/SettingsNav.tsx` — remove the `connections` tab.
- `apps/web/app/app/settings/connections/page.tsx` — replace body with `redirect('/app/connections')`.
- `apps/web/app/app/shop/actions.ts` — on missing connectors, redirect to `/app/connections?needed=…&resume=…`.

---

## Task 1: Registry — widen gmail read scope to `gmail.readonly`

**Files:**
- Modify: `packages/connectors/src/registry/registry.ts:49`
- Test: `packages/connectors/test/registry.test.ts:87-92`

**Interfaces:**
- Produces: `getConnector('gmail').scopes.read === ['https://www.googleapis.com/auth/gmail.readonly']`.

- [ ] **Step 1: Update the failing test** — change the existing assertion in `registry.test.ts`:

```typescript
it('gmail first-connect read scope is gmail.readonly (rich diagnosis data dump)', () => {
  const gmail = getConnector('gmail');
  expect(gmail.scopes.read).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/connectors/test/registry.test.ts`
Expected: FAIL — received `['…/gmail.metadata']`.

- [ ] **Step 3: Change the registry** — in `registry.ts` gmail descriptor, replace the `read` array:

```typescript
      read: ['https://www.googleapis.com/auth/gmail.readonly'],
```

(Update the adjacent comment to note: full read incl. bodies; required by the diagnosis data dump; restricted scope, CASA before prod.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/connectors/test/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Check no other test asserts metadata**

Run: `npx vitest run packages/connectors`
Expected: PASS. If any test references `gmail.metadata` as the read scope, update it to `gmail.readonly`.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/registry/registry.ts packages/connectors/test/registry.test.ts
git commit -m "feat(connectors): gmail first-connect read scope → gmail.readonly

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration — pending-auth + tester-allowlist tables

**Files:**
- Create: `supabase/migrations/20260617000000_connect_oauth_pending_and_tester_allowlist.sql`

**Interfaces:**
- Produces tables `public.oauth_pending_authorizations` (PK `state`) and `public.tester_allowlist` (PK `email,provider`), both service-role only.

- [ ] **Step 1: Write the migration**

```sql
-- Connect foundation: short-lived OAuth state + tester gate. Both service-role
-- only (RLS on, no policies, explicit revoke) — mirrors connections' write model.

create table public.oauth_pending_authorizations (
  state text primary key,                       -- issued OAuth state (lookup key at callback)
  provider text not null check (btrim(provider) <> ''),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  nonce text not null,
  code_verifier text,                           -- PKCE S256 verifier (present for Google)
  scopes text[] not null default '{}',          -- exact scopes requested
  return_to text,                               -- post-callback redirect path
  resume_template text,                         -- shop templateKey to auto-adopt after connect
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,              -- ~10 min TTL
  consumed_at timestamptz                        -- single-use
);
alter table public.oauth_pending_authorizations enable row level security;
revoke all on public.oauth_pending_authorizations from authenticated, anon;

create index oauth_pending_expires_idx on public.oauth_pending_authorizations (expires_at);

create table public.tester_allowlist (
  email text not null,
  provider text not null,
  added_at timestamptz not null default now(),
  primary key (email, provider)
);
alter table public.tester_allowlist enable row level security;
revoke all on public.tester_allowlist from authenticated, anon;
```

- [ ] **Step 2: Apply to the dev Supabase project**

Use the Supabase MCP `apply_migration` (or `supabase db push`) against the **dev** project. Verify:
Run (SQL): `select tablename from pg_tables where tablename in ('oauth_pending_authorizations','tester_allowlist');`
Expected: both rows returned.

- [ ] **Step 3: Confirm RLS denies authenticated**

Run (SQL, as an authenticated role): `select * from public.oauth_pending_authorizations;`
Expected: permission denied / 0 rows under RLS.

- [ ] **Step 4: Apply to the prod Supabase project** (same migration).

- [ ] **Step 5: Seed the tester allowlist (out-of-band, both DBs)** — not in the committed migration (no emails in git). Run with the operator's Google tester email:

```sql
insert into public.tester_allowlist (email, provider)
values (lower('YOUR_TESTER_EMAIL@gmail.com'), 'gmail')
on conflict do nothing;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260617000000_connect_oauth_pending_and_tester_allowlist.sql
git commit -m "feat(db): oauth_pending_authorizations + tester_allowlist (service-role)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `getGoogleOAuthConfig()` env helper

**Files:**
- Create: `apps/web/lib/connections/google-oauth-env.ts`
- Test: `apps/web/lib/connections/google-oauth-env.test.ts`

**Interfaces:**
- Produces: `getGoogleOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGoogleOAuthConfig } from './google-oauth-env';

afterEach(() => vi.unstubAllEnvs());

describe('getGoogleOAuthConfig', () => {
  it('builds the redirect URI from the site origin and returns creds', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'secret');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    expect(getGoogleOAuthConfig()).toEqual({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/api/connect/google/callback',
    });
  });

  it('throws when creds are missing', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', '');
    expect(() => getGoogleOAuthConfig()).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/lib/connections/google-oauth-env.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nibbin.com').replace(/\/$/, '');

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (see apps/web/.env.local)');
  }
  return { clientId, clientSecret, redirectUri: `${SITE()}/api/connect/google/callback` };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/web/lib/connections/google-oauth-env.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/connections/google-oauth-env.ts apps/web/lib/connections/google-oauth-env.test.ts
git commit -m "feat(web): getGoogleOAuthConfig env helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Tester allowlist (service-role)

**Files:**
- Create: `apps/web/lib/connections/tester-allowlist.ts`
- Test: `apps/web/lib/connections/tester-allowlist.test.ts`

**Interfaces:**
- Consumes: `TesterAllowlist` interface from `@nibbin/connectors` (`{ isAllowed(email): boolean; count(): number }`). NOTE: that interface is **sync**; we therefore pre-load the allowlist rows into memory before constructing it.
- Produces: `loadTesterAllowlist(provider: string, svc?: SupabaseClient): Promise<TesterAllowlist>`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { makeTesterAllowlist } from './tester-allowlist';

describe('makeTesterAllowlist', () => {
  it('allows a normalized email present in the loaded set and counts distinct testers', () => {
    const a = makeTesterAllowlist(['john@gmail.com', 'amy@gmail.com']);
    expect(a.isAllowed('John@Gmail.com')).toBe(true);
    expect(a.isAllowed('nobody@gmail.com')).toBe(false);
    expect(a.count()).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/lib/connections/tester-allowlist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (pure `makeTesterAllowlist` + a service-role loader)

```typescript
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TesterAllowlist } from '@nibbin/connectors';
import { serviceClient } from '../supabase/service';

/** Pure, sync allowlist over a pre-loaded set (satisfies the connectors interface). */
export function makeTesterAllowlist(emails: string[]): TesterAllowlist {
  const set = new Set(emails.map((e) => e.trim().toLowerCase()));
  return {
    isAllowed: (email: string) => set.has(email.trim().toLowerCase()),
    count: () => set.size,
  };
}

/** Load the provider's tester allowlist from the service-role table. */
export async function loadTesterAllowlist(
  provider: string,
  svc: SupabaseClient = serviceClient(),
): Promise<TesterAllowlist> {
  const { data, error } = await svc.from('tester_allowlist').select('email').eq('provider', provider);
  if (error) throw new Error(`tester allowlist load failed: ${error.message}`);
  return makeTesterAllowlist((data ?? []).map((r) => r.email as string));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/web/lib/connections/tester-allowlist.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/connections/tester-allowlist.ts apps/web/lib/connections/tester-allowlist.test.ts
git commit -m "feat(web): tester allowlist (service-role) for verification-pending providers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Pending-auth store/consume (service-role)

**Files:**
- Create: `apps/web/lib/connections/pending.ts`
- Test: `apps/web/lib/connections/pending.test.ts`

**Interfaces:**
- Produces:
  - `type PendingAuth = { state; provider; accountId; userId; codeVerifier?; scopes: string[]; returnTo: string | null; resumeTemplate: string | null; expiresAt: string; consumedAt: string | null }`
  - `storePending(row: StorePendingInput, svc?): Promise<void>`
  - `consumePending(state: string, nowMs: number, svc?): Promise<PendingAuth | null>` — returns the row and marks it consumed; returns null if missing, already consumed, or expired.

- [ ] **Step 1: Write the failing test** (in-memory fake `svc` capturing insert/select/update)

```typescript
import { describe, expect, it } from 'vitest';
import { storePending, consumePending, type PendingAuth } from './pending';

function fakeSvc(rows: Record<string, any>) {
  return {
    from() {
      return {
        insert: async (r: any) => { rows[r.state] = { ...r, consumed_at: null }; return { error: null }; },
        select() { return this; },
        eq(_c: string, v: string) { this._k = v; return this; },
        maybeSingle: async () => ({ data: rows[(this as any)._k] ?? null, error: null }),
        update(patch: any) { this._patch = patch; return this; },
      } as any;
    },
  } as any;
}

describe('pending store/consume', () => {
  it('stores then consumes once; second consume returns null', async () => {
    const rows: Record<string, any> = {};
    const svc = fakeSvc(rows);
    await storePending({
      state: 's1', provider: 'gmail', accountId: 'a', userId: 'u', nonce: 'n',
      codeVerifier: 'v', scopes: ['x'], returnTo: '/app/connections', resumeTemplate: null,
      expiresAtMs: 10_000,
    }, svc);
    const first = await consumePending('s1', 5_000, svc);
    expect(first?.provider).toBe('gmail');
    rows['s1'].consumed_at = '2026-06-17T00:00:00Z'; // simulate the consume write
    const second = await consumePending('s1', 5_000, svc);
    expect(second).toBeNull();
  });

  it('returns null when expired', async () => {
    const rows: Record<string, any> = {};
    const svc = fakeSvc(rows);
    await storePending({
      state: 's2', provider: 'gmail', accountId: 'a', userId: 'u', nonce: 'n',
      scopes: ['x'], returnTo: null, resumeTemplate: null, expiresAtMs: 1_000,
    }, svc);
    expect(await consumePending('s2', 9_999, svc)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/lib/connections/pending.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../supabase/service';

export interface PendingAuth {
  state: string;
  provider: string;
  accountId: string;
  userId: string;
  codeVerifier?: string;
  scopes: string[];
  returnTo: string | null;
  resumeTemplate: string | null;
  expiresAt: string;
  consumedAt: string | null;
}

export interface StorePendingInput {
  state: string; provider: string; accountId: string; userId: string; nonce: string;
  codeVerifier?: string; scopes: string[]; returnTo: string | null; resumeTemplate: string | null;
  expiresAtMs: number;
}

export async function storePending(
  input: StorePendingInput,
  svc: SupabaseClient = serviceClient(),
): Promise<void> {
  const { error } = await svc.from('oauth_pending_authorizations').insert({
    state: input.state,
    provider: input.provider,
    account_id: input.accountId,
    user_id: input.userId,
    nonce: input.nonce,
    code_verifier: input.codeVerifier ?? null,
    scopes: input.scopes,
    return_to: input.returnTo,
    resume_template: input.resumeTemplate,
    expires_at: new Date(input.expiresAtMs).toISOString(),
  });
  if (error) throw new Error(`pending store failed: ${error.message}`);
}

export async function consumePending(
  state: string,
  nowMs: number,
  svc: SupabaseClient = serviceClient(),
): Promise<PendingAuth | null> {
  const { data, error } = await svc
    .from('oauth_pending_authorizations')
    .select('*')
    .eq('state', state)
    .maybeSingle();
  if (error) throw new Error(`pending read failed: ${error.message}`);
  if (!data) return null;
  if (data.consumed_at) return null;
  if (new Date(data.expires_at).getTime() < nowMs) return null;
  await svc
    .from('oauth_pending_authorizations')
    .update({ consumed_at: new Date(nowMs).toISOString() })
    .eq('state', state);
  return {
    state: data.state,
    provider: data.provider,
    accountId: data.account_id,
    userId: data.user_id,
    codeVerifier: data.code_verifier ?? undefined,
    scopes: data.scopes ?? [],
    returnTo: data.return_to ?? null,
    resumeTemplate: data.resume_template ?? null,
    expiresAt: data.expires_at,
    consumedAt: data.consumed_at ?? null,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/web/lib/connections/pending.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/connections/pending.ts apps/web/lib/connections/pending.test.ts
git commit -m "feat(web): pending OAuth state store/consume (single-use, TTL)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `beginConnect` core

**Files:**
- Create: `apps/web/lib/connections/begin.ts`
- Test: `apps/web/lib/connections/begin.test.ts`

**Interfaces:**
- Consumes: `beginAuthorization`, `OAuthFlowError`, `TesterAllowlist` from `@nibbin/connectors`; `storePending` (Task 5); `getGoogleOAuthConfig` (Task 3); `loadTesterAllowlist` (Task 4).
- Produces: `beginConnect(args, deps): Promise<{ url: string }>` where
  `args = { provider; accountId; userId; userEmail: string | null; returnTo?: string; resumeTemplate?: string }`
  `deps = { config: GoogleOAuthConfig; allowlistFor(provider): Promise<TesterAllowlist>; save(input: StorePendingInput): Promise<void>; nowMs: number; pendingTtlMs?: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { beginConnect } from './begin';
import { makeTesterAllowlist } from './tester-allowlist';

const config = { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://localhost:3000/api/connect/google/callback' };

it('builds a Google authorization URL and persists pending state', async () => {
  const saved: any[] = [];
  const res = await beginConnect(
    { provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'john@gmail.com', returnTo: '/app/connections', resumeTemplate: 'scribe' },
    {
      config,
      allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']),
      save: async (i) => { saved.push(i); },
      nowMs: 1000,
    },
  );
  const url = new URL(res.url);
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
  expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ provider: 'gmail', accountId: 'a', resumeTemplate: 'scribe', returnTo: '/app/connections' });
  expect(saved[0].state).toBe(url.searchParams.get('state'));
});

it('throws a friendly tester error when email is not allowlisted', async () => {
  await expect(beginConnect(
    { provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'nope@gmail.com' },
    { config, allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']), save: async () => {}, nowMs: 1 },
  )).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/lib/connections/begin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import 'server-only';
import { beginAuthorization, getConnector, type TesterAllowlist } from '@nibbin/connectors';
import type { GoogleOAuthConfig } from './google-oauth-env';
import type { StorePendingInput } from './pending';

const PENDING_TTL_MS = 10 * 60 * 1000;

export interface BeginConnectArgs {
  provider: string;
  accountId: string;
  userId: string;
  userEmail: string | null;
  returnTo?: string;
  resumeTemplate?: string;
}

export interface BeginConnectDeps {
  config: GoogleOAuthConfig;
  allowlistFor: (provider: string) => Promise<TesterAllowlist>;
  save: (input: StorePendingInput) => Promise<void>;
  nowMs: number;
  pendingTtlMs?: number;
}

export async function beginConnect(args: BeginConnectArgs, deps: BeginConnectDeps): Promise<{ url: string }> {
  const descriptor = getConnector(args.provider);
  const tester =
    descriptor.platform?.verification === 'pending'
      ? { email: args.userEmail ?? '', allowlist: await deps.allowlistFor(args.provider) }
      : undefined;

  const pending = beginAuthorization({
    provider: args.provider,
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    tester,
    loginHint: args.userEmail ?? undefined,
  });

  await deps.save({
    state: pending.state,
    provider: args.provider,
    accountId: args.accountId,
    userId: args.userId,
    nonce: pending.nonce,
    codeVerifier: pending.codeVerifier,
    scopes: pending.scopes,
    returnTo: args.returnTo ?? null,
    resumeTemplate: args.resumeTemplate ?? null,
    expiresAtMs: deps.nowMs + (deps.pendingTtlMs ?? PENDING_TTL_MS),
  });

  return { url: pending.url };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/web/lib/connections/begin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/connections/begin.ts apps/web/lib/connections/begin.test.ts
git commit -m "feat(web): beginConnect core — authorize + persist pending (tester-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `completeConnection` core (exchange → connection → vault → resume)

**Files:**
- Create: `apps/web/lib/connections/complete.ts`
- Test: `apps/web/lib/connections/complete.test.ts`

**Interfaces:**
- Consumes: `PendingAuth` (Task 5); `StoredToken` from `@nibbin/connectors`.
- Produces: `completeConnection(input, deps): Promise<{ redirectTo: string }>` where
  `input = { code: string; returnedState: string; nowMs: number }`
  `deps = { consume(state, nowMs): Promise<PendingAuth | null>; exchange(p: PendingAuth, code: string): Promise<StoredToken>; createActiveConnection(p: PendingAuth, token: StoredToken): Promise<string>; resumeAdopt?(p: PendingAuth, templateKey: string): Promise<{ ok: boolean; missing: string[] }> }`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { completeConnection } from './complete';
import type { PendingAuth } from './pending';

const base: PendingAuth = {
  state: 's', provider: 'gmail', accountId: 'a', userId: 'u', codeVerifier: 'v',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'], returnTo: '/app/connections',
  resumeTemplate: null, expiresAt: new Date(99_999).toISOString(), consumedAt: null,
};
const token = { accessToken: 'at', scopes: base.scopes };

it('exchanges, creates the connection, and redirects to return_to', async () => {
  const created: any[] = [];
  const res = await completeConnection(
    { code: 'c', returnedState: 's', nowMs: 1 },
    {
      consume: async () => base,
      exchange: async () => token,
      createActiveConnection: async (_p, t) => { created.push(t); return 'conn1'; },
    },
  );
  expect(created).toHaveLength(1);
  expect(res.redirectTo).toBe('/app/connections?connected=gmail');
});

it('auto-resumes adoption and redirects to grove on success', async () => {
  const res = await completeConnection(
    { code: 'c', returnedState: 's', nowMs: 1 },
    {
      consume: async () => ({ ...base, resumeTemplate: 'scribe' }),
      exchange: async () => token,
      createActiveConnection: async () => 'conn1',
      resumeAdopt: async () => ({ ok: true, missing: [] }),
    },
  );
  expect(res.redirectTo).toBe('/app?adopted=scribe');
});

it('redirects to a friendly error when state is unknown/expired', async () => {
  const res = await completeConnection(
    { code: 'c', returnedState: 'gone', nowMs: 1 },
    { consume: async () => null, exchange: async () => token, createActiveConnection: async () => 'x' },
  );
  expect(res.redirectTo).toBe('/app/connections?error=expired');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/lib/connections/complete.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import 'server-only';
import type { StoredToken } from '@nibbin/connectors';
import type { PendingAuth } from './pending';

export interface CompleteConnectionInput {
  code: string;
  returnedState: string;
  nowMs: number;
}

export interface CompleteConnectionDeps {
  consume: (state: string, nowMs: number) => Promise<PendingAuth | null>;
  exchange: (pending: PendingAuth, code: string) => Promise<StoredToken>;
  createActiveConnection: (pending: PendingAuth, token: StoredToken) => Promise<string>;
  resumeAdopt?: (pending: PendingAuth, templateKey: string) => Promise<{ ok: boolean; missing: string[] }>;
}

export async function completeConnection(
  input: CompleteConnectionInput,
  deps: CompleteConnectionDeps,
): Promise<{ redirectTo: string }> {
  const pending = await deps.consume(input.returnedState, input.nowMs);
  if (!pending) return { redirectTo: '/app/connections?error=expired' };

  let token: StoredToken;
  try {
    token = await deps.exchange(pending, input.code);
  } catch {
    const back = pending.returnTo ?? '/app/connections';
    return { redirectTo: appendQuery(back, { error: 'exchange_failed' }) };
  }

  await deps.createActiveConnection(pending, token);

  if (pending.resumeTemplate && deps.resumeAdopt) {
    const r = await deps.resumeAdopt(pending, pending.resumeTemplate);
    if (r.ok) return { redirectTo: `/app?adopted=${encodeURIComponent(pending.resumeTemplate)}` };
    return {
      redirectTo: appendQuery('/app/connections', {
        needed: r.missing.join(','),
        resume: pending.resumeTemplate,
      }),
    };
  }

  return { redirectTo: `/app/connections?connected=${encodeURIComponent(pending.provider)}` };
}

function appendQuery(path: string, params: Record<string, string>): string {
  const [base, existing] = path.split('?');
  const sp = new URLSearchParams(existing);
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/web/lib/connections/complete.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/connections/complete.ts apps/web/lib/connections/complete.test.ts
git commit -m "feat(web): completeConnection core — exchange, persist, auto-resume adopt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire the real connect endpoints (server action + callback route)

**Files:**
- Create: `apps/web/app/app/connections/actions.ts`
- Create: `apps/web/app/api/connect/google/callback/route.ts`
- Test: `apps/web/test/connect-callback.test.ts`

**Interfaces:**
- Consumes: `appSession`, `serviceClient`, `getGoogleOAuthConfig`, `loadTesterAllowlist`, `storePending`/`consumePending`, `beginConnect`, `completeConnection`, `exchangeCode`/`getConnector` from `@nibbin/connectors`, `adoptTemplate` from `lib/runtime/adopt`.
- Produces: `beginConnectAction(formData)` server action; `GET` handler at `/api/connect/google/callback`. A reusable `realCompleteDeps(svc)` factory in the route module (exported for the test).

- [ ] **Step 1: Write the failing test** — drive `completeConnection` with `realExchange` using the engine's `unsafeTestOverrides` mock token endpoint, and a fake `svc` for the connection insert + vault RPC.

```typescript
import { describe, expect, it } from 'vitest';
import { exchangeViaEngine, makeCreateActiveConnection } from '../app/api/connect/google/callback/route';
import type { PendingAuth } from '../lib/connections/pending';

const pending: PendingAuth = {
  state: 's', provider: 'gmail', accountId: 'a', userId: 'u', codeVerifier: 'v',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'], returnTo: '/app/connections',
  resumeTemplate: null, expiresAt: new Date(Date.now() + 60000).toISOString(), consumedAt: null,
};

it('exchangeViaEngine redeems a code against a mock token endpoint', async () => {
  const token = await exchangeViaEngine(pending, 'thecode', {
    fetch: async () => new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: pending.scopes.join(' ') }), { status: 200 }),
  });
  expect(token.accessToken).toBe('AT');
  expect(token.scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
});

it('makeCreateActiveConnection inserts an active connection and stores the token via the vault RPC', async () => {
  const calls: any = { insert: null, rpc: null };
  const svc: any = {
    from: () => ({ insert: (r: any) => ({ select: () => ({ single: async () => { calls.insert = r; return { data: { id: 'conn1' }, error: null }; } }) }) }),
    rpc: async (name: string, params: any) => { calls.rpc = { name, params }; return { data: '"ref"', error: null }; },
  };
  const create = makeCreateActiveConnection(svc);
  const id = await create(pending, { accessToken: 'AT', scopes: pending.scopes });
  expect(id).toBe('conn1');
  expect(calls.insert).toMatchObject({ account_id: 'a', provider: 'gmail', method: 'H', status: 'active' });
  expect(calls.rpc).toMatchObject({ name: 'connection_token_store', params: { p_connection: 'conn1' } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/test/connect-callback.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Implement the callback route** (`apps/web/app/api/connect/google/callback/route.ts`)

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exchangeCode, type StoredToken } from '@nibbin/connectors';
import type { UnsafeTestOverrides } from '@nibbin/connectors';
import { serviceClient } from '../../../../lib/supabase/service';
import { getGoogleOAuthConfig } from '../../../../lib/connections/google-oauth-env';
import { consumePending, type PendingAuth } from '../../../../lib/connections/pending';
import { completeConnection } from '../../../../lib/connections/complete';
import { adoptTemplate } from '../../../../lib/runtime/adopt';

export const dynamic = 'force-dynamic';

/** Redeem the callback code via the OAuth engine (test override injects a mock token endpoint). */
export async function exchangeViaEngine(
  pending: PendingAuth,
  code: string,
  overrides?: UnsafeTestOverrides,
): Promise<StoredToken> {
  const cfg = getGoogleOAuthConfig();
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

/** Insert an active connection (service role) and seal the token in the vault. */
export function makeCreateActiveConnection(svc: SupabaseClient) {
  return async (pending: PendingAuth, token: StoredToken): Promise<string> => {
    const { data, error } = await svc
      .from('connections')
      .insert({
        account_id: pending.accountId,
        provider: pending.provider,
        method: 'H',
        scopes: token.scopes,
        status: 'active',
        created_by: pending.userId,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`connection insert failed: ${error?.message}`);
    const { error: vErr } = await svc.rpc('connection_token_store', {
      p_connection: data.id,
      p_token: JSON.stringify(token),
    });
    if (vErr) throw new Error(`token store failed: ${vErr.message}`);
    return data.id as string;
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError || !code || !state) {
    return NextResponse.redirect(new URL('/app/connections?error=declined', request.url));
  }

  const svc = serviceClient();
  const { redirectTo } = await completeConnection(
    { code, returnedState: state, nowMs: Date.now() },
    {
      consume: (s, now) => consumePending(s, now, svc),
      exchange: (pending, c) => exchangeViaEngine(pending, c),
      createActiveConnection: makeCreateActiveConnection(svc),
      resumeAdopt: async (pending, templateKey) => {
        const r = await adoptTemplate(pending.accountId, pending.userId, templateKey);
        return { ok: r.missingConnectors.length === 0, missing: r.missingConnectors };
      },
    },
  );
  return NextResponse.redirect(new URL(redirectTo, request.url));
}
```

> NOTE: `exchangeViaEngine` passes `pending.state` as **both** `expectedState` and `returnedState` because we already authenticated the round-trip by looking the row up by `state` (the URL `state` *is* the lookup key). The engine's timing-safe check is then trivially satisfied; the real protection is the single-use pending row.

- [ ] **Step 4: Implement the server action** (`apps/web/app/app/connections/actions.ts`)

```typescript
'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';
import { getGoogleOAuthConfig } from '../../../lib/connections/google-oauth-env';
import { loadTesterAllowlist } from '../../../lib/connections/tester-allowlist';
import { storePending } from '../../../lib/connections/pending';
import { beginConnect } from '../../../lib/connections/begin';

export async function beginConnectAction(formData: FormData): Promise<void> {
  const provider = String(formData.get('provider') ?? '');
  const returnTo = (formData.get('returnTo') as string) || undefined;
  const resumeTemplate = (formData.get('resumeTemplate') as string) || undefined;

  const { user, accountId } = await appSession();
  const svc = serviceClient();
  const { url } = await beginConnect(
    { provider, accountId, userId: user.id, userEmail: user.email ?? null, returnTo, resumeTemplate },
    {
      config: getGoogleOAuthConfig(),
      allowlistFor: (p) => loadTesterAllowlist(p, svc),
      save: (input) => storePending(input, svc),
      nowMs: Date.now(),
    },
  );
  redirect(url);
}
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx vitest run apps/web/test/connect-callback.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace apps/web`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/app/connections/actions.ts apps/web/app/api/connect/google/callback/route.ts apps/web/test/connect-callback.test.ts
git commit -m "feat(web): Gmail connect server action + OAuth callback route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Provider icons + connectable-providers list

**Files:**
- Create: `apps/web/components/connections/ProviderIcon.tsx`
- Create: `apps/web/lib/connections/providers.ts`
- Test: `apps/web/lib/connections/providers.test.ts`

**Interfaces:**
- Produces: `CONNECTABLE_PROVIDERS: { id: string; label: string; wired: boolean }[]` (Gmail `wired: true`; a couple others `wired: false`); `ProviderIcon({ provider, size }: { provider: string; size?: number })` rendering a bundled inline SVG keyed by id, generic leaf fallback otherwise.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { CONNECTABLE_PROVIDERS } from './providers';

it('lists Gmail as the only wired provider for v1', () => {
  const gmail = CONNECTABLE_PROVIDERS.find((p) => p.id === 'gmail');
  expect(gmail?.wired).toBe(true);
  expect(CONNECTABLE_PROVIDERS.filter((p) => p.wired)).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/lib/connections/providers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the list**

```typescript
export interface ConnectableProvider {
  id: string;
  label: string;
  wired: boolean; // false → shown as "Coming soon", non-interactive
}

export const CONNECTABLE_PROVIDERS: ConnectableProvider[] = [
  { id: 'gmail', label: 'Gmail', wired: true },
  { id: 'google-calendar', label: 'Google Calendar', wired: false },
  { id: 'stripe', label: 'Stripe', wired: false },
];
```

- [ ] **Step 4: Implement `ProviderIcon`** (inline SVGs; no runtime fetch; token colors)

```tsx
const ICONS: Record<string, React.ReactNode> = {
  gmail: (
    <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h13A1.5 1.5 0 0 1 18 5.5v9A1.5 1.5 0 0 1 16.5 16h-13A1.5 1.5 0 0 1 2 14.5v-9Zm2 .2v8.6h12V5.7l-6 4.2-6-4.2Zm10.8-.2H5.2L10 8.6l4.8-3.1Z" fill="currentColor" />
  ),
};

export function ProviderIcon({ provider, size = 20 }: { provider: string; size?: number }) {
  const glyph = ICONS[provider] ?? (
    <path d="M10 2l5 3v6l-5 3-5-3V5l5-3Z" fill="currentColor" opacity="0.5" />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {glyph}
    </svg>
  );
}
```

- [ ] **Step 5: Run to verify the test passes + typecheck**

Run: `npx vitest run apps/web/lib/connections/providers.test.ts && npm run typecheck --workspace apps/web`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/connections/ProviderIcon.tsx apps/web/lib/connections/providers.ts apps/web/lib/connections/providers.test.ts
git commit -m "feat(web): provider icons + connectable-providers registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Connections surface + nav + settings redirect

**Files:**
- Create: `apps/web/app/app/connections/page.tsx`
- Create: `apps/web/app/app/connections/connections.module.css`
- Modify: `apps/web/components/shell/AppShell.tsx:18-27` (NavKey) and `:109-121` (NAV)
- Modify: `apps/web/components/settings/SettingsNav.tsx:5-13`
- Modify: `apps/web/app/app/settings/connections/page.tsx` (→ redirect)

**Interfaces:**
- Consumes: `AppShell` (`active="connections"`), `CONNECTABLE_PROVIDERS`, `ProviderIcon`, `Card`, `Badge`, `InlineFeedback`, `beginConnectAction`.

- [ ] **Step 1: Add the nav key + item** — in `AppShell.tsx`, add `| 'connections'` to `NavKey`, and insert into `NAV` after the `nibbins` entry:

```typescript
  { key: 'connections', label: 'Connections', href: '/app/connections' },
```

- [ ] **Step 2: Drop the settings Connections tab** — in `SettingsNav.tsx`, remove `'connections'` from `SettingsTab` and the `TABS` entry for connections.

- [ ] **Step 3: Replace the settings connections page with a redirect** — `apps/web/app/app/settings/connections/page.tsx` becomes:

```typescript
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ConnectionsSettingsRedirect() {
  redirect('/app/connections');
}
```

- [ ] **Step 4: Build the Connections surface** — `apps/web/app/app/connections/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { Card, Badge, InlineFeedback } from '../../../components/ui';
import { ProviderIcon } from '../../../components/connections/ProviderIcon';
import { CONNECTABLE_PROVIDERS } from '../../../lib/connections/providers';
import { beginConnectAction } from './actions';
import { adoptFromShopAction } from '../shop/actions';
import styles from './connections.module.css';

export const metadata: Metadata = { title: 'Connections — Nibbin' };
export const dynamic = 'force-dynamic';

type Tone = 'moss' | 'honey' | 'sky' | 'coral' | 'neutral';
const STATUS_TONE: Record<string, Tone> = { active: 'moss', pending: 'honey', paused: 'honey', error: 'coral', revoked: 'neutral' };

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; needed?: string; resume?: string }>;
}) {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, user, accountId } = session;
  const sp = await searchParams;

  const { data } = await supabase
    .from('connections')
    .select('provider, scopes, status')
    .eq('account_id', accountId)
    .neq('status', 'revoked');
  const byProvider = new Map((data ?? []).map((c) => [c.provider as string, c]));

  return (
    <AppShell active="connections" title="Connections" email={user.email}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Connections</p>
        <h1 className={styles.title}>Accounts your Nibbins work from</h1>
      </header>

      {sp.connected && <InlineFeedback tone="success">{sp.connected} is connected.</InlineFeedback>}
      {sp.error === 'expired' && <InlineFeedback tone="error">That connection link expired — try again.</InlineFeedback>}
      {sp.error === 'exchange_failed' && <InlineFeedback tone="error">Couldn’t finish connecting — nothing was saved. Try again.</InlineFeedback>}
      {sp.error === 'declined' && <InlineFeedback tone="error">You declined the connection.</InlineFeedback>}
      {sp.needed && (
        <InlineFeedback tone="error">
          That Nibbin needs {sp.needed.split(',').join(' and ')} connected to finish adopting.
        </InlineFeedback>
      )}

      <div className={styles.grid}>
        {CONNECTABLE_PROVIDERS.map((p) => {
          const conn = byProvider.get(p.id);
          const resumeHere = sp.resume && sp.needed?.split(',').includes(p.id);
          return (
            <Card key={p.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.icon}><ProviderIcon provider={p.id} size={22} /></span>
                <span className={styles.name}>{p.label}</span>
                {conn && <Badge tone={STATUS_TONE[conn.status] ?? 'neutral'}>{conn.status}</Badge>}
              </div>
              {conn ? (
                <p className={styles.scopes}>{conn.scopes?.length ? conn.scopes.join(' · ') : 'Read-only access'}</p>
              ) : p.wired ? (
                <form action={beginConnectAction}>
                  <input type="hidden" name="provider" value={p.id} />
                  {sp.resume && <input type="hidden" name="resumeTemplate" value={sp.resume} />}
                  <input type="hidden" name="returnTo" value="/app/connections" />
                  <button className={styles.connect} type="submit">Connect {p.label}</button>
                </form>
              ) : (
                <p className={styles.soon}>Coming soon</p>
              )}
              {conn && resumeHere && (
                <form action={adoptFromShopAction}>
                  <input type="hidden" name="templateKey" value={sp.resume} />
                  <button className={styles.connect} type="submit">Finish adopting</button>
                </form>
              )}
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: Add styles** — `apps/web/app/app/connections/connections.module.css` (token-only):

```css
.header { margin-bottom: 18px; }
.eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--moss-deep); font-weight: 600; }
.title { font-family: var(--display); font-weight: 800; font-size: 30px; color: var(--ink); margin: 6px 0 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }
.card { display: flex; flex-direction: column; gap: 10px; padding: 18px; }
.cardTop { display: flex; align-items: center; gap: 10px; }
.icon { color: var(--moss-deep); display: inline-flex; }
.name { font-family: var(--display); font-weight: 700; font-size: 17px; color: var(--ink); flex: 1; }
.scopes { font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; color: var(--ink-soft); margin: 0; }
.soon { font-size: 13px; color: var(--ink-faint); margin: 0; }
.connect { font-family: var(--sans); font-size: 14px; font-weight: 600; color: var(--canopy); background: var(--moss-deep); border: none; border-radius: var(--r-button); padding: 10px 16px; min-height: 44px; cursor: pointer; }
.connect:hover { background: var(--moss); }
.connect:focus-visible { outline: 2px solid var(--moss); outline-offset: 2px; }
```

- [ ] **Step 6: Typecheck + build the route**

Run: `npm run typecheck --workspace apps/web`
Expected: no errors (confirms NavKey/SettingsTab edits are consistent).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/app/connections apps/web/components/shell/AppShell.tsx apps/web/components/settings/SettingsNav.tsx apps/web/app/app/settings/connections/page.tsx
git commit -m "feat(web): top-level Connections surface; redirect settings tab (NIB-3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: NIB-1 — adopt routes to Connections with resume

**Files:**
- Modify: `apps/web/app/app/shop/actions.ts:27-32`
- Test: `apps/web/test/shop-adopt-missing.test.ts`

**Interfaces:**
- Consumes: `adoptTemplate` (existing). Produces: on missing connectors, `adoptFromShopAction` redirects to `/app/connections?needed=<providers>&resume=<templateKey>`.

- [ ] **Step 1: Write the failing test** — assert the redirect target by mocking `adoptTemplate` to return `missingConnectors` and capturing the `redirect` call.

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth/app-session', () => ({ appSession: async () => ({ user: { id: 'u' }, accountId: 'a' }) }));
vi.mock('../lib/runtime/adopt', () => ({ adoptTemplate: async () => ({ missingConnectors: ['gmail'], name: 'Scribe', nibbinId: '', templateKey: 'scribe', stage: 'egg', firstRun: null }) }));
const redirected: string[] = [];
vi.mock('next/navigation', () => ({ redirect: (u: string) => { redirected.push(u); throw new Error('REDIRECT'); } }));
vi.mock('@nibbin/runtime', () => ({ SHOP_TEMPLATE_KEYS: ['scribe'] }));

it('routes a missing-connector adopt to Connections with needed + resume', async () => {
  const { adoptFromShopAction } = await import('../app/app/shop/actions');
  const fd = new FormData();
  fd.set('templateKey', 'scribe');
  await adoptFromShopAction(fd).catch(() => {});
  expect(redirected[0]).toBe('/app/connections?needed=gmail&resume=scribe');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/test/shop-adopt-missing.test.ts`
Expected: FAIL — current code redirects to `/app/shop?missing=…`.

- [ ] **Step 3: Update the action** — in `apps/web/app/app/shop/actions.ts`, replace the missing-connectors branch:

```typescript
  if (result.missingConnectors.length > 0) {
    redirect(
      `/app/connections?needed=${encodeURIComponent(result.missingConnectors.join(','))}` +
        `&resume=${encodeURIComponent(templateKey)}`,
    );
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/web/test/shop-adopt-missing.test.ts`
Expected: PASS.

- [ ] **Step 5: Full web test + typecheck**

Run: `npx vitest run apps/web && npm run typecheck --workspace apps/web`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/app/shop/actions.ts apps/web/test/shop-adopt-missing.test.ts
git commit -m "feat(web): adopt routes missing-connector to Connections w/ resume (NIB-1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Manual end-to-end verification (live Google, test user)

**Files:** none (verification).

- [ ] **Step 1:** Ensure `apps/web/.env.local` has `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `NEXT_PUBLIC_SITE_URL=http://localhost:3000`; the dev DB has the migration + your tester email seeded.
- [ ] **Step 2:** `npm run dev --workspace apps/web`, sign in as the tester, visit `/app/connections`, click **Connect Gmail** → Google consent (click through the unverified-app warning) → returns to `/app/connections?connected=gmail`, Gmail shows **active**.
- [ ] **Step 3:** Confirm DB: a `connections` row (`provider='gmail'`, `status='active'`, non-null `token_ref`) and the `oauth_pending_authorizations` row has `consumed_at` set.
- [ ] **Step 4:** From the Agent Shop, adopt a Gmail-requiring template on a fresh account → lands on `/app/connections?needed=gmail&resume=…` → Connect → auto-resume lands in the grove (`/app?adopted=…`).
- [ ] **Step 5:** Visit `/app/settings/connections` → 308 to `/app/connections`.

---

## Self-Review

**Spec coverage:** Connect flow (begin+callback) — Tasks 5–8. Pending-state table — Task 2/5. Tester allowlist — Task 2/4. Service-role connection insert + vault — Task 8. `gmail.readonly` at connect — Task 1. Connections surface + nav + settings redirect (NIB-3) — Task 10. Provider icons — Task 9. NIB-1 adopt + auto-resume — Tasks 7, 8, 11. Testing via `unsafeTestOverrides` — Task 8. Prereqs/manual — Task 12. **Spec 2 (write/ladder), Spec 3 (eventing), Spec 4 (history sweep)** are explicitly out of scope.

**Type consistency:** `PendingAuth` shape is defined once (Task 5) and consumed unchanged in Tasks 7–8. `StorePendingInput` (Task 5) is produced by `beginConnect` (Task 6). `CONNECTABLE_PROVIDERS` (Task 9) is consumed in Task 10. `completeConnection` deps (Task 7) are wired with the real impls exported from the callback route (Task 8).

**Open follow-ups (not blockers):** a periodic cleanup of expired `oauth_pending_authorizations` rows (cron) is deferred; the `connections_member_read` RLS policy already lets the surface read connections.
