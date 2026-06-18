# Notification Preferences (Companion Email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users control the notifications that actually exist today — the 14-day companion **email** arc — from the Data & Privacy panel: turn the emails on/off and set quiet hours.

**Architecture:** `drip_arcs` already stores `email_enabled` + `quiet_start`/`quiet_end` per account but allows **no direct client writes** (RLS revokes insert/update/delete; mutation is security-definer-RPC-only). Add an **update-only** `set_notification_prefs` RPC (member-checked, audited) — update-only because the drip worker owns row creation (`insert … on conflict do nothing`, keyed to onboarding; `started_at` anchors the arc), so creating the row here would mis-anchor the 14-day schedule. The panel reads `drip_arcs` (falling back to the schema defaults) and renders a checkbox + two hour selects. The parsing/formatting logic lives in a pure, unit-tested `lib/privacy/notifications.ts`.

**Tech Stack:** Postgres migration (Supabase), Next.js App Router server action + server component, the `components/ui` kit (`Select`/`Button`/`Card`/`Badge`/`InlineFeedback`), Vitest (node).

**Source spec:** `docs/superpowers/specs/2026-06-17-trust-and-controls-design.md` §7.4 (T13, the buildable slice); the full multi-channel system is a separate design (see the companion "reach-me / conversational channels" spec) and is explicitly out of scope here.

**Out of scope for the implementer (orchestrator handles):** applying the migration to dev/staging/prod (via MCP after review). This plan produces the migration FILE + the UI only; it does NOT apply to any database. Do NOT touch `reference/*.html`.

## File Structure
- **Create** `supabase/migrations/20260617140000_notification_prefs.sql` — the `set_notification_prefs` RPC (idempotent).
- **Create** `apps/web/lib/privacy/notifications.ts` — `formatHour`, `HOUR_OPTIONS`, `parseNotificationPrefs`.
- **Create** `apps/web/lib/privacy/notifications.test.ts` — vitest coverage.
- **Modify** `apps/web/app/app/settings/privacy/actions.ts` — add `setNotificationPrefs` server action.
- **Modify** `apps/web/app/app/settings/privacy/page.tsx` — read `drip_arcs`, render the Notifications card.

---

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/20260617140000_notification_prefs.sql`

- [ ] **Step 1: Write the migration**

Create the file. It mirrors the established security-definer + member-check + audit pattern (`set_model_contribution` in `20260617130000_model_contribution_optout.sql`), but UPDATE-only and with hour-range validation:

```sql
-- Notification preferences (T&C spec §7.4): let members control the companion
-- email arc — drip_arcs.email_enabled + quiet hours. drip_arcs allows no direct
-- client writes (RLS), so mutation goes through this security-definer RPC.
-- UPDATE-only by design: the drip worker owns row creation
-- (insert ... on conflict do nothing, keyed to onboarding; started_at anchors
-- the 14-day arc), so creating a row here would mis-anchor the arc. Pre-arc
-- accounts have nothing to update yet — the panel shows the schema defaults.

create or replace function public.set_notification_prefs(
  target_account uuid,
  email_enabled boolean,
  quiet_start smallint,
  quiet_end smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if quiet_start < 0 or quiet_start > 23 or quiet_end < 0 or quiet_end > 23 then
    raise exception 'quiet hours must be between 0 and 23';
  end if;
  update public.drip_arcs
     set email_enabled = set_notification_prefs.email_enabled,
         quiet_start = set_notification_prefs.quiet_start,
         quiet_end = set_notification_prefs.quiet_end
   where account_id = target_account;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.notification_prefs_set', target_account::text,
    jsonb_build_object('email_enabled', email_enabled, 'quiet_start', quiet_start, 'quiet_end', quiet_end));
end;
$$;
revoke execute on function public.set_notification_prefs(uuid, boolean, smallint, smallint) from public, anon, service_role;
grant execute on function public.set_notification_prefs(uuid, boolean, smallint, smallint) to authenticated;
```

- [ ] **Step 2: Do NOT apply it.** Confirm by re-reading that the param names are qualified (`set_notification_prefs.email_enabled` etc.) so there's no column/param ambiguity, and that the audit action string is `account.notification_prefs_set`. Report.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260617140000_notification_prefs.sql
git commit -m "feat(db): set_notification_prefs RPC (companion email + quiet hours)"
```

