# Data & Privacy Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web app a **Data & Privacy** settings section — the single privacy "home" the audit found missing — that surfaces what the field study does and doesn't capture (with accurate copy), the data-retention windows, the account-deletion clock, and a route to connection/credential management, all wired to state and routes that already exist.

**Architecture:** A new `privacy` tab in the existing `SettingsNav`, plus a new server-component page `/app/settings/privacy` built exactly like the existing `account`/`profile` pages (`AppShell` → eyebrow/heading → `SettingsNav` → `Card`s; data via `appSession()`). The only non-trivial logic — summarizing connections and deriving the deletion-clock state — is extracted into a pure `lib/privacy/panel.ts` module with vitest coverage (the repo tests lib logic, not React components). The page itself is thin and verified by the type checker.

**Tech Stack:** Next.js App Router (server components), Supabase SSR client (`appSession`), the shared `components/ui` kit (`Card`/`Button`/`Badge`/`InlineFeedback`), Vitest (node-only).

**Source spec:** `docs/superpowers/specs/2026-06-17-trust-and-controls-design.md` §6.1 (requirements T5, T6; supporting T12/T15 via links to existing surfaces; principles TC-P1, TC-P2). Copy follows `.claude/skills/brand-voice/SKILL.md` and the accurate claims in `reference/privacy.html` / `reference/data-ai.html`.

---

## Scope & explicit non-goals

**In scope (this plan):** the panel + tab + accurate informational copy (T5/T6); surfacing the deletion clock (reads `accounts.purge_after`) and a link to the Account danger zone (T15 via link); surfacing a connections summary + a link to the existing `/app/connections` revoke UI (T12 via link).

