# P6 — Attention-Queue Wiring + Keeper Red-Bubble

**Branch:** `feature/company-brain-attention-queue`
**Depends on:** F1/F2 foundation (`20260622140000_company_brain_foundation.sql`) — proposals table + `review_item` notification kind already live.
**Author:** design spec (DO NOT BUILD until this is reviewed and signed off)
**Date:** 2026-06-23

---

## 0. What this chunk is and isn't

§10 of COMPANY-BRAIN says: "this is mostly **wiring, not building.**" The rails exist:
- The notification center + bell exist (`NotificationBell`, `/app/notifications`, `listLeaves`).
- The push dispatch rail exists (`deliverWithFallback`, `channel_prefs`, `urgency` tiers).
- The Keeper panel exists (right-rail `AppShell panel=`, `panelExpand`/`panelToggle` buttons).
- `proposals` rows + `review_item` notifications emit from F2.

What is missing:
1. **Stakes tiering** — no field on notifications encodes whether an item warrants a push vs. silent sit. The push rail exists but nothing tells it when a `review_item` is urgent.
2. **Grovekeeper read-access** — `keeperChatAction` and `buildKeeperContext` pass zero pending-item context into the prompt. The Keeper cannot open with "you have 3 things waiting."
3. **Keeper-dock red-bubble** — the `panelExpand` / `panelToggle` buttons have no badge counter; the dock is visually inert regardless of pending items.
4. **Grove Home roll-up** — the "NEEDS YOUR EYES" chipline and "Needs you" card count only `awaiting_approval` runs. Memory proposals, field-flag conflicts, and other `review_item` notifications are invisible there.

**Invariant (§10.3, D12):** the notification center is the sole source of truth for all pending counts. No surface keeps its own list; every counter is derived from reading `notifications` (+ in some cases `proposals` status). This is the load-bearing constraint the whole spec is built around.

---

## 1. Stakes field on notifications

### 1.1 Schema add

Add a column to `public.notifications`:

```sql
alter table public.notifications
  add column stakes text not null default 'normal'
  check (stakes in ('normal', 'high'));
```

`stakes='high'` means: also ride the push rail. `stakes='normal'` means: sit in the center, no push.

**Why a column, not a payload key?** The push dispatcher needs to query `stakes` in a SELECT. Encoding it in `payload` JSON requires a cast and disables index use. A real column is clean, constrained, and indexable.

**Migration number:** next available after `20260622140000`. Propose `20260623100000_attention_queue_stakes.sql`.

### 1.2 `insert_system_notification` extension

Update the function signature and body:

```sql
create or replace function public.insert_system_notification(
  p_account uuid,
  p_kind    text,
  p_source  text,
  p_title   text,
  p_body    text,
  p_payload jsonb    default '{}'::jsonb,
  p_stakes  text     default 'normal'     -- NEW
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('nudge','demotion','review_item') then
    raise exception 'insert_system_notification only authors nudge/demotion/review_item, got %', p_kind;
  end if;
  if p_stakes not in ('normal','high') then
    raise exception 'invalid stakes %', p_stakes;
  end if;
  insert into public.notifications (account_id, kind, source_id, title, body, payload, stakes)
  values (p_account, p_kind, p_source, p_title, p_body, p_payload, p_stakes)
  on conflict (account_id, kind, source_id) do nothing;
  return (select id from public.notifications where account_id=p_account and kind=p_kind and source_id=p_source);
end;
$$;
```

### 1.3 How dispatch respects stakes

**The dispatcher never changes.** It reads the item's `urgency` field on the `DispatchMessage` struct (see `packages/channels/src/types.ts`). The mapping is:

| `stakes` | `urgency` passed to `deliverWithFallback` |
|---|---|
| `'normal'` | `'normal'` — sits in center only |
| `'high'` | `'high'` — rides the push rail per user's channel prefs |