---

### Task 2: Pure helpers + tests

**Files:**
- Create: `apps/web/lib/privacy/notifications.ts`
- Test: `apps/web/lib/privacy/notifications.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/privacy/notifications.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatHour, HOUR_OPTIONS, parseNotificationPrefs } from './notifications';

describe('formatHour', () => {
  it('formats 12-hour clock with AM/PM', () => {
    expect(formatHour(0)).toBe('12 AM');
    expect(formatHour(9)).toBe('9 AM');
    expect(formatHour(12)).toBe('12 PM');
    expect(formatHour(21)).toBe('9 PM');
    expect(formatHour(23)).toBe('11 PM');
  });
});

describe('HOUR_OPTIONS', () => {
  it('has 24 entries, value 0..23, labelled', () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toEqual({ value: '0', label: '12 AM' });
    expect(HOUR_OPTIONS[23]).toEqual({ value: '23', label: '11 PM' });
  });
});

describe('parseNotificationPrefs', () => {
  function fd(entries: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.append(k, v);
    return f;
  }

  it('reads a checked checkbox as enabled and parses hours', () => {
    const p = parseNotificationPrefs(fd({ email_enabled: 'on', quiet_start: '21', quiet_end: '9' }));
    expect(p).toEqual({ emailEnabled: true, quietStart: 21, quietEnd: 9 });
  });

  it('treats a missing checkbox as disabled', () => {
    const p = parseNotificationPrefs(fd({ quiet_start: '0', quiet_end: '8' }));
    expect(p.emailEnabled).toBe(false);
  });

  it('clamps out-of-range or non-numeric hours into 0..23', () => {
    expect(parseNotificationPrefs(fd({ quiet_start: '99', quiet_end: '-3' }))).toMatchObject({
      quietStart: 23,
      quietEnd: 0,
    });
    expect(parseNotificationPrefs(fd({ quiet_start: 'x', quiet_end: '' }))).toMatchObject({
      quietStart: 0,
      quietEnd: 0,
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /c/Nibbin && npx vitest run apps/web/lib/privacy/notifications.test.ts`
Expected: FAIL — `./notifications` does not exist.

- [ ] **Step 3: Implement**

Create `apps/web/lib/privacy/notifications.ts`:

```ts
/** Pure helpers for the notification-preferences UI (T&C spec §7.4). */

/** 0..23 → "12 AM" / "9 PM" etc. */
export function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${period}`;
}

export const HOUR_OPTIONS: { value: string; label: string }[] = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: formatHour(h),
}));

/** Clamp any input to a valid hour (0..23); non-numeric → 0. */
function toHour(v: FormDataEntryValue | null): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(23, Math.max(0, n));
}

export interface NotificationPrefs {
  emailEnabled: boolean;
  quietStart: number;
  quietEnd: number;
}

