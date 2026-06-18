# Drift Nudge (R2) + Dignified Demotion (CE5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. PR 2 of the promotion-rubric build (PR 1 = promotion gate v2, merged #128).

**Goal:** (R2) When a Senior/Grad Nibbin's *recent real* drafts degrade (<80% approved-unedited over the last 10 decided runs), surface a **calm drift nudge** as a notification leaf — never auto-demote. (CE5) Give the user a one-click **"back to drafts"** control; demoting plays the approved dignified-demotion treatment: a calm notification leaf + a calm in-grove Keeper acknowledgment ("back to drafts — good instinct"), reusing the Beat 3 in-grove path with no leaf-burst.

**Architecture:** A new `notifications.kind` migration adds `nudge` + `demotion`, plus a `service_role`-only `insert_system_notification` RPC (the web server's only notification-insert path). `maybeDriftNudge` runs after each decision (in `decide.ts`) and inserts a deduped daily nudge leaf when a senior/grad drifts. A roster `demoteNibbinAction` calls the existing `nibbin_demote` RPC (user-initiated, member-checked) and inserts the calm demotion leaf. Grove Home's existing pending-celebration path (Beat 3) is extended to render `demotion` leaves calmly (no burst/delighted).

**GATED:** only `supabase/migrations/` is sensitive — needs a `docs/gates/2026-06-18-drift-demotion.md` report + the migration applied to dev/staging/prod + the CI adversarial gate. Everything else (`apps/web/lib/runtime`, `apps/web/app/app/*`, `components/shell`) is gate-free.

## Settled parameters (from the rubric spec, all locked)
- Drift = **<80% approved-unedited over the last 10 *decided* runs**; **nudge-only** (the human still demotes); fewer than 10 recent decided runs ⇒ no nudge (silence never trips it).
- Demotion stays **human-initiated** (existing `nibbin_demote`); calm, no coral, no burst; "good instinct" framing; **paused ≠ penalized; trust freezes, never decays.**

## File structure
- **Create** `supabase/migrations/20260618010000_drift_demotion_notifications.sql` — kind CHECK += nudge/demotion; `insert_system_notification` RPC.
- **Create** `apps/web/lib/runtime/drift.ts` — `maybeDriftNudge`.
- **Modify** `apps/web/lib/runtime/decide.ts` — call `maybeDriftNudge` after the decision.
- **Modify** `apps/web/app/app/nibbins/actions.ts` — `demoteNibbinAction`.
- **Modify** `apps/web/app/app/nibbins/page.tsx` (+ a small client control) — "Back to drafts" for senior/grad cards.
- **Modify** `apps/web/app/app/notifications/actions.ts` — widen `Leaf.kind` to include `nudge`/`demotion`.
- **Modify** `apps/web/app/app/notifications/page.tsx` — render the `ctaLabel` link for leaves that carry one (bell already handles ctaPath).
- **Modify** `apps/web/app/app/page.tsx` — Grove Home pending-celebration query includes `demotion`.
- **Modify** `apps/web/app/app/grove/KeeperChat.tsx` — `Celebration.kind` += `demotion`; render calm (no burst/delighted) for demotion.

---

### Task 1: Migration — notification kinds + insert RPC

**Files:** Create `supabase/migrations/20260618010000_drift_demotion_notifications.sql`

- [ ] **Step 1** — write the migration:
```sql
-- Drift nudge (R2) + dignified demotion (CE5) notification surfaces.
-- Adds two notification kinds and a service_role-only insert path (the web
-- server's drift/demotion leaves; clients still cannot insert — see m5 RLS).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('beat', 'evolution', 'graduation', 'nudge', 'demotion'));

-- Controlled insert for system-authored leaves (drift nudge, demotion echo).
-- security definer + service_role-only: the trusted runtime path inserts; the
-- ON CONFLICT dedupes by (account_id, kind, source_id) so retries never stack.
create or replace function public.insert_system_notification(
  p_account uuid,
  p_kind text,
  p_source_id text,
  p_title text,
  p_body text,
  p_payload jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('nudge', 'demotion') then
    raise exception 'insert_system_notification only authors nudge/demotion, got %', p_kind;
  end if;
  insert into public.notifications (account_id, kind, source_id, title, body, payload)
  values (p_account, p_kind, p_source_id, p_title, p_body, p_payload)
  on conflict (account_id, kind, source_id) do nothing;
end;
$$;
revoke execute on function public.insert_system_notification(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.insert_system_notification(uuid, text, text, text, text, jsonb) to service_role;
```

- [ ] **Step 2** — do NOT apply (the controller applies to dev/staging/prod after review). Commit: `feat(db): nudge/demotion notification kinds + system-insert RPC`.

---

### Task 2: Drift detection

**Files:** Create `apps/web/lib/runtime/drift.ts`

- [ ] **Step 1** — write `maybeDriftNudge`. It is best-effort (never throws into the decision path), senior/grad only, last-10-decided, <80% approved, deduped per day:
```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** R2 drift nudge: when a Senior/Grad's recent real drafts degrade, surface a
 *  CALM, human-only nudge leaf — never auto-demote, never key on silence.
 *  Best-effort: any failure is swallowed (the decision already committed). */
export async function maybeDriftNudge(
  svc: SupabaseClient,
  accountId: string,
  nibbinId: string,
): Promise<void> {
  try {
    const { data: n } = await svc
      .from('nibbins')
      .select('name, stage, species, palette, accessory, marking')
      .eq('id', nibbinId)
      .single();
    if (!n || (n.stage !== 'senior' && n.stage !== 'grad')) return;

    // Last 10 DECIDED runs for this nibbin (any stage — recent behavior).
    const { data: recent } = await svc
      .from('approvals')
      .select('decision, decided_at, runs!inner(nibbin_id)')
      .eq('runs.nibbin_id', nibbinId)
      .order('decided_at', { ascending: false })
      .limit(10);
    const rows = (recent ?? []) as Array<{ decision: string }>;
    if (rows.length < 10) return; // insufficient recent evidence — silence never trips it

    const approved = rows.filter((r) => r.decision === 'approved').length;
    if (approved / rows.length >= 0.8) return; // healthy

    // Deduped per nibbin per UTC day so it never spams every decision.
    const day = new Date().toISOString().slice(0, 10);
    const name = n.name as string;
    await svc.rpc('insert_system_notification', {
      p_account: accountId,
      p_kind: 'nudge',
      p_source_id: `drift:${nibbinId}:${day}`,
      p_title: `${name}'s recent drafts needed more edits`,
      p_body:
        `Her last ten runs went back for changes more than usual. You might put ${name} back to drafts while she re-learns — nothing's lost either way. Your call.`,
      p_payload: {
        ctaPath: '/app/nibbins',
        ctaLabel: `Review ${name}`,
        nibbinId,
        species: n.species,
        stage: n.stage,
        palette: n.palette ?? null,
        accessory: n.accessory ?? 'none',
        marking: n.marking ?? 'none',
      },
    });
  } catch {
    // best-effort; never disrupt the decision path
  }
}
```

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): maybeDriftNudge — calm drift nudge for degrading Seniors/Grads`.