Stakes-to-urgency translation happens at **dispatch call-sites** (the server-side worker that reads `review_item` notifications and decides whether to deliver). The notification row stores the source of truth; the worker translates on read. This preserves the separation: the notification center is data, the push rail is behavior.

**What makes an item high-stakes?**  Caller decides at emission time. Proposed rule (not locked — see §7 forks):
- `stakes='high'`: a memory conflict flagged `conflict` origin (two sources directly contradict each other on the same field).
- `stakes='normal'`: a routine proposal from a sweep or doc-drop (the user can catch this on their next Grove Home visit).

The `propose_memory_change` RPC already receives the `origin` parameter. The P6 migration updates it to accept and forward a `p_stakes` parameter (defaulting to `'normal'`), which it passes through to `insert_system_notification`.

### 1.4 Dedup invariant

The `notifications(account_id, kind, source_id)` unique constraint already blocks double-emit. A second `propose_memory_change` for the same proposal (if the RPC is called twice) does `on conflict do nothing` — the stakes on the first emission stand. If stakes need to change (e.g., conflict is escalated), the worker that makes that judgment does a direct `update` on the notification row, not a re-insert.

---

## 2. Grovekeeper read-access to unresolved items

### 2.1 What the Keeper reads (and only reads)

The Keeper is passed a read-only snapshot at chat-turn start. It reads:
1. Unread `review_item` notifications (unresolved proposals, field conflicts) — from `notifications`.
2. Pending `proposals` (status `'pending'`) with their field_key and rationale — from `proposals` joined to `sources.display_name`.
3. Awaiting-approval run drafts — from `runs` where `status='awaiting_approval'` (already fetched on Grove Home; pass count + top item title).

It does **not** hold any of this in a side table. It reads at turn time, formats into the volatile context suffix, and discards. C10 is preserved: the Keeper has no write tool and no side-effect capability.

### 2.2 Where the read happens

In `apps/web/app/app/grove/actions.ts`, the `keeperChatAction` function currently calls `keeperChat(...)` with a context built from `buildKeeperContext({ keeperName, userName })`. Extend this:

1. Before calling `keeperChat`, query pending items for the account:
   ```ts
   const pendingItems = await loadPendingItems(supabase, accountId);
   ```

2. `loadPendingItems` is a new server-utility (not an RPC — plain Supabase client queries, RLS-scoped):
   - Query `notifications` where `account_id=accountId AND kind='review_item' AND read_at IS NULL`, order by `created_at DESC`, limit 10. Join via `source_id` → `proposals.id` to get `field_key`, `rationale`, `stakes`.
   - Query `runs` where `account_id=accountId AND status='awaiting_approval'`, limit 5 (already available on page.tsx; reuse the same query shape).
   - Return a typed `PendingQueue` object.

3. Pass `pendingItems` into `buildKeeperContext` (rename/extend the function in `packages/keeper/src/prompt.ts`):

```ts
export interface KeeperPromptContext {
  keeperName?: string | null;
  userName?: string | null;
  pendingItems?: PendingQueue | null;  // NEW
}
```

4. `buildKeeperContext` renders pending items into the volatile suffix (kept short — every token is paid per turn):

```
You currently see N items waiting for this person's attention.
[If N>0:]
Pending reviews (memory proposals): [{field_key}: "{rationale_truncated}" — review at /app/memory]
Awaiting-approval drafts: [{nibbin_name} drafted {title} — approve at /app]
[If any stakes='high':]
One or more of these is flagged high-stakes — lead with it.
```