export function parseNotificationPrefs(form: FormData): NotificationPrefs {
  return {
    emailEnabled: form.get('email_enabled') === 'on',
    quietStart: toHour(form.get('quiet_start')),
    quietEnd: toHour(form.get('quiet_end')),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd /c/Nibbin && npx vitest run apps/web/lib/privacy/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/privacy/notifications.ts apps/web/lib/privacy/notifications.test.ts
git commit -m "feat(web): notification-prefs parsing/formatting helpers + tests"
```

---

### Task 3: The Notifications card

**Files:**
- Modify: `apps/web/app/app/settings/privacy/actions.ts`
- Modify: `apps/web/app/app/settings/privacy/page.tsx`

- [ ] **Step 1: Add the server action**

Append to `apps/web/app/app/settings/privacy/actions.ts`:

```ts
import { parseNotificationPrefs } from '../../../../lib/privacy/notifications';

export async function setNotificationPrefs(formData: FormData) {
  const { emailEnabled, quietStart, quietEnd } = parseNotificationPrefs(formData);
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('set_notification_prefs', {
    target_account: accountId,
    email_enabled: emailEnabled,
    quiet_start: quietStart,
    quiet_end: quietEnd,
  });
  if (error) redirect('/app/settings/privacy?error=notify');
  redirect('/app/settings/privacy?state=notify_saved');
}
```

(The `appSession` and `redirect` imports already exist at the top of the file from the contribution action.)

- [ ] **Step 2: Read drip prefs + render the Notifications card**

In `apps/web/app/app/settings/privacy/page.tsx`:

(a) Add to the `components/ui` import: `Select`; and add to the actions import: `setNotificationPrefs`. Also import the hour options:

```tsx
import { Card, Button, Badge, InlineFeedback, Select } from '../../../../components/ui';
import { setContribution, setNotificationPrefs } from './actions';
import { HOUR_OPTIONS } from '../../../../lib/privacy/notifications';
```

(b) After the connections query, read the drip prefs (defaults from the schema if no arc row yet):

```tsx
  const { data: drip } = await supabase
    .from('drip_arcs')
    .select('email_enabled, quiet_start, quiet_end')
    .eq('account_id', accountId)
    .maybeSingle<{ email_enabled: boolean; quiet_start: number; quiet_end: number }>();
  const emailEnabled = drip?.email_enabled ?? true;
  const quietStart = drip?.quiet_start ?? 21;
  const quietEnd = drip?.quiet_end ?? 9;
```

(c) Insert a new "Notifications" `<Card>` into the `<div className={styles.section}>` (place it just before the "Model improvement" card). The form posts the whole prefs set; the checkbox uses a native input (the profile page uses native inputs the same way):

```tsx
        <Card>
          <h2 className={styles.sectionTitle}>Notifications</h2>
          <p className={styles.sectionHint}>
            During your field study, your grove sends a few gentle email nudges — Field Notes,
            milestones, your map when it’s ready. Turn them off or set quiet hours here. (Text and
            chat channels arrive when your Nibbins start doing real work.)
          </p>
          {state === 'notify_saved' && (
            <InlineFeedback tone="success">Saved — your notification choices are recorded.</InlineFeedback>
          )}
          {error === 'notify' && (
            <InlineFeedback tone="error">That didn’t save — give it another go.</InlineFeedback>
          )}
          <form action={setNotificationPrefs} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email_enabled">
                Companion emails
              </label>
              <label className={styles.fieldHint}>
                <input
                  id="email_enabled"
                  name="email_enabled"
                  type="checkbox"
                  defaultChecked={emailEnabled}
                />{' '}
                Email me the field-study nudges
              </label>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="quiet_start">
                Quiet hours start
              </label>
              <Select id="quiet_start" name="quiet_start" defaultValue={String(quietStart)} options={HOUR_OPTIONS} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="quiet_end">
                Quiet hours end
              </label>
              <Select id="quiet_end" name="quiet_end" defaultValue={String(quietEnd)} options={HOUR_OPTIONS} />
              <span className={styles.fieldHint}>No emails are sent during your quiet hours.</span>
            </div>
            <div className={styles.actions}>
              <Button type="submit" variant="primary">
                Save notifications
              </Button>
            </div>
          </form>
        </Card>
```

- [ ] **Step 3: Typecheck**

Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web`
Expected: no errors. (`Select` is exported from `components/ui` — the profile page uses it with `options={[{value,label}]}`.)

- [ ] **Step 4: Run the privacy lib tests**

Run: `cd /c/Nibbin && npx vitest run apps/web/lib/privacy/`
Expected: PASS — `panel.test.ts` (5) + `notifications.test.ts` (all).

- [ ] **Step 5: Copy-accuracy guard**

Run: `cd /c/Nibbin && grep -niE "personal sites|100ms|os.?flag|guarantee" apps/web/app/app/settings/privacy/page.tsx || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/app/settings/privacy/actions.ts apps/web/app/app/settings/privacy/page.tsx
git commit -m "feat(web): notifications card (companion email + quiet hours)"
```

---

## Self-review notes
- **T13 (buildable part)** — email on/off + quiet hours, wired to the existing `drip_arcs` via a member-checked, audited RPC. Multi-channel deferred to the reach-me/conversational design (out of scope, stated).
- **Security** — RPC mirrors the audited security-definer + `is_account_member` pattern; UPDATE-only (no arc-lifecycle interference); grants authenticated-only; hour-range validated server-side and clamped client-side.
- **Honest copy** — the card says text/chat channels arrive "when your Nibbins start doing real work" (no fake channel controls); no over-claims.
- **Test boundary** — parsing/formatting unit-tested in node; page tsc-verified.
- **Not applied here** — migration is a file; the orchestrator applies it to dev/staging/prod.