---

### Task 3: Wire drift into the decision path

**Files:** Modify `apps/web/lib/runtime/decide.ts`

- [ ] **Step 1** — import and call after `maybePromote`. After the `promotedTo`/`stage_promoted` block and before `return`, add:
```ts
  // R2: a degrading Senior/Grad gets a calm, human-only nudge (best-effort).
  await maybeDriftNudge(svc, accountId, run.nibbin_id as string);
```
Add the import at top: `import { maybeDriftNudge } from './drift';`

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): fire drift nudge after each decision`.

---

### Task 4: Demote action + roster control

**Files:** Modify `apps/web/app/app/nibbins/actions.ts`, `apps/web/app/app/nibbins/page.tsx` (+ a small client control)

- [ ] **Step 1 — `nibbins/actions.ts`** add `demoteNibbinAction`. It calls the existing member-checked `nibbin_demote` via the SESSION client (so the SQL's `is_account_member`/`auth.uid()` path applies), then inserts the calm demotion leaf via the service RPC, then revalidates. Read the file's existing imports first (it has `appSession`; add `createClient` for the session client + `serviceClient`):
```ts
export interface DemoteResult { ok: boolean; error?: string }

/** CE5: the user puts a Nibbin back to drafts. One click, dignified. Calls the
 *  member-checked nibbin_demote RPC with the caller's session, then drops the
 *  calm demotion leaf (and the in-grove ack rides the Beat-3 pending path). */