Rationale is truncated to 80 chars. No raw source content is included — the Keeper sees the item label and deep-link, not the source body. This is consistent with C7 (Keeper doesn't see screen/captured data) applied to the memory layer.

### 2.3 Opening turn behavior

When the user opens the Keeper chat and `pendingItems.total > 0`, the Keeper's first response (the `initialMessages` from `loadGroveState`) should open with the pending-items lead. This requires:

- `loadGroveState` in `apps/web/lib/grove/load.ts` also fetches `pendingItems` and passes it through.
- The `KEEPER_SYSTEM_PROMPT` addition (in `packages/keeper/src/prompt.ts`) instructs: "When you have pending items in your context, open with them naturally — 'You've got N things waiting — want to start with [the highest-stakes one]?' — then follow wherever the conversation goes."

**Constraint:** this prompt addition is part of the stable prefix (`KEEPER_SYSTEM_PROMPT`), so it is cached and does not increase per-turn cost. The actual pending-item content lives in the volatile suffix where it belongs.

### 2.4 Deep-links

Every item in the context suffix includes the path where the user acts on it:
- Memory proposal → `/app/memory` (the review queue on the Memory tab, built in P5).
- Field-flag conflict → `/app/memory#conflicts` (same tab, conflict sub-section).
- Awaiting-approval run → `/app` (Grove Home "Needs you" card) or `/app/nibbins` for a specific Nibbin.

The Keeper formats these as plain-text references ("review it at Your Memory tab" or "see it at Grove Home") — not as rendered links inside the chat. The chat UI can optionally render CTA chips for known deep-link patterns in a follow-on polish pass.

### 2.5 What the Keeper never does

- Does not write to `proposals`, `notifications`, `grove_memory`, or `runs`. No tool is given to it.
- Does not hold its own copy of the queue between turns (no `pendingItems` in grove_state or localStorage).
- Does not lie about what it sees: if a proposal was approved between when the context was built and when the user asks, the next turn will fetch fresh.

---

## 3. Keeper-dock unread red-bubble

### 3.1 What to count

The red-bubble on the Keeper-dock buttons (`panelExpand` and `panelToggle` in `AppShell.tsx`) counts:

> **new Keeper messages** + **unresolved pending items from the notification center**

Where:
- **New Keeper messages** = Keeper messages sent since the user last opened the panel. This is the existing unread-leaf count from `listLeaves`, filtered to `kind` values that represent Keeper-authored outbound items (`nudge`, `reach`, `review_item`).
- **Unresolved pending items** = `notifications` where `read_at IS NULL AND kind='review_item'`. These are proposals/conflicts needing the user's decision.

**Not double-counted:** an unread `review_item` leaf is already in the unread leaf count. To avoid double-counting, the bubble value is simply the total `unread` count from `listLeaves` (which already counts all unread leaves including `review_item`). The bubble is the same number the bell shows — one source, two surfaces.

**Why not a separate query?** §10.3. One source of truth. The bell and the dock badge show the same number. If the user reads notifications from the bell, the dock bubble drops. If they open the panel and the Keeper acks items, the count drops. Both read from the same `notifications.read_at IS NULL` state.

### 3.2 How to wire it

`AppShell` currently renders `<NotificationBell />` (which fetches its own unread count) and the `panelExpand`/`panelToggle` buttons with no badge.

**Option A (client-only lift, preferred):** Lift the unread count out of `NotificationBell` into `AppShell`. `AppShell` becomes a client component (it already is — it uses `useState`). It fetches `unread` once on mount and passes it down to both `NotificationBell` and the dock buttons. The fetch is the same `listLeaves(1)` call (limit 1, just for the count).

**Option B (prop-drill from server):** Pass `unreadCount` as a prop from the page server component down through `AppShell`. Avoids an extra client fetch but requires every page that uses the shell to query notification count — adds a query to every route.

**Recommendation: Option A.** The extra fetch is one COUNT query, cached by Supabase's edge, and `AppShell` already runs client-side. The unread number is not on the critical path for page load.

### 3.3 Badge rendering

Both the `panelExpand` button and the `panelToggle` button get a badge overlay, identical pattern to `NotificationBell`'s `styles.badge`:

```tsx
{/* Inside panelExpand button: */}
{unread > 0 && (
  <span className={styles.dockBadge} aria-label={`${unread} unread`}>
    {unread > 9 ? '9+' : unread}
  </span>
)}
```

CSS: `styles.dockBadge` — absolute positioned red pill, top-right corner of the button, same visual language as the bell badge. On mobile (`panelToggle`), the badge sits top-right of the floating Grovekeeper glyph.

**Accessibility:** the `aria-label` on both dock buttons updates to include the count: `"Open Keeper — 3 unread"`. The count is also in the visible badge so it's not screen-reader-only.

### 3.4 When the bubble clears

The dock badge uses the same `unread` count. It clears when:
- The user opens the bell and marks leaves read (existing `markRead` / `markAllRead`).
- The user decides a proposal (`decide_memory_proposal`) — which already sets `read_at` on the linked notification (existing behavior in the migration).
- The user approves a draft run — the `awaiting_approval` run count drops, but the `review_item` notifications for proposals are the primary driver of the dock badge.

No new clearing mechanism is needed.

---

## 4. Grove Home roll-up badge

### 4.1 Current state

`apps/web/app/app/page.tsx` fetches:
```ts
supabase.from('runs')
  .select('id', { count: 'exact', head: true })
  .eq('account_id', accountId)
  .eq('status', 'awaiting_approval')
```
And displays the count as "NEEDS YOUR EYES — N items" in the chipline.

### 4.2 Extended count

The "NEEDS YOUR EYES" number becomes:

> `awaiting_approval` run count + unread `review_item` notification count

Add a second parallel query in the `Promise.all` block:

```ts
supabase
  .from('notifications')
  .select('id', { count: 'exact', head: true })
  .eq('account_id', accountId)
  .eq('kind', 'review_item')
  .is('read_at', null),
```

Total: `(waitingCount ?? 0) + (reviewItemCount ?? 0)`.

**Why not query `proposals` directly?** Because `notifications` is the canonical store (§10.3). A `review_item` notification is emitted exactly once per proposal; when the proposal is decided the notification's `read_at` is set. Querying `notifications WHERE kind='review_item' AND read_at IS NULL` is equivalent to `proposals WHERE status='pending'` — but uses the single source of truth rather than a parallel count.

### 4.3 "Needs you" card content

The "Needs you — your only to-do" card on Grove Home currently shows `awaiting_approval` drafts only. After this chunk it shows a unified queue:

1. **Awaiting-approval drafts** (existing cards, unchanged rendering).
2. **Pending memory proposals** (new section, only if any exist): a compact list — "N memory items need your review" with a link to `/app/memory`. Not individual cards per proposal; that detail lives on the Memory page.

The card heading stays "Needs you — your only to-do." No copy change needed for the happy path. If the queue is empty, the existing empty-state copy covers it.

### 4.4 "Needs you" stat card

The `dash.stat` "Waiting on you" value at the bottom of Grove Home also uses `waiting`. Update it to use the same extended total.

---

## 5. RPC / data-access summary

| What | How | Who calls it |
|---|---|---|
| `notifications.stakes` column | Migration — new column with CHECK | All callers of `insert_system_notification` |
| `insert_system_notification(... p_stakes)` | Updated function, backward-compatible default `'normal'` | Existing callers unchanged; `propose_memory_change` updated |
| `propose_memory_change` | Accept `p_stakes text default 'normal'`; forward to `insert_system_notification` | Sweep workers, doc-extract workers (future P2/P3) |
| `loadPendingItems(supabase, accountId)` | New server utility — plain Supabase queries, no new RPC | `keeperChatAction`, `loadGroveState` |
| Unread `review_item` count | Plain `notifications` query (already RLS-scoped) | Grove Home `page.tsx`, `AppShell` unread lift |

No new RPCs, no new tables, no new authentication surfaces.

---

## 6. Security & invariant checks

| Check | How |
|---|---|
| C10 (Keeper no side-effects) | `loadPendingItems` is read-only; no tool passed to the model; no write path from the chat action |
| §10.3 (one source of truth) | All three surfaces (dock badge, bell, Grove Home count) derive from the same `notifications` table query. The Keeper context is built from this read — it holds no parallel state |
| Cross-account leakage | `loadPendingItems` runs under the user's RLS session; all queries are `eq('account_id', accountId)` and subject to `is_account_member` RLS policies inherited from the F1/F2 migration |
| Stakes escalation | Stakes are set at emission time by the service-role caller. A client cannot upgrade stakes on an existing notification (no client write path to `notifications`). Escalation (if ever needed) goes through a service-role worker |
| No prompt injection via proposals | The Keeper context includes `rationale` truncated to 80 chars. The rationale is typed text stored by a service-role function after redaction (`isClean` check in `propose_memory_change`). It is not rendered as HTML and does not execute. Additional truncation in `buildKeeperContext` is the safety belt |

---

## 7. Migration sequence

1. `20260623100000_attention_queue_stakes.sql`
   - `ALTER TABLE notifications ADD COLUMN stakes text NOT NULL DEFAULT 'normal' CHECK (stakes IN ('normal','high'))`.
   - `CREATE OR REPLACE FUNCTION insert_system_notification(... p_stakes text DEFAULT 'normal')` — updated body.
   - `CREATE OR REPLACE FUNCTION propose_memory_change(... p_stakes text DEFAULT 'normal')` — updated to forward `p_stakes`.

Apply to dev/staging/prod. Backward compatible — all existing rows get `stakes='normal'` via the DEFAULT. Existing callers of both functions are unchanged (new param has a default).

---

## 8. Open forks for John

These decisions are intentionally left open. Each is a real fork in behavior; the spec has staked out a recommended answer but flags them explicitly.

### F1 — Stakes assignment rule

The spec proposes: `stakes='high'` iff `origin='conflict'`; `stakes='normal'` for routine proposals. 

**Alternative:** let the sweep/collate worker score stakes based on how many fields are affected or how far the proposed value diverges from the current value. A conflict between a signed contract and a stale old email might be routine; a conflict that changes pricing or legal terms is high-stakes. Do you want a simple `origin='conflict'` rule now, or a richer stakes-scoring function from day one?

### F2 — Grovekeeper opening turn: always-lead or only-when-asked

The spec says: if pending items exist, the Keeper opens with "you've got N things waiting." 

**Risk:** users who open the Keeper for a quick unrelated question are greeted with admin overhead. **Alternative:** the Keeper only mentions pending items when explicitly asked ("what's waiting for me?"), and the dock badge is the ambient signal. This is quieter but the badge alone may not be enough pull. Which UX posture is right?

### F3 — "NEEDS YOUR EYES" card: inline proposal cards or just a link

The spec proposes: pending proposals show as a compact "N memory items — go to Memory" link in the "Needs you" card, not individual draft-style cards.

**Alternative:** render one card per proposal in the same style as awaiting-approval run cards, with an Approve/Reject button pair that calls `decide_memory_proposal` inline. This is heavier but keeps the user on Grove Home for the entire to-do list. Decision affects whether Grove Home needs a form-post action for `decide_memory_proposal`.

### F4 — Dock badge: same as bell or subset

The spec proposes the dock badge mirrors the bell's full unread count (all `read_at IS NULL` notifications). 

**Narrower alternative:** the dock badge counts only items the Keeper itself can help with — `review_item` + `nudge` kinds — and excludes `beat`/`evolution`/`graduation`/`demotion` (which are informational, not action-required). This makes the dock badge a tighter "things needing your decision" signal rather than a general unread counter. Trade-off: two diverging counts (bell vs dock) may confuse rather than inform.

---

## 9. What this chunk explicitly does not do

- Does not build a new notification system, table, or delivery rail (§10.3, §15 anti-features).
- Does not give the Keeper any write tool or memory of its own.
- Does not change the channel dispatch system (`deliverWithFallback`, `channel_prefs`, adapters).
- Does not build the Memory page review UI (that's the P5 surface; this chunk only wires the count into Grove Home and the Keeper context).
- Does not add push registration / web push (push channel is already wired; `stakes='high'` merely passes `urgency='high'` to an existing dispatcher).
