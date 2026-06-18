# Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the side-nav "Leaves" entry with a real **Notification Center** — a top-bar bell + unread badge that opens a dropdown of recent leaves, each click-through to its source, with mark-read + mark-all-read — keeping `/app/notifications` as the full archive.

**Architecture:** A client `NotificationBell` lives in the existing `AppShell` top bar. It self-fetches via **server actions** (no new `/api` route → no security-gate, no migration). Notifications already exist (`notifications` table: `kind`/`title`/`body`/`payload` jsonb/`read_at`; `mark_notification_read(uuid)` RPC; beats already carry `ctaPath`/`ctaLabel` in `payload` — that's the click-through). Design strictly follows the system tokens + brand voice (see "Design contract").

**Tech stack:** Next.js App Router (client component + server actions), the existing CSS-module + design tokens. No DB changes, no sensitive-surface paths (`packages/drip|runtime|keeper|router`, `supabase/migrations`, `apps/web/app/api`, `apps/desktop/src-tauri` are all untouched) → **no gate report required**.

**Source:** Trust & Controls CE12 / the user's Notification Center ask. Placement decided: **top-bar bell** (global).

## Design contract (match exactly — tokens from `shell.module.css` + `reference/nibbin-style-guide.html`)
- Palette: `--canopy` (surface), `--paper`, `--understory` (hover/recessed), `--line` (borders), `--ink`/`--ink-soft`/`--ink-faint` (text tiers), `--moss`/`--moss-deep`/`--moss-tint`. **Unread badge = `--moss`** (calm/earned, NOT coral — coral is danger-only). `--mono` for eyebrows/time/badge, `--display` for headings.
- Radii `--r-card` (10px, dropdown), `--r-button`/`--r-btn`, `--r-pill` (badge). Shadow `--shadow-2` (dropdown). Motion `--dur-2`/`--ease-settle`; **respect `prefers-reduced-motion`**.
- Brand voice: "From the grove" eyebrow; "Mark all read"; "See all leaves"; empty state reuses the existing copy. Sentence case; locked vocab (leaves, grove, Nibbins). Principle: *trust is visible, not cute* — clear list, real timestamps.

## File structure
- **Create** `apps/web/app/app/notifications/actions.ts` — `listLeaves`, `markRead`, `markAllRead` (server actions).
- **Create** `apps/web/components/shell/NotificationBell.tsx` — the client bell + dropdown.
- **Create** `apps/web/components/shell/notification-center.module.css` — styles (tokens only).
- **Modify** `apps/web/components/shell/AppShell.tsx` — render the bell in the top bar; remove `notifications` from `NAV` (keep the `NavKey` union).
- **Modify** `apps/web/app/app/notifications/page.tsx` — reuse `markRead` from the new actions (de-dupe the inline one); unchanged otherwise (stays the archive).

---

### Task 1: Server actions

**Files:** Create `apps/web/app/app/notifications/actions.ts`

- [ ] **Step 1: Write the actions** (mirrors the page's existing auth/RLS pattern)

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';

export interface Leaf {
  id: string;
  kind: 'beat' | 'evolution' | 'graduation';
  title: string;
  body: string;
  ctaPath: string | null;
  ctaLabel: string | null;
  createdAt: string;
  read: boolean;
}

async function resolve() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const accountId = await ensureAccount({
    getEmail: async () => user.email ?? null,
    ensureProfile: () => upsertOwnProfile(supabase, user),
    bootstrap: async (name) => {
      const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
      if (error) throw error;
      return data as string;
    },
  });
  return { supabase, accountId };
}

/** Recent leaves + unread count for the bell. RLS-scoped to the caller. */
export async function listLeaves(limit = 12): Promise<{ items: Leaf[]; unread: number }> {
  const ctx = await resolve();
  if (!ctx) return { items: [], unread: 0 };
  const { supabase, accountId } = ctx;
  const { data } = await supabase
    .from('notifications')
    .select('id, kind, title, body, payload, created_at, read_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<{
    id: string; kind: Leaf['kind']; title: string; body: string;
    payload: { ctaPath?: string; ctaLabel?: string } | null; created_at: string; read_at: string | null;
  }>;
  const items: Leaf[] = rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body,
    ctaPath: r.payload?.ctaPath ?? null, ctaLabel: r.payload?.ctaLabel ?? null,
    createdAt: r.created_at, read: r.read_at != null,
  }));
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('read_at', null);
  return { items, unread: count ?? 0 };
}

export async function markRead(id: string): Promise<void> {
  const ctx = await resolve();
  if (!ctx) return;
  await ctx.supabase.rpc('mark_notification_read', { target_id: id });
  revalidatePath('/app/notifications');
}

/** No bulk RPC exists (client writes are RLS-revoked); mark each unread leaf via
 *  the security-definer RPC. Bounded — the list is capped. */