export async function demoteNibbinAction(nibbinId: string): Promise<DemoteResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'missing nibbin' };
  const { user, accountId } = await appSession();
  const supabase = await createClient(); // session client — auth.uid() drives the RPC's member check
  const { data: newStage, error } = await supabase.rpc('nibbin_demote', { p_nibbin: id });
  if (error) return { ok: false, error: error.message };

  // Calm demotion leaf (best-effort). Service client = controlled insert path.
  try {
    const svc = serviceClient();
    const { data: n } = await svc
      .from('nibbins')
      .select('name, species, palette, accessory, marking, stage_changed_at')
      .eq('id', id)
      .single();
    if (n) {
      await svc.rpc('insert_system_notification', {
        p_account: accountId,
        p_kind: 'demotion',
        p_source_id: `demotion:${id}:${n.stage_changed_at}`,
        p_title: `${n.name} is back to drafts`,
        p_body:
          `Good instinct catching that — nothing's lost. ${n.name} keeps what she learned and re-earns the step the same way. You're back in the loop on everything she sends.`,
        p_payload: {
          ctaPath: '/app/nibbins',
          ctaLabel: `See ${n.name}`,
          nibbinId: id,
          species: n.species,
          stage: newStage as string,
          palette: n.palette ?? null,
          accessory: n.accessory ?? 'none',
          marking: n.marking ?? 'none',
        },
      });
    }
  } catch {
    // leaf is best-effort; the demotion itself already succeeded
  }
  revalidatePath('/app/nibbins');
  revalidatePath('/app');
  return { ok: true };
}
```
(Confirm `createClient` import path matches the repo, e.g. `../../../lib/supabase/server`; `serviceClient` from `../../../lib/supabase/service`; `revalidatePath` from `next/cache`.)

- [ ] **Step 2 — a small client control.** Read `apps/web/app/app/nibbins/page.tsx` to see the card footer (where the stage pill + `NibbinEditor` render, ~line 344) and `NibbinEditor.tsx` for the existing client-action pattern. Add a restrained **"Back to drafts"** control that shows ONLY for `n.stage === 'senior' || n.stage === 'grad'`, calls `demoteNibbinAction(n.id)` in a transition, and confirms first (a simple inline two-step confirm or `window.confirm`). Match the roster's existing button styling (tokens; NOT coral — this is calm, not destructive). Prefer a tiny client island (e.g. `BackToDrafts.tsx`) imported into the card, mirroring how `NibbinEditor`/`NoteRefresher` are wired. Keep copy calm: button "Back to drafts", confirm line "Put {name} back to drafts? She'll re-earn the step." On success the page revalidates (server action did it) — a `router.refresh()` after the transition is fine.

- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): back-to-drafts demote action + roster control (CE5)`.

---

### Task 5: Notification leaf kinds

**Files:** Modify `apps/web/app/app/notifications/actions.ts`, `apps/web/app/app/notifications/page.tsx`

- [ ] **Step 1 — `notifications/actions.ts`** widen the `Leaf.kind` union and the DB row `kind` type to include `'nudge' | 'demotion'`. The payload map already carries ctaPath/ctaLabel/creature generically — confirm `nudge`/`demotion` rows flow through unchanged (they set the same payload shape).

