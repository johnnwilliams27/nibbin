# Model-Improvement Contribution Opt-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a real, accurate control over Nibbin's **model-improvement contribution** — the anonymized, aggregate *structural* signals (R49), never content — in the Data & Privacy panel, backed by a correctly-named, opt-out / default-on account flag that supersedes the now-moot content-training-opt-in flag.

**Architecture:** A migration retires `accounts.training_opt_in` (+ `set_training_opt_in`) — read nowhere, and moot under the locked R48 invariant that Nibbin never trains on user content — and adds `accounts.model_contribution_enabled boolean not null default true` (the `default true` ADD COLUMN backfills every existing account to "on", the approved backfill) plus a `set_model_contribution` RPC that mirrors the existing audited, member-checked, security-definer pattern. The Data & Privacy panel's "Model improvement" card becomes a real toggle (server-action + form, no client JS), with copy that states the R48/R49 truth exactly.

**Tech Stack:** Postgres migration (Supabase), Next.js App Router server action + server component, the `components/ui` kit.

**Source spec:** `docs/superpowers/specs/2026-06-17-trust-and-controls-design.md` §7.1/§7.2 (T9/T10/T11); decision D1-A; principle TC-P7 (two-tier opt-out honesty: content-never vs structural-contribution-opt-out).

**Out of scope for the implementer (handled separately by the orchestrator):** applying the migration to dev/staging/prod (done via MCP after this code is reviewed), and the drafted-but-unpublished legal-copy correction in `reference/*.html` (#46-gated). This plan produces the migration FILE and the UI; it does NOT apply the migration to any database.

## File Structure
- **Create** `supabase/migrations/20260617130000_model_contribution_optout.sql` — retire the old flag/RPC, add the new column + RPC (idempotent).
- **Create** `apps/web/app/app/settings/privacy/actions.ts` — the `setContribution` server action.
- **Modify** `apps/web/app/app/settings/privacy/page.tsx` — read the new column, render the toggle.

---

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/20260617130000_model_contribution_optout.sql`

- [ ] **Step 1: Write the migration**

Create the file with exactly this content. It mirrors the existing `set_training_opt_in` definition (`20260612120000_m65_budget_cogs.sql:157-179`) — security definer, `search_path=''`, `private.is_account_member` check, `audit_log` insert — and is idempotent so a re-apply is safe:

```sql
-- Model-improvement contribution (R49; T&C spec §7.1, decision D1-A).
-- Nibbin never trains on user CONTENT (R48) — so the old training_opt_in flag
-- ("opt IN to content training", default off, read nowhere) is moot and
-- contradicts the invariant. Replace it with the R49 control: contribute
-- anonymized, aggregate STRUCTURAL signals (capability/model performance) —
-- never content, never per-user. Opt-out, default ON. Adding the column with
-- default true backfills every existing account to "on" (the approved backfill).

alter table public.accounts
  add column if not exists model_contribution_enabled boolean not null default true;

create or replace function public.set_model_contribution(target_account uuid, enabled boolean)
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
  update public.accounts set model_contribution_enabled = enabled where id = target_account;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.model_contribution_set', target_account::text,
    jsonb_build_object('enabled', enabled));