**Explicitly deferred (NOT this plan, by design):**
- **The C11 / contribution opt-out toggle (T9/T10/T11).** It requires the D1-A migration (flip the `training_opt_in` default + backfill existing accounts to on) — a production consent change gated on the user's sign-off and the open #46 attorney review. This plan's "Model improvement" section therefore states only firm, already-true facts and links to the policy; it makes **no** definitive training claim, because the current `reference/privacy.html` copy ("your content … unless you opt out") contradicts the locked R48 (never train on content) and resolving that is the deferred work.
- **Notification-channel preferences (T13)** — needs the AS-§13 schema; separate plan.
- Routing the legal pages `/privacy` `/data-ai` `/subprocessors` (T7/T8) — separate plan (gated on #46).

## File Structure

- **Modify** `apps/web/components/settings/SettingsNav.tsx` — add the `privacy` tab to the `SettingsTab` union, the `TABS` array, and a `TabIcon` shield path.
- **Create** `apps/web/lib/privacy/panel.ts` — pure helpers `connectionSummary` + `deletionState`.
- **Create** `apps/web/lib/privacy/panel.test.ts` — vitest coverage of those helpers.
- **Create** `apps/web/app/app/settings/privacy/page.tsx` — the server-component page.

---

### Task 1: Add the Data & Privacy tab to `SettingsNav`

**Files:**
- Modify: `apps/web/components/settings/SettingsNav.tsx`

- [ ] **Step 1: Extend the tab union and list**

In `SettingsNav.tsx`, change the `SettingsTab` type (currently `'profile' | 'security' | 'account' | 'billing'`) to include `'privacy'`, and add the entry to `TABS` after Security:

```tsx
export type SettingsTab = 'profile' | 'security' | 'privacy' | 'account' | 'billing';

const TABS: { key: SettingsTab; label: string; href: string }[] = [
  { key: 'profile', label: 'Profile', href: '/app/settings/profile' },
  { key: 'security', label: 'Security', href: '/app/settings/security' },
  { key: 'privacy', label: 'Data & Privacy', href: '/app/settings/privacy' },
  { key: 'account', label: 'Account', href: '/app/settings/account' },
  { key: 'billing', label: 'Plan & credits', href: '/billing' },
];
```

- [ ] **Step 2: Add the tab icon**

The `TabIcon` component switches on the tab key via the `paths` record. Add a `privacy` entry (a shield — matches the security/lock visual family, distinct from the lock used by `security`):

```tsx
    privacy: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
```

Place it inside the `paths: Record<SettingsTab, ReactNode>` object alongside `profile`/`security`/`account`/`billing` (the `Record<SettingsTab, …>` type forces this entry to exist once the union gains `privacy`, so omitting it is a compile error — a built-in check).

- [ ] **Step 3: Typecheck**

Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web`
Expected: no errors. (If `paths` errors with "property 'privacy' is missing", Step 2 was skipped.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/settings/SettingsNav.tsx
git commit -m "feat(web): add Data & Privacy tab to settings nav"
```

---

### Task 2: Pure helpers for the panel view-model

**Files:**
- Create: `apps/web/lib/privacy/panel.ts`
- Test: `apps/web/lib/privacy/panel.test.ts`

The only real logic in the page — summarizing connections (mirroring the connections page's "Read-only access when no scopes" rule) and deriving the deletion-clock state — lives here so it is unit-tested in node.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/privacy/panel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { connectionSummary, deletionState, type ConnectionRow } from './panel';

describe('connectionSummary', () => {
  it('counts connections and labels access by scope count', () => {
    const rows: ConnectionRow[] = [
      { provider: 'gmail', scopes: ['a', 'b'], status: 'active' },
      { provider: 'stripe', scopes: ['x'], status: 'active' },
    ];
    const s = connectionSummary(rows);
    expect(s.total).toBe(2);
    expect(s.items[0]).toEqual({ provider: 'gmail', access: '2 scopes', status: 'active' });
    expect(s.items[1]).toEqual({ provider: 'stripe', access: '1 scope', status: 'active' });
  });

  it('labels empty or null scopes as read-only access', () => {
    const rows: ConnectionRow[] = [
      { provider: 'gmail', scopes: [], status: 'active' },
      { provider: 'calendar', scopes: null, status: 'paused' },
    ];
    const s = connectionSummary(rows);
    expect(s.items[0].access).toBe('Read-only access');
    expect(s.items[1].access).toBe('Read-only access');
    expect(s.items[1].status).toBe('paused');
  });

  it('handles an empty list', () => {
    expect(connectionSummary([])).toEqual({ total: 0, items: [] });
  });
});

describe('deletionState', () => {
  it('is not pending when purge_after is null/undefined', () => {
    expect(deletionState(null)).toEqual({ pending: false, date: null });
    expect(deletionState(undefined)).toEqual({ pending: false, date: null });
  });

  it('is pending and carries the date when purge_after is set', () => {
    expect(deletionState('2026-07-01T00:00:00Z')).toEqual({
      pending: true,
      date: '2026-07-01T00:00:00Z',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/Nibbin && npx vitest run apps/web/lib/privacy/panel.test.ts`
Expected: FAIL — `./panel` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `apps/web/lib/privacy/panel.ts`:

```ts
/**
 * Pure view-model helpers for the Data & Privacy settings panel (T&C spec §6.1).
 * Kept framework-free so the panel's only real logic is unit-tested in node;
 * the page itself stays a thin server component.
 */

export interface ConnectionRow {
  provider: string;
  scopes: string[] | null;
  status: string;
}

export interface ConnectionSummary {
  total: number;
  items: { provider: string; access: string; status: string }[];
}

/** Summarize non-revoked connections for display. Mirrors the connections
 * page's rule: no scopes → "Read-only access" (read-only is the default until
 * a Nibbin requests writes, C8). */
export function connectionSummary(rows: ConnectionRow[]): ConnectionSummary {
  const items = rows.map((r) => {
    const n = r.scopes?.length ?? 0;
    return {
      provider: r.provider,
      access: n > 0 ? `${n} scope${n === 1 ? '' : 's'}` : 'Read-only access',
      status: r.status,
    };
  });
  return { total: items.length, items };
}

export interface DeletionState {
  pending: boolean;
  date: string | null;
}

/** Derive the account-deletion clock state from accounts.purge_after. */
export function deletionState(purgeAfter: string | null | undefined): DeletionState {
  return { pending: !!purgeAfter, date: purgeAfter ?? null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/Nibbin && npx vitest run apps/web/lib/privacy/panel.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/privacy/panel.ts apps/web/lib/privacy/panel.test.ts
git commit -m "feat(web): privacy panel view-model helpers + tests"
```

---

### Task 3: The Data & Privacy page

**Files:**
- Create: `apps/web/app/app/settings/privacy/page.tsx`

Mirrors `account/page.tsx` exactly (imports, `AppShell`/`SettingsNav`/`Card` skeleton, `appSession()`, `dynamic`). Copy is sentence-case, uses locked vocabulary (Field Study, diagnosis, Nibbins, grove), and follows the accuracy rules: "banking, health, and other sensitive categories" (never "personal sites"); secure fields "can't be captured"; **no** "<100ms" latency claim; **no** OS-flag mechanism claim; **no** definitive model-training claim (deferred per the plan's non-goals).

- [ ] **Step 1: Write the page**

Create `apps/web/app/app/settings/privacy/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { AppShell } from '../../../../components/shell/AppShell';
import { SettingsNav } from '../../../../components/settings/SettingsNav';
import { Card, Button, Badge } from '../../../../components/ui';
import { connectionSummary, deletionState, type ConnectionRow } from '../../../../lib/privacy/panel';
import styles from '../../../../components/settings/settings.module.css';

export const metadata: Metadata = { title: 'Data & Privacy — Settings · Nibbin' };
export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function PrivacySettingsPage() {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, user, accountId } = session;

  const { data: acct } = await supabase
    .from('accounts')
    .select('purge_after')
    .eq('id', accountId)
    .single<{ purge_after: string | null }>();
  const del = deletionState(acct?.purge_after);

  const { data: conns } = await supabase
    .from('connections')
    .select('provider, scopes, status')
    .eq('account_id', accountId)
    .neq('status', 'revoked');
  const summary = connectionSummary((conns ?? []) as ConnectionRow[]);

  return (
    <AppShell active="settings" title="Settings" email={user.email}>
      <p className={styles.eyebrow}>Account</p>
      <h1 className={styles.heading}>Settings</h1>
      <SettingsNav active="privacy" />

      <div className={styles.section}>
        <Card>
          <h2 className={styles.sectionTitle}>What the Field Study sees</h2>
          <p className={styles.sectionHint}>
            The two-week Field Study runs on your device. Banking, health, and other sensitive
            categories are excluded by default, secure fields like passwords can&apos;t be captured,
            and you can exclude any app or site or pause everything with one hotkey.
          </p>
          <p className={styles.dangerNote}>
            Only the redacted synthesis packet ever leaves your device, and only when you choose to
            build your diagnosis. Your screen recordings never do — by architecture, not policy.
          </p>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>How long things are kept</h2>
          <ul className={styles.connList}>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Raw Field Study data</span>
                <span className={styles.connScopes}>On your device, until your diagnosis is built — 14 days max.</span>
              </div>
            </li>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Agent run logs</span>
                <span className={styles.connScopes}>90 days by default; shorten or wipe them anytime.</span>
              </div>
            </li>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Connection tokens</span>
                <span className={styles.connScopes}>Held in an encrypted vault while connected; one-click revoke.</span>
              </div>
            </li>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Account data</span>
                <span className={styles.connScopes}>Life of the account, plus 30 days after verified deletion.</span>
              </div>
            </li>
          </ul>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Connections</h2>
          <p className={styles.sectionHint}>
            {summary.total === 0
              ? 'No tools are connected yet. Connections start read-only — a Nibbin asks for write access separately, in plain words.'
              : `You have ${summary.total} connected ${summary.total === 1 ? 'tool' : 'tools'}. Connections start read-only; write access is granted per Nibbin, by you.`}
          </p>
          {summary.total > 0 && (
            <ul className={styles.connList}>
              {summary.items.map((c) => (
                <li key={c.provider} className={styles.connItem}>
                  <div className={styles.connMain}>
                    <span className={styles.connProvider}>{c.provider}</span>
                    <span className={styles.connScopes}>{c.access}</span>
                  </div>
                  <Badge tone={c.status === 'active' ? 'moss' : 'neutral'}>{c.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <Link href="/app/connections">
              <Button variant="secondary">Manage connections</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Model improvement</h2>
          <p className={styles.sectionHint}>
            We never sell your data, and we don&apos;t share it for advertising. How your data helps
            improve Nibbin — and your control over it — is covered in our privacy policy. The
            in-app opt-out control is on its way as we finish building this panel.
          </p>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Your data</h2>
          {del.pending && del.date ? (
            <>
              <Badge tone="coral">Scheduled for deletion</Badge>
              <p className={styles.dangerNote} style={{ marginTop: 10 }}>
                Your account is scheduled to be permanently deleted on {formatDate(del.date)}. Every
                connection has already been disconnected. You can stop this from the Account tab.
              </p>
            </>
          ) : (
            <p className={styles.sectionHint}>
              You can delete your account and everything in it — your grove, your Nibbins, your
              diagnosis, and every connection — from the Account tab. On the desktop app, “Delete
              everything” wipes the captured study data on this machine and verifies it&apos;s gone.
            </p>
          )}
          <div className={styles.actions}>
            <Link href="/app/settings/account">
              <Button variant="secondary">Go to Account</Button>
            </Link>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Verify the UI kit exports used here exist**

Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web`
Expected: no errors. Verified valid: `Button` variants are `'primary' | 'secondary' | 'ghost' | 'danger'`; `Badge` tones are `'neutral' | 'moss' | 'honey' | 'coral' | 'sky'`. The page uses only `secondary`, `moss`, `coral`, and `neutral` — all valid. If tsc flags any prop, fix it to a valid union member from `components/ui` rather than inventing one.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/app/settings/privacy/page.tsx
git commit -m "feat(web): Data & Privacy settings page"
```

---

### Task 4: Final verification

- [ ] **Step 1: Full typecheck + the new unit tests**

Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web && npx vitest run apps/web/lib/privacy/panel.test.ts`
Expected: tsc exit 0; 5 tests pass.

- [ ] **Step 2: Copy-accuracy guard (no over-claims)**

Run: `cd /c/Nibbin && grep -niE "personal sites|<\s*100\s*ms|100ms|os flag|os-flag|never trains? on your" apps/web/app/app/settings/privacy/page.tsx || echo "CLEAN"`
Expected: `CLEAN` — none of the banned/over-claiming phrases appear (no "personal sites", no latency number, no OS-flag mechanism claim, no definitive training claim).

- [ ] **Step 3: Commit (only if Step 2 required a copy fix; otherwise skip)**

```bash
git add apps/web/app/app/settings/privacy/page.tsx
git commit -m "fix(web): privacy copy accuracy"
```

---

## Self-review notes (verified against the spec)

- **T5 covered** — Task 1 (tab) + Task 3 (the page) create the Data & Privacy home that did not exist.
- **T6 covered** — the page links local/desktop guidance ("Delete everything" on desktop) and the account-level controls; a parallel desktop group is a follow-up.
- **T12 (via link)** — connections summary + "Manage connections" → the existing `/app/connections` revoke UI; no duplication of revoke logic.
- **T15 (via link)** — deletion-clock state shown; "Go to Account" → the existing danger zone; desktop delete-everything described.
- **TC-P1 (promise = behavior)** — copy uses accurate phrasing; the copy-accuracy guard (Task 4 Step 2) asserts no over-claims; the model-training claim is deliberately omitted pending D1-A + #46.
- **TC-P2 (reachable)** — privacy controls now have a discoverable home in settings.
- **Deferred-with-reason** — C11 toggle (needs D1-A migration + consent sign-off), notification prefs (needs AS-§13 schema), legal-page routing (#46). All called out in Scope, none silently dropped.
- **Test boundary** — logic (`connectionSummary`/`deletionState`) is unit-tested in node (repo convention); the server-component page is tsc-verified (no RTL/jsdom in this repo).
- **Type consistency** — `connectionSummary`, `deletionState`, `ConnectionRow`, `ConnectionSummary`, `DeletionState` names are used identically across Task 2 and Task 3.
```