- [ ] **Step 2 — `notifications/page.tsx`** the archive currently doesn't render the CTA. Add a CTA link for any leaf with `ctaPath` + `ctaLabel`:
```tsx
{leaf.ctaPath && leaf.ctaLabel && (
  <a className={styles.leafCta} href={leaf.ctaPath}>{leaf.ctaLabel}</a>
)}
```
Add a tokens-only `.leafCta` style (a quiet text link / small button). The NotificationBell already routes on `ctaPath` (line ~53) and renders the creature, so nudge/demotion leaves work there with no change beyond the widened type.

- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): render nudge/demotion leaves + their CTA`.

---

### Task 6: Calm in-grove demotion ack (CE5)

**Files:** Modify `apps/web/app/app/page.tsx`, `apps/web/app/app/grove/KeeperChat.tsx`

- [ ] **Step 1 — `page.tsx`** the Beat-3 pending-celebration query currently filters `kind in ('evolution','graduation')`. Add `'demotion'`:
```ts
.in('kind', ['evolution', 'graduation', 'demotion'])
```
and in the `Celebration[]` map, pass `kind: r.kind as 'evolution' | 'graduation' | 'demotion'`. (Nudge is NOT shown in-grove — only the leaf; the grove ack is for the committed demotion.)

- [ ] **Step 2 — `KeeperChat.tsx`** widen `Celebration.kind` to include `'demotion'`. In the injection effect, the delighted-expression + `burstKey` bump must fire ONLY for promotions, never for a demotion:
```ts
const anyCelebratory = show.some((c) => c.kind !== 'demotion');
later(() => {
  if (anyCelebratory) { setExpression('delighted'); setBurstKey((k) => k + 1); }
}, Math.max(0, (show.length - 1) * 520));
```
In `CelebrationBubble`, branch styling on `celebration.kind === 'demotion'` → a calm class (neutral surface, no honey/shell glow). Add `.demotionCard` (or a modifier) in `keeper-chat.module.css` using `--understory`/`--line`/`--ink-soft` (NOT coral, NOT shell). The creature still renders at its new (lower) stage; the line is the demotion body copy.

- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): calm in-grove demotion acknowledgment (CE5)`.

---

### Task 7: Verify
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.
- [ ] `cd /c/Nibbin && npx vitest run apps/web/ packages/drip/test` → green (no regressions; drift/demote have no unit tests but must not break existing).
- [ ] `cd /c/Nibbin && grep -n "nosemgrep" apps/web/app/app/grove/KeeperChat.tsx` → still exactly 1 (no new dangerouslySetInnerHTML added; CelebrationBubble already carries it).
- [ ] `cd /c/Nibbin && grep -rnE "#[0-9A-Fa-f]{6}|coral" apps/web/app/app/grove/keeper-chat.module.css apps/web/app/app/notifications/*.module.css` → no NEW hex/coral from this work.
- [ ] Confirm the demote control renders only for senior/grad and uses no coral.

## Self-review
- **Gate-free except the migration:** only `supabase/migrations/` is sensitive; the insert RPC is `security definer` + service_role-only + restricted to nudge/demotion kinds (can't author beat/evolution/graduation), with dedupe.
- **Nudge-only, never auto-demote:** `maybeDriftNudge` only inserts a leaf; demotion is the user's explicit `demoteNibbinAction`. **Silence never trips it** (`rows.length < 10` returns). Best-effort (swallows errors) so it never disrupts a decision.
- **Paused ≠ penalized:** drift is over the last 10 *decided* runs — a paused/idle Nibbin has none recently, so no nudge; the gate v2 window (PR 1) likewise never decays.
- **Dignified demotion:** existing one-click `nibbin_demote` (member-checked), calm copy ("good instinct"), calm leaf, calm in-grove ack with NO leaf-burst/delighted and no coral — matches the approved mock.
- **Reuses Beat 3 infra:** the in-grove ack rides the existing pending-celebration path; only adds the `demotion` kind + a calm render branch.