end;
$$;
revoke execute on function public.set_model_contribution(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_model_contribution(uuid, boolean) to authenticated;

-- Retire the superseded content-training-opt-in flag + RPC (read nowhere).
drop function if exists public.set_training_opt_in(uuid, boolean);
alter table public.accounts drop column if exists training_opt_in;
```

- [ ] **Step 2: Sanity-check the SQL parses (no DB apply)**

Do NOT apply this to any database (the orchestrator applies it via MCP). Just confirm the file is syntactically consistent with the m65 reference by re-reading both side by side. Report any divergence from the reference RPC pattern.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260617130000_model_contribution_optout.sql
git commit -m "feat(db): model_contribution_enabled flag + RPC (retire training_opt_in)"
```

---

### Task 2: The contribution toggle in the Data & Privacy panel

**Files:**
- Create: `apps/web/app/app/settings/privacy/actions.ts`
- Modify: `apps/web/app/app/settings/privacy/page.tsx`

- [ ] **Step 1: Write the server action**

Create `apps/web/app/app/settings/privacy/actions.ts`, mirroring `account/actions.ts` (server action → `supabase.rpc` → redirect):

```ts
'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';

/** Toggle model-improvement contribution (R49 structural signals; T&C §7.1).
 * The hidden `enabled` field carries the target value ('true' | 'false'). */
export async function setContribution(formData: FormData) {
  const enabled = formData.get('enabled') === 'true';
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('set_model_contribution', {
    target_account: accountId,
    enabled,
  });
  if (error) redirect('/app/settings/privacy?error=contribution');
  redirect('/app/settings/privacy?state=saved');
}
```

- [ ] **Step 2: Read the flag + render the toggle**

In `apps/web/app/app/settings/privacy/page.tsx`:

(a) Add `searchParams` to the component signature and read it (mirrors `account/page.tsx`):

```tsx
export default async function PrivacySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; error?: string }>;
}) {
  const { state, error } = await searchParams;
```

(b) Add the new imports — `InlineFeedback` to the `components/ui` import line, and the action:

```tsx
import { Card, Button, Badge, InlineFeedback } from '../../../../components/ui';
import { setContribution } from './actions';
```

(c) Extend the accounts query to include the new column and derive the value:

```tsx
  const { data: acct } = await supabase
    .from('accounts')
    .select('purge_after, model_contribution_enabled')
    .eq('id', accountId)
    .single<{ purge_after: string | null; model_contribution_enabled: boolean }>();
  const del = deletionState(acct?.purge_after);
  const contributing = acct?.model_contribution_enabled ?? true;
```

(d) Replace the entire existing "Model improvement" `<Card>…</Card>` (the one whose copy currently says the opt-out control "is on its way") with this real toggle. The copy states the R48/R49 truth exactly — content is never trained; the control is over anonymized structural signals:

```tsx
        <Card>
          <h2 className={styles.sectionTitle}>Model improvement</h2>
          <p className={styles.sectionHint}>
            Nibbin never trains on your content. When this is on, Nibbin learns from anonymized,
            aggregate signals about how its capabilities and models perform — never your data,
            never your content, and never sold. You can turn it off anytime.
          </p>
          {state === 'saved' && (
            <InlineFeedback tone="success">Saved — your choice is recorded.</InlineFeedback>
          )}
          {error === 'contribution' && (
            <InlineFeedback tone="error">That didn’t save — give it another go.</InlineFeedback>
          )}
          <div className={styles.actions}>
            <Badge tone={contributing ? 'moss' : 'neutral'}>{contributing ? 'On' : 'Off'}</Badge>
            <form action={setContribution}>
              <input type="hidden" name="enabled" value={contributing ? 'false' : 'true'} />
              <Button type="submit" variant="secondary">
                {contributing ? 'Turn off' : 'Turn on'}
              </Button>
            </form>
          </div>
        </Card>
```

- [ ] **Step 3: Typecheck**

Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web`
Expected: no errors. (`InlineFeedback` is exported from `components/ui` — the account/profile pages use it. The accounts row type now includes `model_contribution_enabled: boolean`.)

- [ ] **Step 4: Confirm the existing panel tests still pass**

Run: `cd /c/Nibbin && npx vitest run apps/web/lib/privacy/panel.test.ts`
Expected: 5 passed (this task doesn't touch the helpers, but confirm no regression).

- [ ] **Step 5: Copy-accuracy guard**

Run: `cd /c/Nibbin && grep -niE "personal sites|100ms|os.?flag|train(s|ed)? on your content|sell" apps/web/app/app/settings/privacy/page.tsx`
Expected: the only matches are the *accurate* phrases — "never trains on your content" (negated) and "never sold". Confirm there is NO affirmative claim that content IS trained, and no "personal sites"/latency/OS-flag claims. Report the matched lines.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/app/settings/privacy/actions.ts apps/web/app/app/settings/privacy/page.tsx
git commit -m "feat(web): model-improvement contribution toggle in Data & Privacy"
```

---

## Self-review notes (verified against the spec)
- **T9** — content-training stated as never (the toggle copy leads with it). **T10** — structural contribution opt-out toggle, wired to `set_model_contribution`. **T11** — schema = invariant = copy: the column is opt-out/default-on, the copy matches R48/R49, the moot flag is retired.
- **TC-P7** — the two concepts are kept distinct in the copy: "never trains on your content" vs the toggle over "anonymized, aggregate signals."
- **Backfill** — achieved structurally: `add column … default true` sets existing rows to on. No separate UPDATE needed.
- **Security** — the new RPC mirrors the audited, member-checked, security-definer pattern exactly; `revoke … from public/anon/service_role` + `grant … to authenticated` preserved; audit action `account.model_contribution_set`.
- **Not applied here** — the migration is a file only; the orchestrator applies it to dev/staging/prod via MCP and handles the legal-copy redraft.
