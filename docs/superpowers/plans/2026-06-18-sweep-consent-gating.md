# Sweep Consent-Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Gmail onboarding sweep run only after the user's affirmative, informed opt-in — captured by an unchecked pre-connect checkbox and a Data & Privacy toggle — and widen the seed window to ~12 months.

**Architecture:** Consent rides through the OAuth redirect via a new `oauth_pending_authorizations.sweep_consent` column; on callback we stamp `connections.sweep_consent_at` and only then dispatch the sweep. A Data & Privacy toggle sets/clears the same stamp. The sweep worker independently refuses to run for a connection with no `sweep_consent_at` (fail-closed), so consent is authoritative, not just advisory.

**Tech Stack:** Next.js 15 (App Router, server actions), Supabase (Postgres + service-role RPCs), Vitest (node env), the `@nibbin/connectors` workspace package.

## Global Constraints

- **Default off everywhere.** Checkbox ships unchecked; no pre-ticked consent (GDPR Recital 32 / Planet49). `sweep_consent` defaults `false`; `sweep_consent_at` defaults null.
- **Copy = behavior (TC-P1).** All consent copy must state that **sent-message bodies are processed by the model** and the inbox is reduced to subjects + previews; only short derived notes are kept. NEVER state "not the raw messages" / "only derived notes are sent to the model" (that is the standing #132 overclaim — do not reproduce it).
- **Migrations apply to all three Supabase projects:** dev `oqnqzytctwlptfdvyagl`, staging `swbbydpuiilnamnyhwnr`, prod `oaymttudfazqaqequrke`.
- **Sensitive surface:** touches `apps/web/app/api/`, `connections`, and a migration → an adversarial-gate pass + `docs/gates/2026-06-18-sweep-consent-gating.md` is REQUIRED before the PR (enforced by `adversarial-gate.yml`).
- **CI uses `npm ci`** — any `package.json` change must include the updated `package-lock.json`. (None expected in this plan.)
- Branch: `feature/sweep-consent-gating` (worktree `C:/nib-sweep-consent`, already on current `main`). Run `npm install` once in the worktree before starting.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/20260618040000_sweep_consent.sql` | consent columns | create |
| `apps/web/lib/connections/pending.ts` | thread `sweepConsent` through store/consume | modify |
| `apps/web/lib/connections/begin.ts` | accept + forward `sweepConsent` | modify |
| `apps/web/lib/sweep/dispatch.ts` | extracted sweep dispatch + consent-stamp-and-dispatch helper | create |
| `apps/web/app/api/connect/google/callback/route.ts` | use the helper; gate on consent | modify |
| `apps/web/app/api/sweep/gmail/onboarding/route.ts` | worker-level consent enforcement | modify |
| `apps/web/lib/sweep/gmail-onboarding.ts` | window 90→365 | modify |
| `apps/web/lib/privacy/panel.ts` | sweep-consent view-model | modify |
| `apps/web/app/app/settings/privacy/actions.ts` | `setSweepConsent` action | modify |
| `apps/web/app/app/settings/privacy/page.tsx` | toggle card | modify |
| `apps/web/app/app/connections/actions.ts` | read `sweepConsent` from the form | modify |
| `apps/web/app/app/connections/page.tsx` | unchecked checkbox + corrected copy | modify |

---

### Task 1: Migration — consent columns

**Files:**
- Create: `supabase/migrations/20260618040000_sweep_consent.sql`

**Interfaces:**
- Produces: `oauth_pending_authorizations.sweep_consent boolean`, `connections.sweep_consent_at timestamptz`, `connections.sweep_consent_by uuid`.

- [ ] **Step 1: Write the migration**

```sql
-- Sweep consent-gating: the Gmail onboarding sweep runs only on affirmative
-- opt-in. Default off: existing rows = no consent (safe).

-- Carries the connect-screen checkbox choice through the OAuth redirect.
alter table public.oauth_pending_authorizations
  add column sweep_consent boolean not null default false;

-- The authoritative consent record on the connection. null = no consent.
alter table public.connections
  add column sweep_consent_at timestamptz,
  add column sweep_consent_by uuid references public.users(id);
```

- [ ] **Step 2: Apply to dev and verify the columns exist**

Apply via the Supabase MCP `apply_migration` (name `sweep_consent`, project `oqnqzytctwlptfdvyagl`). Then:

Run (MCP `execute_sql`, dev):
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='connections' and column_name like 'sweep_consent%'
order by 1;
```
Expected: `sweep_consent_at`, `sweep_consent_by`.

- [ ] **Step 3: Apply to staging + prod**

`apply_migration` (same SQL) to `swbbydpuiilnamnyhwnr` and `oaymttudfazqaqequrke`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618040000_sweep_consent.sql
git commit -m "feat(db): sweep consent columns (pending.sweep_consent, connections.sweep_consent_at/by)"
```

---

### Task 2: Thread `sweepConsent` through pending store/consume

**Files:**
- Modify: `apps/web/lib/connections/pending.ts`
- Test: `apps/web/lib/connections/pending.test.ts`

**Interfaces:**
- Consumes: the `sweep_consent` column (Task 1).
- Produces: `StorePendingInput.sweepConsent?: boolean`, `PendingAuth.sweepConsent: boolean`.

- [ ] **Step 1: Write the failing test**

Add to `pending.test.ts` (follow the file's existing mock-svc pattern; if it stubs the insert/select, extend the stub to echo `sweep_consent`):

```ts
it('round-trips sweepConsent through store → consume (defaults false)', async () => {
  // store with sweepConsent true → the inserted row carries sweep_consent: true
  // consume returns sweepConsent: true; an absent value reads back false
  // (assert against the same in-memory svc stub the other pending tests use)
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run apps/web/lib/connections/pending.test.ts`
Expected: FAIL (`sweepConsent` not on the types / not stored).

- [ ] **Step 3: Add the field to the interfaces + store + consume**

In `pending.ts`:
- `StorePendingInput`: add `sweepConsent?: boolean;`
- `PendingAuth`: add `sweepConsent: boolean;`
- In `storePending`'s insert object add: `sweep_consent: input.sweepConsent ?? false,`
- In `consumePending`'s `.select('*')` mapping add: `sweepConsent: data.sweep_consent ?? false,`

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run apps/web/lib/connections/pending.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/connections/pending.ts apps/web/lib/connections/pending.test.ts
git commit -m "feat(connections): thread sweepConsent through oauth pending state"
```

---

### Task 3: `beginConnect` forwards `sweepConsent`

**Files:**
- Modify: `apps/web/lib/connections/begin.ts`
- Test: `apps/web/lib/connections/begin.test.ts`

**Interfaces:**
- Consumes: `StorePendingInput.sweepConsent` (Task 2).
- Produces: `BeginConnectArgs.sweepConsent?: boolean`.

- [ ] **Step 1: Write the failing test**

Add to `begin.test.ts` (it already injects a `save` spy):

```ts
it('forwards sweepConsent into the saved pending row', async () => {
  const saved: StorePendingInput[] = [];
  await beginConnect(
    { provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'u@x.com', sweepConsent: true },
    { config: cfg, allowlistFor: async () => ({ entries: [] } as never), save: async (i) => { saved.push(i); }, nowMs: 0 },
  );
  expect(saved[0].sweepConsent).toBe(true);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run apps/web/lib/connections/begin.test.ts` → FAIL (`sweepConsent` not on args / not saved).

- [ ] **Step 3: Implement**

In `begin.ts`: add `sweepConsent?: boolean;` to `BeginConnectArgs`, and in the `deps.save({...})` object add `sweepConsent: args.sweepConsent ?? false,`.

- [ ] **Step 4: Run the test to confirm it passes** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/connections/begin.ts apps/web/lib/connections/begin.test.ts
git commit -m "feat(connections): beginConnect forwards sweepConsent to pending"
```

---

### Task 4: Extract the sweep dispatch helper + consent-stamp-and-dispatch

**Files:**
- Create: `apps/web/lib/sweep/dispatch.ts`
- Modify: `apps/web/app/api/connect/google/callback/route.ts` (use the helper)
- Test: `apps/web/lib/sweep/dispatch.test.ts`

**Interfaces:**
- Produces:
  - `makeSweepHmac(accountId, connectionId): string | null`
  - `dispatchSweepFireAndForget(baseUrl: string, accountId, connectionId, provider): void`
  - `onGmailConnected(svc, baseUrl, connectionId, sweepConsent, userId): Promise<{ dispatched: boolean }>` — loads the connection; if not gmail returns `{dispatched:false}`; if `sweepConsent` stamps `sweep_consent_at=now(), sweep_consent_by=userId`; dispatches iff the connection now has consent.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/sweep/dispatch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onGmailConnected, dispatchSweepFireAndForget } from './dispatch';

function svcStub(conn: Record<string, unknown> | null) {
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  return {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: conn }) }) }),
      update,
    })),
    __update: update,
  } as never;
}

beforeEach(() => {
  process.env.SWEEP_HMAC_SECRET = 'x';
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true } as Response)));
});

describe('onGmailConnected', () => {
  it('does nothing for a non-gmail connection', async () => {
    const r = await onGmailConnected(svcStub({ provider: 'slack', account_id: 'a', sweep_consent_at: null }), 'http://h', 'c', true, 'u');
    expect(r.dispatched).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stamps consent and dispatches when sweepConsent is true', async () => {
    const svc = svcStub({ provider: 'gmail', account_id: 'a', sweep_consent_at: null });
    const r = await onGmailConnected(svc, 'http://h', 'c', true, 'u');
    expect((svc as { __update: ReturnType<typeof vi.fn> }).__update).toHaveBeenCalledWith(
      expect.objectContaining({ sweep_consent_by: 'u' }),
    );
    expect(r.dispatched).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does NOT dispatch when sweepConsent is false and no prior consent', async () => {
    const svc = svcStub({ provider: 'gmail', account_id: 'a', sweep_consent_at: null });
    const r = await onGmailConnected(svc, 'http://h', 'c', false, 'u');
    expect(r.dispatched).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not dispatch when SWEEP_HMAC_SECRET is unset', async () => {
    delete process.env.SWEEP_HMAC_SECRET;
    const svc = svcStub({ provider: 'gmail', account_id: 'a', sweep_consent_at: null });
    const r = await onGmailConnected(svc, 'http://h', 'c', true, 'u');
    expect(r.dispatched).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run apps/web/lib/sweep/dispatch.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `dispatch.ts`**

```ts
import 'server-only';
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export function makeSweepHmac(accountId: string, connectionId: string): string | null {
  const secret = process.env.SWEEP_HMAC_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`${accountId}:${connectionId}`).digest('hex');
}

/** Fire-and-forget POST to the onboarding sweep worker (gmail only; no-op without a secret). */
export function dispatchSweepFireAndForget(
  baseUrl: string,
  accountId: string,
  connectionId: string,
  provider: string,
): void {
  if (provider !== 'gmail') return;
  const hmac = makeSweepHmac(accountId, connectionId);
  if (!hmac) return;
  const sweepUrl = new URL('/api/sweep/gmail/onboarding', baseUrl).href;
  fetch(sweepUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, connectionId, hmac }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}

/**
 * After a connection is established (or a panel toggle), record consent if the
 * user opted in and dispatch the sweep iff the connection now carries consent.
 * The worker re-checks consent (fail-closed); this is the caller-side gate.
 */
export async function onGmailConnected(
  svc: SupabaseClient,
  baseUrl: string,
  connectionId: string,
  sweepConsent: boolean,
  userId: string,
): Promise<{ dispatched: boolean }> {
  const { data: conn } = await svc
    .from('connections')
    .select('account_id, provider, sweep_consent_at')
    .eq('id', connectionId)
    .maybeSingle();
  if (!conn || conn.provider !== 'gmail') return { dispatched: false };

  let consentAt = conn.sweep_consent_at as string | null;
  if (sweepConsent && !consentAt) {
    await svc
      .from('connections')
      .update({ sweep_consent_at: new Date().toISOString(), sweep_consent_by: userId })
      .eq('id', connectionId);
    consentAt = 'set';
  }
  if (!consentAt) return { dispatched: false };

  const hmac = makeSweepHmac(conn.account_id as string, connectionId);
  if (!hmac) return { dispatched: false };
  dispatchSweepFireAndForget(baseUrl, conn.account_id as string, connectionId, 'gmail');
  return { dispatched: true };
}
```

- [ ] **Step 4: Run tests → PASS.** `npx vitest run apps/web/lib/sweep/dispatch.test.ts`

- [ ] **Step 5: Rewire the callback to use the helper**

In `callback/route.ts`: delete the local `makeSweepHmac` and `dispatchSweepFireAndForget`; import `{ onGmailConnected }` from `../../../../../lib/sweep/dispatch`. Replace the post-connection block (the `if (createdConnectionId) { … dispatchSweepFireAndForget … }`) with:

```ts
  if (createdConnectionId) {
    const pendingConsent = createdPending?.sweepConsent ?? false;
    await onGmailConnected(svc, request.url, createdConnectionId, pendingConsent, createdPendingUserId ?? '');
  }
```

To get `sweepConsent`/`userId` from the consumed pending: capture them in the `consume` seam — wrap `consumePending` so the route keeps a reference (mirror how `createAndCapture` captures the connection id). Add near `createdConnectionId`:

```ts
  let createdPending: PendingAuth | null = null;
  let createdPendingUserId: string | null = null;
```
and change the `consume` dep to:
```ts
      consume: async (s, now) => {
        const p = await consumePending(s, now, svc);
        if (p) { createdPending = p; createdPendingUserId = p.userId; }
        return p;
      },
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p apps/web` → no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/sweep/dispatch.ts apps/web/lib/sweep/dispatch.test.ts apps/web/app/api/connect/google/callback/route.ts
git commit -m "feat(sweep): consent-gated dispatch helper; callback stamps consent before sweeping"
```

---

### Task 5: Worker-level consent enforcement (sweep route)

**Files:**
- Modify: `apps/web/app/api/sweep/gmail/onboarding/route.ts`
- Test: `apps/web/app/api/sweep/gmail/onboarding/route.test.ts`

**Interfaces:**
- Consumes: `connections.sweep_consent_at` (Task 1). The route already verifies the HMAC and calls the `claim_gmail_sweep` RPC (from #112).

- [ ] **Step 1: Write the failing test**

Add to the existing `route.test.ts` (extend the `serviceClient` mock to answer a `connections` select with `sweep_consent_at`):

```ts
it('refuses (no budget) when the connection has no sweep consent', async () => {
  // connections select → { sweep_consent_at: null }
  // expect 200 { status: 'skipped', reason: 'no_consent' }
  // expect the claim RPC and gmailOnboardingSweep NOT called
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run apps/web/app/api/sweep/gmail/onboarding/route.test.ts`).

- [ ] **Step 3: Implement the check**

In `route.ts`, after the HMAC check / `const svc = serviceClient();` and BEFORE the `claim_gmail_sweep` RPC, add:

```ts
  // Consent is authoritative at the worker (fail-closed): a replayed/forged HMAC
  // cannot sweep a connection the user never opted into.
  const { data: consentRow } = await svc
    .from('connections')
    .select('sweep_consent_at')
    .eq('id', connectionId)
    .eq('account_id', accountId)
    .eq('status', 'active')
    .maybeSingle();
  if (!consentRow || consentRow.sweep_consent_at == null) {
    return NextResponse.json({ status: 'skipped', reason: 'no_consent' });
  }
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/sweep/gmail/onboarding/route.ts apps/web/app/api/sweep/gmail/onboarding/route.test.ts
git commit -m "feat(sweep): worker refuses to sweep a connection without recorded consent"
```

---

### Task 6: Widen the seed window to ~12 months

**Files:**
- Modify: `apps/web/lib/sweep/gmail-onboarding.ts`
- Test: `apps/web/lib/sweep/gmail-onboarding.test.ts`

- [ ] **Step 1: Update the test**

In `gmail-onboarding.test.ts`, change the existing `SWEEP_WINDOW_DAYS is 90` test to:
```ts
it('SWEEP_WINDOW_DAYS is 365 (≈12-month seed)', () => expect(SWEEP_WINDOW_DAYS).toBe(365));
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Change the constant**

In `gmail-onboarding.ts`: `export const SWEEP_WINDOW_DAYS = 365;` and update its comment to "≈12-month onboarding seed; caps (MAX_SENT_MESSAGES/MAX_INBOX_THREADS) + newest-first ordering bind first."

- [ ] **Step 4: Run → PASS** (`npx vitest run apps/web/lib/sweep`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sweep/gmail-onboarding.ts apps/web/lib/sweep/gmail-onboarding.test.ts
git commit -m "feat(sweep): widen onboarding seed window 90→365 days (caps unchanged)"
```

---

### Task 7: Panel view-model + `setSweepConsent` action

**Files:**
- Modify: `apps/web/lib/privacy/panel.ts`
- Test: `apps/web/lib/privacy/panel.test.ts` (create if absent)
- Modify: `apps/web/app/app/settings/privacy/actions.ts`

**Interfaces:**
- Produces: `sweepConsentRow(rows): { gmailConnected: boolean; consented: boolean; consentedAt: string | null }`; server action `setSweepConsent(formData)`.

- [ ] **Step 1: Write the failing view-model test**

In `panel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sweepConsentRow } from './panel';

describe('sweepConsentRow', () => {
  it('reports gmail connected + consent state', () => {
    expect(sweepConsentRow([{ provider: 'gmail', status: 'active', sweep_consent_at: '2026-06-18T00:00:00Z' }]))
      .toEqual({ gmailConnected: true, consented: true, consentedAt: '2026-06-18T00:00:00Z' });
    expect(sweepConsentRow([{ provider: 'gmail', status: 'active', sweep_consent_at: null }]))
      .toEqual({ gmailConnected: true, consented: false, consentedAt: null });
    expect(sweepConsentRow([])).toEqual({ gmailConnected: false, consented: false, consentedAt: null });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement the view-model**

In `panel.ts` add (and extend `ConnectionRow` with `sweep_consent_at?: string | null`):
```ts
export function sweepConsentRow(
  rows: (ConnectionRow & { sweep_consent_at?: string | null })[],
): { gmailConnected: boolean; consented: boolean; consentedAt: string | null } {
  const gmail = rows.find((r) => r.provider === 'gmail' && r.status === 'active');
  return {
    gmailConnected: !!gmail,
    consented: !!gmail?.sweep_consent_at,
    consentedAt: gmail?.sweep_consent_at ?? null,
  };
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Add the server action**

In `settings/privacy/actions.ts` (mirror `setContribution`'s shape — `appSession` + service client + `redirect` back with a `state`):
```ts
export async function setSweepConsent(formData: FormData): Promise<void> {
  const enable = String(formData.get('enabled') ?? '') === 'true';
  const { user, accountId } = await appSession();
  const svc = serviceClient();
  const { data: conn } = await svc
    .from('connections')
    .select('id, sweep_consent_at')
    .eq('account_id', accountId)
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .maybeSingle();
  if (!conn?.id) redirect('/app/settings/privacy?error=sweep');

  if (enable) {
    if (!conn.sweep_consent_at) {
      const { onGmailConnected } = await import('../../../../lib/sweep/dispatch');
      // stamps consent + dispatches (worker is the authority); request origin
      // is the app base for the internal sweep POST.
      await onGmailConnected(svc, process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://nibbin.com', conn.id as string, true, user.id);
    }
  } else {
    await svc.from('connections').update({ sweep_consent_at: null, sweep_consent_by: null }).eq('id', conn.id as string);
  }
  redirect('/app/settings/privacy?state=sweep_saved');
}
```
(If `NEXT_PUBLIC_APP_ORIGIN` is not a repo convention, use the existing origin helper the codebase uses for absolute URLs; confirm during implementation.)

- [ ] **Step 6: Typecheck + tests** → `npx tsc --noEmit -p apps/web` and `npx vitest run apps/web/lib/privacy`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/privacy/panel.ts apps/web/lib/privacy/panel.test.ts apps/web/app/app/settings/privacy/actions.ts
git commit -m "feat(privacy): sweep-consent view-model + setSweepConsent toggle action"
```

---

### Task 8: UI — connect checkbox (corrected copy) + panel toggle card

**Files:**
- Modify: `apps/web/app/app/connections/actions.ts`
- Modify: `apps/web/app/app/connections/page.tsx`
- Modify: `apps/web/app/app/settings/privacy/page.tsx`

**Interfaces:**
- Consumes: `beginConnect`'s `sweepConsent` (Task 3), `setSweepConsent` + `sweepConsentRow` (Task 7).

- [ ] **Step 1: Read `sweepConsent` in the connect action**

In `connections/actions.ts` `beginConnectAction`, after reading `provider`:
```ts
  const sweepConsent = formData.get('sweepConsent') === 'on';
```
and pass `sweepConsent` into the `beginConnect({ ... })` args object.

- [ ] **Step 2: Replace the auto-sweep copy with an unchecked checkbox (connect page)**

In `connections/page.tsx`, inside the Gmail `<form action={beginConnectAction}>`, REPLACE the existing `{p.id === 'gmail' && (<p …>Connecting does a one-time read … never the raw mail.</p>)}` block with:
```tsx
                  {p.id === 'gmail' && (
                    <label className={styles.accessNote} style={{ display: 'block', marginTop: 8 }}>
                      <input type="checkbox" name="sweepConsent" />{' '}
                      Also learn my style from my mail — a one-time read of about my last 12 months of
                      sent &amp; inbox mail. My sent messages are processed by the model to learn my
                      voice; my inbox is reduced to subjects and previews. Only short derived notes are
                      kept. I can turn this off in Data &amp; Privacy.
                    </label>
                  )}
```
(Unchecked by default — no `defaultChecked`. This removes the standing #132 overclaim copy.)

- [ ] **Step 3: Add the toggle card to the privacy page**

In `settings/privacy/page.tsx`: import `sweepConsentRow` and `setSweepConsent`; include `sweep_consent_at` in the existing `connections` select (`.select('provider, scopes, status, sweep_consent_at')`); compute `const sweep = sweepConsentRow((conns ?? []) as never);`. Add a Card (after "Connections", mirroring the "Model improvement" card) rendered only when `sweep.gmailConnected`:
```tsx
        {sweep.gmailConnected && (
          <Card>
            <h2 className={styles.sectionTitle}>Learn from my Gmail history</h2>
            <p className={styles.sectionHint}>
              A one-time read of about your last 12 months of sent &amp; inbox mail to learn your
              voice and common questions. Your sent messages are processed by the model; your inbox is
              reduced to subjects and previews. Only short derived notes are kept.
            </p>
            {state === 'sweep_saved' && <InlineFeedback tone="success">Saved.</InlineFeedback>}
            {error === 'sweep' && <InlineFeedback tone="error">Couldn’t update that — try again.</InlineFeedback>}
            <div className={styles.actions}>
              <Badge tone={sweep.consented ? 'moss' : 'neutral'}>{sweep.consented ? 'On' : 'Off'}</Badge>
              <form action={setSweepConsent}>
                <input type="hidden" name="enabled" value={sweep.consented ? 'false' : 'true'} />
                <Button type="submit" variant="secondary">{sweep.consented ? 'Turn off' : 'Turn on'}</Button>
              </form>
            </div>
          </Card>
        )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit -p apps/web` and `npx eslint apps/web/app/app/connections apps/web/app/app/settings/privacy` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/app/connections/actions.ts apps/web/app/app/connections/page.tsx apps/web/app/app/settings/privacy/page.tsx
git commit -m "feat(privacy): unchecked sweep-consent checkbox at connect (corrected copy) + panel toggle"
```

---

### Task 9: Full verification + adversarial gate

**Files:**
- Create: `docs/gates/2026-06-18-sweep-consent-gating.md`

- [ ] **Step 1: Full local verification**

Run: `npx tsc --noEmit -p packages/connectors && npx tsc --noEmit -p apps/web`, `npx eslint apps/web/lib/sweep apps/web/lib/connections apps/web/lib/privacy apps/web/app/app/connections apps/web/app/app/settings/privacy apps/web/app/api`, and `npx vitest run`. All green.

- [ ] **Step 2: Reproduce SAST locally on changed files**

Run the pinned semgrep image (`semgrep scan --config p/default --error`) over the changed dirs; expect 0 findings. (If a test uses `createHmac` with a literal, pass the secret via a helper param — see `webhooks.test.ts`.)

- [ ] **Step 3: Run the adversarial gate + write the report**

Run the 4 reviewer personas (red-team / claims-auditor / logic-skeptic / cost-auditor) over the diff, verify each finding, and write `docs/gates/2026-06-18-sweep-consent-gating.md` (TEMPLATE.md). The **claims-auditor must confirm the consent copy matches behavior** (sent bodies processed by the model; no "not the raw messages" overclaim). Fix any P0/P1; track P2/P3.

- [ ] **Step 4: Commit + open the PR**

```bash
git add docs/gates/2026-06-18-sweep-consent-gating.md
git commit -m "docs(gate): adversarial gate report for sweep consent-gating"
git push -u origin feature/sweep-consent-gating
gh pr create --base main --title "feat(privacy): sweep consent-gating (affirmative opt-in + 12-month seed)" --body "<summary + closes the consent follow-up>"
```

---

## Self-Review

- **Spec coverage:** both capture surfaces (Task 8 checkbox + panel toggle), default-off (Global Constraints + unchecked checkbox), pending threading (Tasks 2–3), dispatch gate + worker enforcement (Tasks 4–5), 12-month window (Task 6), copy fixes incl. #132 (Tasks 8), migration dev/staging/prod (Task 1), gate (Task 9). ✓
- **Open confirmation during impl:** the absolute-origin source for the panel-action's internal sweep POST (`NEXT_PUBLIC_APP_ORIGIN` vs the codebase's existing origin helper) — resolve to the existing convention (the callback uses `request.url`; the panel has no request, so use the app's canonical origin helper).
- **Type consistency:** `sweepConsent` (camel) on TS types; `sweep_consent` / `sweep_consent_at` / `sweep_consent_by` (snake) in SQL/rows; `onGmailConnected` used by both the callback (Task 4) and the panel action (Task 7) with the same signature. ✓
- **Note:** `connections.sweep_consent_at` is read by the panel via the user-session client — confirm the connections RLS select policy lets an account member read it (it already selects provider/scopes/status today, so the new column is covered by the same row policy). ✓