export async function markAllRead(): Promise<void> {
  const ctx = await resolve();
  if (!ctx) return;
  const { supabase, accountId } = ctx;
  const { data } = await supabase
    .from('notifications')
    .select('id')
    .eq('account_id', accountId)
    .is('read_at', null)
    .limit(200);
  for (const row of (data ?? []) as Array<{ id: string }>) {
    await supabase.rpc('mark_notification_read', { target_id: row.id });
  }
  revalidatePath('/app/notifications');
}
```

- [ ] **Step 2:** `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → no errors. Commit: `feat(web): notification server actions (list/markRead/markAllRead)`.

---

### Task 2: The bell + dropdown (client) + styles

**Files:** Create `NotificationBell.tsx` + `notification-center.module.css`

- [ ] **Step 1: Styles** — `apps/web/components/shell/notification-center.module.css` (tokens only; reduced-motion):

```css
.wrap { position: relative; display: flex; align-items: center; }
.bell {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border: 1px solid var(--line); border-radius: var(--r-button);
  background: var(--canopy); color: var(--ink); cursor: pointer;
  transition: background var(--dur-1) var(--ease-settle);
}
.bell:hover { background: var(--understory); }
.badge {
  position: absolute; top: -5px; right: -5px; min-width: 17px; height: 17px; padding: 0 4px;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: 10px; font-weight: 600; line-height: 1;
  background: var(--moss); color: var(--canopy); border-radius: var(--r-pill);
  border: 2px solid var(--paper);
}
.panel {
  position: absolute; top: calc(100% + 10px); right: 0; width: 360px; max-width: 92vw;
  background: var(--canopy); border: 1px solid var(--line); border-radius: var(--r-card);
  box-shadow: var(--shadow-2); z-index: 40; overflow: hidden;
  animation: ncIn var(--dur-2) var(--ease-settle);
}
@keyframes ncIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid var(--line);
}
.eyebrow { font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--moss-deep); font-weight: 600; }
.headAction { font: inherit; font-size: 12px; font-weight: 600; color: var(--moss-deep); background: none; border: none; cursor: pointer; padding: 2px 4px; }
.headAction:hover { text-decoration: underline; }
.headAction:disabled { color: var(--ink-faint); cursor: default; text-decoration: none; }
.list { max-height: 60vh; overflow-y: auto; }
.leaf {
  display: block; width: 100%; text-align: left; padding: 12px 14px; border: none;
  border-bottom: 1px solid var(--line); background: none; cursor: pointer; color: inherit;
  transition: background var(--dur-1) var(--ease-settle); text-decoration: none;
}
.leaf:hover { background: var(--understory); }
.leaf:last-child { border-bottom: none; }
.leafUnread { background: var(--moss-tint); }
.leafUnread:hover { background: var(--moss-tint); }
.leafTitle { font-weight: 700; font-size: 13.5px; color: var(--ink); margin: 0 0 2px; }
.leafBody { font-size: 12.5px; color: var(--ink-soft); margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.leafTime { font-family: var(--mono); font-size: 10px; color: var(--ink-faint); margin-top: 4px; display: block; }
.empty { padding: 22px 16px; font-size: 13px; color: var(--ink-soft); }
.foot { padding: 10px 14px; border-top: 1px solid var(--line); text-align: center; }
.footLink { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--moss-deep); text-decoration: none; }
.footLink:hover { text-decoration: underline; }
@media (prefers-reduced-motion: reduce) {
  .panel { animation: none; }
  .bell, .leaf { transition: none; }
}
```

- [ ] **Step 2: The component** — `apps/web/components/shell/NotificationBell.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listLeaves, markRead, markAllRead, type Leaf } from '../../app/app/notifications/actions';
import styles from './notification-center.module.css';

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Leaf[]>([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    void listLeaves().then((r) => { setItems(r.items); setUnread(r.unread); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Close on outside-click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function toggle() {
    setOpen((v) => { if (!v) refresh(); return !v; });
  }

  function activate(leaf: Leaf) {
    if (!leaf.read) {
      setItems((xs) => xs.map((x) => (x.id === leaf.id ? { ...x, read: true } : x)));
      setUnread((n) => Math.max(0, n - 1));
      void markRead(leaf.id);
    }
    if (leaf.ctaPath) { setOpen(false); router.push(leaf.ctaPath); }
  }

  function clearAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    setUnread(0);
    void markAllRead();
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bell}
        aria-label={unread > 0 ? `Leaves, ${unread} unread` : 'Leaves'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
          <path d="M2 21c0-3 1.85-5.36 5.08-6" />
        </svg>
        {unread > 0 && <span className={styles.badge}>{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="menu" aria-label="Leaves">
          <div className={styles.head}>
            <span className={styles.eyebrow}>From the grove</span>
            <button type="button" className={styles.headAction} onClick={clearAll} disabled={unread === 0}>
              Mark all read
            </button>
          </div>
          <div className={styles.list}>
            {items.length === 0 ? (
              <p className={styles.empty}>
                Nothing here yet. When your grove has something for you — Field Notes, a training session,
                someone close to graduating — a leaf lands here.
              </p>
            ) : (
              items.map((leaf) =>
                leaf.ctaPath ? (
                  <button key={leaf.id} type="button" role="menuitem"
                    className={`${styles.leaf} ${leaf.read ? '' : styles.leafUnread}`} onClick={() => activate(leaf)}>
                    <p className={styles.leafTitle}>{leaf.title}</p>
                    <p className={styles.leafBody}>{leaf.body}</p>
                    <span className={styles.leafTime}>{relTime(leaf.createdAt)}</span>
                  </button>
                ) : (
                  <button key={leaf.id} type="button" role="menuitem"
                    className={`${styles.leaf} ${leaf.read ? '' : styles.leafUnread}`} onClick={() => activate(leaf)}>
                    <p className={styles.leafTitle}>{leaf.title}</p>
                    <p className={styles.leafBody}>{leaf.body}</p>
                    <span className={styles.leafTime}>{relTime(leaf.createdAt)}</span>
                  </button>
                ),
              )
            )}
          </div>
          <div className={styles.foot}>
            <Link href="/app/notifications" className={styles.footLink} onClick={() => setOpen(false)}>
              See all leaves
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
```

(Note: both branches of the `leaf.ctaPath` ternary are intentionally the same button — `activate` handles navigation; kept explicit so a future Link-based variant is a drop-in. If the reviewer prefers, collapse to one button.)

- [ ] **Step 3:** `npx tsc --noEmit -p apps/web` → clean. Commit: `feat(web): NotificationBell dropdown + styles (design-token-matched)`.

---

### Task 3: Wire into the shell + drop the nav entry

**Files:** Modify `apps/web/components/shell/AppShell.tsx`

- [ ] **Step 1:** Import the bell: `import { NotificationBell } from './NotificationBell';`
- [ ] **Step 2:** Remove the `{ key: 'notifications', label: 'Leaves', href: '/app/notifications' }` line from the `NAV` array (leave the `NavKey` union and the `notifications` `NavIcon` entry intact — the page still passes `active="notifications"`, harmlessly).
- [ ] **Step 3:** In the top bar's `.account` block, render the bell before the email (hidden during onboarding, matching the locked-nav intent):

```tsx
          <div className={styles.account}>
            {!onboarding && <NotificationBell />}
            {email ? <span className={styles.email}>{email}</span> : null}
            <form action="/auth/signout" method="post">
              <button className={styles.signout} type="submit">
                Sign out
              </button>
            </form>
          </div>
```

- [ ] **Step 4:** `npx tsc --noEmit -p apps/web` → clean. Commit: `feat(web): mount Notification Center bell in the top bar; remove Leaves from side nav`.

---

### Task 4: De-dupe the archive page's markRead

**Files:** Modify `apps/web/app/app/notifications/page.tsx`

- [ ] **Step 1:** Replace the page's inline `markRead` server action with an import from the new actions file: `import { markRead } from './actions';` and delete the local `async function markRead(...)`. The page's `<form action={markRead}>` currently passes the `id` via a hidden input as `FormData`; the new `markRead(id: string)` takes a string. Adapt the form to call it: wrap in an inline server action OR change the page's form handler to read FormData and call `markRead(String(formData.get('id')))`. Keep the page otherwise unchanged (it stays the full archive).
- [ ] **Step 2:** `npx tsc --noEmit -p apps/web` → clean. Commit: `refactor(web): notifications archive reuses shared markRead action`.

---

### Task 5: Verify
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.
- [ ] `cd /c/Nibbin && npx vitest run apps/web/lib/ packages/drip/test` → no regressions (we changed no tested logic; sanity).
- [ ] Manual/visual (if a dev server is available): bell shows in the top bar with a moss badge when unread; dropdown opens with the calm motion, lists leaves, click-through navigates + marks read, "Mark all read" clears the badge, "See all leaves" → the archive; "Leaves" is gone from the side nav; reduced-motion disables the animation.

## Self-review notes
- **Gate-free:** touches only `apps/web/app/app/notifications/*`, `apps/web/components/shell/*` — none in the CI sensitive-path regex; no migration. Server actions, not an `/api` route.
- **Design contract honored:** moss (not coral) badge; `--shadow-2` card; `--dur-2/--ease-settle` + reduced-motion; mono eyebrow; "From the grove" / "Mark all read" / "See all leaves" brand voice; unread rows tinted `--moss-tint`.
- **Click-to-source** reuses the existing `payload.ctaPath` (beats already set it; earned/graduation leaves get it in the follow-on enrichment).
- **No bulk-read RPC** → `markAllRead` loops the existing security-definer RPC (bounded), staying gate- and migration-free.
- Archive page kept as the "See all" target; side-nav entry removed per the decision.
