# P6 — Attention-Queue Wiring + Keeper Red-Bubble: TDD Implementation Plan

**Branch:** `feature/company-brain-attention-queue`
**Spec:** `docs/superpowers/specs/2026-06-23-attention-queue-design.md`
**Depends on:** F1/F2 foundation (`20260622140000_company_brain_foundation.sql`)
**Date:** 2026-06-23

---

## Goal

Wire the four missing pieces that make pending Company Brain items visible to the user:

1. **Stakes column** on `notifications` — tells the push dispatcher whether a `review_item` is high-priority.
2. **Grovekeeper read-access** — pending items injected into the volatile context suffix so the Keeper can open with "you have N things waiting."
3. **Keeper-dock red-bubble** — `panelExpand` and `panelToggle` buttons carry the same unread count as the bell.
4. **Grove Home roll-up** — "NEEDS YOUR EYES" chipline and "Waiting on you" stat extend to cover memory proposals; "Needs you" card gains inline Approve/Reject cards for pending proposals.

No new tables. No new delivery rails. No write tools for the Keeper. One migration.

---

## Architecture

```
notifications.stakes ('normal'|'high')
        │
        ├─► push rail reads urgency from this at dispatch time (unchanged dispatcher)
        │
        └─► propose_memory_change(p_stakes) → insert_system_notification(p_stakes)

loadPendingItems(supabase, accountId)  ← NEW server utility, plain RLS queries
        │
        ├─► keeperChatAction → buildKeeperContext({ pendingItems })  [volatile suffix]
        └─► loadGroveState → GroveLoad.pendingItems → initialMessages lead

AppShell (client)
        ├─► lifts unread count from NotificationBell
        ├─► bell receives unread prop (no own fetch)
        └─► panelExpand + panelToggle render dockBadge overlay

apps/web/app/app/page.tsx
        ├─► adds reviewItemCount parallel query
        ├─► NEEDS YOUR EYES = waitingCount + reviewItemCount
        ├─► "Waiting on you" stat = same extended total
        └─► "Needs you" card: appends ProposalCards section (inline approve/reject
            calling decideProposalAction server action → decide_memory_proposal RPC)
```

**Global Constraints**

- **C10 (immovable):** `loadPendingItems` is read-only. No tool is passed to the model. The `keeperChatAction` has zero new write paths.
- **§10.3 (one source of truth):** All three surfaces (bell, dock badge, Grove Home count) derive from the same `notifications` table. `loadPendingItems` also reads `notifications`, not a parallel proposals count.
- **No cross-account leakage:** every query is `eq('account_id', accountId)` under the user's RLS session.
- **Backward-compatible migration:** new column has `DEFAULT 'normal'`; new function params have defaults. No callers break.
- **Adversarial gate:** runs before merge on this PR per `adversarial-gate.yml`.

---

## Task Sequence

### Task 0 — Migration: `20260623100000_attention_queue_stakes.sql`

**File:** `supabase/migrations/20260623100000_attention_queue_stakes.sql`

Write the migration with these three operations:

**0a. Add `stakes` column to `notifications`:**
```sql
alter table public.notifications
  add column stakes text not null default 'normal'
  check (stakes in ('normal', 'high'));
```

**0b. Replace `insert_system_notification` with updated signature:**
New param: `p_stakes text default 'normal'` (append after `p_payload`). Body: validate stakes in `('normal','high')`, pass `stakes` into the INSERT. Revoke/grant lines must cover the NEW 7-arg signature. The old 6-arg grant is dropped (superseded):
```sql
create or replace function public.insert_system_notification(
  p_account uuid, p_kind text, p_source_id text, p_title text, p_body text,
  p_payload jsonb default '{}'::jsonb,
  p_stakes  text  default 'normal'
) returns uuid ...
```
The `on conflict (account_id, kind, source_id) do nothing` keeps the dedup invariant. Stakes on the first emission stand; no re-escalation path in this slice.

**0c. Replace `propose_memory_change` with updated signature:**
New param: `p_stakes text default 'normal'` (append after `p_origin`). Forward to `insert_system_notification(..., p_stakes)`. Revoke/grant updated for the 8-arg signature.
```sql
create or replace function public.propose_memory_change(
  p_account uuid, p_field_key text, p_op text, p_value text, p_rationale text,
  p_source_id uuid, p_origin text,
  p_stakes text default 'normal'
) returns uuid ...
```

No data backfill needed — existing rows get `stakes='normal'` via DEFAULT. Apply to dev/staging/prod.

**Commit:** `feat(db): add stakes column to notifications + extend insert/propose RPCs`

---

### Task 1 — RLS tests for the migration

**File:** `tests/rls/attention-queue-stakes.test.ts`

Write tests **before** the migration SQL is finalized. Tests should skip when no DB is available (same `RlsHarness.probe()` pattern as `company-brain-foundation.test.ts`). Cover:

**1a. Stakes column exists and defaults to `'normal'`:**
- Insert a `review_item` notification via `insert_system_notification` with no `p_stakes` arg.
- Assert `notifications.stakes = 'normal'`.

**1b. `insert_system_notification` with `p_stakes='high'` writes `'high'`:**
- Insert with `p_stakes='high'`; assert stored value.

**1c. Invalid stakes value raises:**
- Call `insert_system_notification` with `p_stakes='critical'`; expect postgres check violation or the internal `raise exception`.

**1d. `propose_memory_change` with `p_stakes='high'` propagates to the notification row:**
- Service role calls `propose_memory_change($acct, 'pricing', 'replace', '$300', null, null, 'conflict', 'high')`.
- Assert the emitted `notifications` row has `stakes='high'`.

**1e. `propose_memory_change` without `p_stakes` defaults to `'normal'`:**
- Existing F2 call pattern `propose_memory_change($acct, 'pricing', 'replace', '$300', null, null, 'manual')` (7 args, no stakes).
- Assert `stakes='normal'` on the emitted notification (backward-compat proof).

**1f. Client (authenticated user) cannot insert into `notifications` directly:**
- Already covered by F1 foundation RLS tests conceptually, but confirm `stakes` column doesn't open a new write path.

**Test command:** `npx vitest run tests/rls/attention-queue-stakes.test.ts`

**Commit:** `test(rls): attention-queue stakes — migration + RPC param tests`

---

### Task 2 — `loadPendingItems` server utility

**File:** `apps/web/lib/grove/pending-items.ts`
**Test file:** `apps/web/lib/grove/pending-items.test.ts`

**Write the test first.**

**Type definition** (in `pending-items.ts`):
```ts
export interface PendingProposal {
  proposalId: string;
  fieldKey: string;
  rationale: string; // truncated to 80 chars at read time
  stakes: 'normal' | 'high';
  createdAt: string;
}

export interface PendingRun {
  runId: string;
  nibbinName: string;
  title: string | null;
}

export interface PendingQueue {
  proposals: PendingProposal[];
  runs: PendingRun[];
  total: number;
  hasHighStakes: boolean;
}
```

**Implementation** — plain Supabase client queries, no RPC, RLS-scoped:
- Query `notifications` where `account_id = accountId AND kind = 'review_item' AND read_at IS NULL`, select `id, source_id, payload, stakes, created_at`, order by `stakes DESC, created_at DESC`, limit 10. Then JOIN via `source_id` against `proposals` (`.in('id', sourceIds)`) to get `field_key, rationale`.
- Query `runs` where `account_id = accountId AND status = 'awaiting_approval'`, join `nibbins(name)`, also join `run_steps(kind, payload)` to find the `draft` step title. Limit 5.
- Merge: `total = proposals.length + runs.length`. `hasHighStakes = proposals.some(p => p.stakes === 'high')`.
- Truncate rationale to 80 chars with `…` suffix.
- Return `PendingQueue`.

**Unit tests (vitest, mock Supabase client):**

**2a. Empty state:** mock returns no rows; assert `{ proposals: [], runs: [], total: 0, hasHighStakes: false }`.

**2b. Single high-stakes proposal:** mock `notifications` returns one row with `stakes='high'`, `source_id=propId`; mock `proposals` returns matching row. Assert `hasHighStakes=true`, `proposals[0].stakes='high'`, `total=1`.

**2c. Rationale truncation:** rationale of 100 chars is truncated to 80 chars + `…` in the returned `PendingProposal`.

**2d. Mixed proposals + runs:** 2 proposal rows + 1 run row → `total=3`.

**2e. Ordering:** high-stakes proposal appears before normal-stakes proposal in `proposals` array.

**2f. Null rationale:** proposal with null rationale → `rationale=''` (no crash).

**Test command:** `npx vitest run apps/web/lib/grove/pending-items.test.ts`

**Commit:** `feat(grove): loadPendingItems — read-only pending queue utility (C10)`

---

### Task 3 — Extend `KeeperPromptContext` + `buildKeeperContext`

**Files:** `packages/keeper/src/prompt.ts`
**Test file:** `packages/keeper/src/prompt.test.ts` (create or extend existing)

**Write tests first.**

**3a. Interface extension:**
Add `pendingItems?: PendingQueue | null` to `KeeperPromptContext`. Import `PendingQueue` from a shared type (can be declared in `packages/keeper/src/types.ts` or re-exported from there; the actual query lives in `apps/web/lib/grove/pending-items.ts`).

**3b. `buildKeeperContext` — no pending items:**
When `pendingItems` is null or `total=0`, output is unchanged from current behavior (names only).

**3c. `buildKeeperContext` — proposals present, no high stakes:**
When `pendingItems.total > 0` and `!hasHighStakes`, volatile suffix appends:
```
You currently see 2 items waiting for this person's attention.
Pending memory proposals (2): [pricing: "from rate sheet" — review at /app/memory]
```

**3d. `buildKeeperContext` — high-stakes item present:**
When `hasHighStakes=true`, suffix ends with:
```
One or more of these is flagged high-stakes — lead with it.
```

**3e. `buildKeeperContext` — awaiting-approval runs present:**
When `pendingItems.runs.length > 0`, adds:
```
Awaiting-approval drafts (1): [Email Nibbin drafted Invoice follow-up — approve at Grove Home]
```

**3f. Token discipline check (not automated — manual guard):**
Verify in the test that the rendered volatile suffix for a realistic 10-proposal + 5-run queue stays under 300 tokens (rough word count × 1.3). Assert the rendered string length < 1500 chars.

**KEEPER_SYSTEM_PROMPT addition** — append to the stable block (cached, not per-turn):
```
When pending items appear in your context (after the names), open with them naturally — something like "You've got N things waiting — want to start with [the highest-stakes one]?" — then follow wherever the conversation goes. If the person asks about something else first, go with them.
```
This addition goes into `KEEPER_SYSTEM_PROMPT` (stable, cached). The instruction must NOT mention specific pending-item content (that lives in the volatile suffix). The test suite for `KEEPER_SYSTEM_PROMPT` changes gates on a prompt eval (see Task 8).

**Test command:** `npx vitest run packages/keeper/src/prompt.test.ts`

**Commit:** `feat(keeper): extend buildKeeperContext with pendingItems volatile suffix`

---

### Task 4 — Wire `loadPendingItems` into `keeperChatAction` and `loadGroveState`

**Files:**
- `apps/web/app/app/grove/actions.ts`
- `apps/web/lib/grove/load.ts`

**Write tests first for `loadGroveState` extension.**

**4a. `loadGroveState` extension:**
Add `pendingItems: PendingQueue` to `GroveLoad` interface. In the `Promise.all`, add `loadPendingItems(supabase, accountId)`. Pass `pendingItems` into `turnForState`/`buildKeeperContext` if the `initialMessages` need the lead (see Task 3c — when `pendingItems.total > 0`, the Keeper's first scripted message can include the count).

**NOTE:** The initial scripted message approach: `turnForState` returns messages from the scripted engine. The pending-items context is added to the SYSTEM prompt passed to the model, not to scripted messages. So `loadGroveState` only needs to pass `pendingItems` to the caller; the caller wires it into the `system` array. The `initialMessages` for the scripted floor don't change in this slice (pending-item awareness is a model behavior, not a scripted floor change).

**4b. `keeperChatAction` extension:**
In the `Promise.all` reads block, add `loadPendingItems(supabase, accountId)` (or call it inline after, since the session reads are already happening — keep it in the same Promise.all batch for a single round-trip).

Pass the result into `buildKeeperContext`:
```ts
{ text: buildKeeperContext({ keeperName: row?.keeper_name, pendingItems }) }
```
This replaces the existing `buildKeeperContext({ keeperName: row?.keeper_name })` call. The pending items are in the volatile context block (second system message), not the cached stable block.

**Tests (vitest, mock Supabase):**

**4c. `keeperChatAction` calls `loadPendingItems`:**
Mock `loadPendingItems` to return a queue with 1 proposal. Assert the volatile suffix passed to the generate function contains `"1 item"`.

**4d. No pending items → suffix unchanged:**
Mock `loadPendingItems` returns `total=0`. Assert the volatile suffix does NOT contain `"items waiting"`.

**4e. C10 regression:** Confirm `keeperChatAction` makes no Supabase write calls that weren't present before (no INSERT/UPDATE path through `loadPendingItems`).

**Test command:** `npx vitest run apps/web/app/app/grove/actions.test.ts`

**Commit:** `feat(grove): wire loadPendingItems into keeperChatAction + loadGroveState`

---

### Task 5 — AppShell: lift unread count + Keeper-dock red-bubble

**Files:**
- `apps/web/components/shell/AppShell.tsx`
- `apps/web/components/shell/NotificationBell.tsx`
- `apps/web/components/shell/shell.module.css`
- `apps/web/components/shell/notification-center.module.css` (if dockBadge reuses bell badge CSS, no change needed here)

**Write tests first.**

**5a. `NotificationBell` receives `unread` as prop (Option A — lift):**
Refactor `NotificationBell` to accept an `unread: number` prop AND an `onUnreadChange: (n: number) => void` callback (or simply an `externalUnread` prop that overrides the internal count). The simpler approach: `AppShell` fetches `unread` once on mount, passes it to `NotificationBell` as a prop; `NotificationBell` also keeps its own refresh on open (for the panel item list) but derives its badge number from the prop.

Cleaner API:
```ts
// NotificationBell.tsx
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  // ...rest unchanged, setUnread still called on markRead/markAllRead
}
```
`AppShell` fetches `unread` once and passes as `initialUnread`. This avoids a second simultaneous fetch on mount; the bell syncs on open. Simpler than a shared callback.

**5b. `AppShell` fetches unread count once on mount:**
```ts
const [unread, setUnread] = useState(0);
useEffect(() => {
  void listLeaves(1).then((r) => setUnread(r.unread));
}, []);
```
`listLeaves` is imported from the notifications actions. The `1` argument (limit 1 / head) is already supported — verify the action accepts a limit param; if not, the action can be called with no pagination and the `unread` field is already returned.

**5c. `dockBadge` CSS class in `shell.module.css`:**
Add `.dockBadge` — same visual spec as `.badge` in `notification-center.module.css`: absolute positioned, top-right of parent button, red pill (`background: var(--coral)` or `var(--moss)` — use `coral` to differentiate pending-action items from the informational green bell; match the design). On `panelExpand`: `top: -5px; right: -5px`. On `panelToggle` (mobile): `top: -4px; right: -4px`.

Actually, per spec §3.3 the badge uses the same visual language as the bell badge. Use `background: var(--moss)` to match. The spec says "red-bubble" colloquially but the design uses the existing badge color token.

**5d. Wire badge into both dock buttons:**
```tsx
{/* panelExpand button (desktop collapsed state): */}
<button className={styles.panelExpand} type="button"
  aria-label={unread > 0 ? `Open Keeper — ${unread} unread` : 'Open Keeper panel'}
  onClick={() => setPanelCollapsed(false)}>
  <span className={styles.keeperGlyph} aria-hidden="true"><Grovekeeper size={26} /></span>
  {unread > 0 && <span className={styles.dockBadge} aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>}
</button>

{/* panelToggle button (mobile): */}
<button className={styles.panelToggle} type="button"
  aria-label={panelOpen ? 'Close Keeper' : (unread > 0 ? `Open Keeper — ${unread} unread` : 'Open Keeper')}
  aria-expanded={panelOpen} onClick={() => setPanelOpen((v) => !v)}>
  {panelOpen ? '✕' : (
    <span className={styles.keeperGlyph} aria-hidden="true"><Grovekeeper size={32} /></span>
  )}
  {!panelOpen && unread > 0 && <span className={styles.dockBadge} aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>}
</button>
```

**Tests (vitest + @testing-library/react):**

**5e. `AppShell` renders dock badge when `unread > 0`:**
Mock `listLeaves` to return `{ unread: 3, items: [] }`. Render `<AppShell ... panel={<div />}>`. Assert a `[aria-label="3 unread"]` element is present (on the dock button).

**5f. No dock badge when `unread === 0`:**
Mock returns `unread: 0`. Assert no `.dockBadge` element is rendered.

**5g. Badge caps at `9+`:**
Mock returns `unread: 14`. Assert badge text is `9+`.

**5h. `NotificationBell` renders badge from `initialUnread` prop:**
Render `<NotificationBell initialUnread={5} />`. Assert badge shows `5` without waiting for any effect.

**Test command:** `npx vitest run apps/web/components/shell/AppShell.test.tsx apps/web/components/shell/NotificationBell.test.tsx`

**Commit:** `feat(shell): lift unread count + Keeper-dock red-bubble (§10.3)`

---

### Task 6 — `decideProposalAction` server action

**File:** `apps/web/app/app/actions.ts` (extend existing, near `decideRunAction`)
**Test file:** `apps/web/app/app/actions.test.ts`

**Write tests first.**

This action is required by Task 7 (the inline proposal cards on Grove Home). The user-facing `decideRunAction` already exists; model this on the same pattern.

**6a. `decideProposalAction` implementation:**
```ts
// 'use server' already at top of file.
export async function decideProposalAction(formData: FormData): Promise<{ error?: string }> {
  const proposalId = formData.get('proposalId');
  const decision = formData.get('decision');
  if (typeof proposalId !== 'string' || !proposalId) return { error: 'missing proposalId' };
  if (decision !== 'approved' && decision !== 'rejected') return { error: 'invalid decision' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('decide_memory_proposal', {
    p_proposal_id: proposalId,
    p_decision: decision,
  });
  if (error) return { error: error.message };
  return {};
}
```

The RPC is `decide_memory_proposal` (authenticated security-definer, already in F2). The action runs under the user's session, so RLS + membership check inside the RPC applies. No privilege elevation.

**Tests:**

**6b. Valid approval delegates to RPC:**
Mock `supabase.rpc('decide_memory_proposal', ...)` to return `{ error: null }`. Call `decideProposalAction` with valid `proposalId + decision='approved'`. Assert RPC was called with correct args. Assert no error in return.

**6c. Invalid decision returns error without calling RPC:**
Call with `decision='maybe'`. Assert RPC not called. Assert `{ error: 'invalid decision' }` returned.

**6d. Missing proposalId returns error:**
Empty `proposalId`. Assert `{ error: 'missing proposalId' }`.

**6e. RPC failure surfaces as error (not thrown):**
Mock RPC to return `{ error: { message: 'not a member' } }`. Assert `{ error: 'not a member' }` returned (not an uncaught throw — page does not crash).

**Test command:** `npx vitest run apps/web/app/app/actions.test.ts`

**Commit:** `feat(actions): decideProposalAction — inline proposal approve/reject`

---

### Task 7 — Grove Home: extended count + inline proposal cards

**File:** `apps/web/app/app/page.tsx`

This is a server component. Tests are integration-style (render + assert with mock Supabase) or verified via the adversarial gate manual check. Write targeted unit tests where extractable.

**7a. Add `reviewItemCount` parallel query:**
In the main `Promise.all` data block, add:
```ts
supabase
  .from('notifications')
  .select('id', { count: 'exact', head: true })
  .eq('account_id', accountId)
  .eq('kind', 'review_item')
  .is('read_at', null),
```
Return value: `{ count: reviewItemCount }`.

**7b. Extend `waiting` total:**
```ts
const waiting = (waitingCount ?? 0) + (reviewItemCount ?? 0);
```
The existing `NEEDS YOUR EYES` chipline and `"Waiting on you"` stat card now include proposals automatically.

**7c. Fetch pending proposals for the "Needs you" card:**
Add a parallel query for pending proposal cards. This query is only for the inline-approve UX (not for the count — the count comes from notifications):
```ts
supabase
  .from('proposals')
  .select('id, field_key, rationale, stakes')
  .eq('account_id', accountId)
  .eq('status', 'pending')
  .order('created_at', { ascending: false })
  .limit(5),
```
Return value: `pendingProposals`.

**Why query `proposals` here instead of `notifications`?** The card needs `field_key`, `rationale`, and `stakes` for each proposal. Joining from `notifications.source_id → proposals` in a Supabase client call requires two round-trips or a `.in()` on UUIDs. Querying `proposals` directly (scoped by RLS to `account_id` + `status='pending'`) is cleaner for the card UX. The count (§10.3) still comes from `notifications`. The card query is a presentation layer convenience — it does not replace the notification as source-of-truth for the count.

**7d. "Needs you" card: proposal section:**
After the existing `awaiting.length === 0 ? empty-state : draftStack` block, add a proposal section:
```tsx
{pendingProposals && pendingProposals.length > 0 && (
  <div className={home.proposalStack}>
    <div className={home.proposalSectionHead}>Memory proposals</div>
    {pendingProposals.map((p) => (
      <div className={home.proposalCard} key={p.id}>
        <div className={home.proposalField}>{p.field_key}</div>
        {p.rationale && (
          <div className={home.proposalRationale}>
            {p.rationale.length > 80 ? p.rationale.slice(0, 79) + '…' : p.rationale}
          </div>
        )}
        {p.stakes === 'high' && (
          <span className={home.proposalHighStakes}>High stakes</span>
        )}
        <div className={home.qbtns}>
          <form action={decideProposalAction} className={home.qbtnForm}>
            <input type="hidden" name="proposalId" value={p.id} />
            <input type="hidden" name="decision" value="approved" />
            <button className={`${home.qbtn} ${home.qbtnOk}`} type="submit">Approve</button>
          </form>
          <form action={decideProposalAction} className={home.qbtnForm}>
            <input type="hidden" name="proposalId" value={p.id} />
            <input type="hidden" name="decision" value="rejected" />
            <button className={`${home.qbtn} ${home.qbtnEdit}`} type="submit">Reject</button>
          </form>
        </div>
      </div>
    ))}
  </div>
)}
```

Import `decideProposalAction` from `./actions`.

**7e. CSS additions in `home.module.css`:**
- `.proposalStack` — same spacing as `.draftStack` (margin-top gap between draft stack and proposal stack).
- `.proposalSectionHead` — eyebrow-style label, smaller than `.tcardHead` (e.g., `font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-mid); margin-bottom: 8px;`).
- `.proposalCard` — similar structure to `.draftCard` but narrower padding; no creature sprite.
- `.proposalField` — `font-weight: 600; font-size: 13px;` field key display.
- `.proposalRationale` — `font-size: 12px; color: var(--ink-mid); margin: 2px 0 6px;`.
- `.proposalHighStakes` — small inline pill badge (`background: var(--coral-muted); color: var(--coral-deep); font-size: 10px; padding: 2px 6px; border-radius: var(--r-pill); margin-bottom: 6px; display: inline-block;`).

**7f. Empty "Needs you" card when both queues are empty:**
When `awaiting.length === 0 AND pendingProposals.length === 0`, existing empty-state copy covers it — no change needed.

**Tests:**

**7g. Extract `computeNeedsYouTotal` pure function for unit testing:**
Pull the total calculation into a testable helper:
```ts
// In page.tsx or a co-located util:
export function computeNeedsYouTotal(waitingCount: number | null, reviewItemCount: number | null): number {
  return (waitingCount ?? 0) + (reviewItemCount ?? 0);
}
```
Test: `computeNeedsYouTotal(3, 2) === 5`, `computeNeedsYouTotal(null, null) === 0`, `computeNeedsYouTotal(0, 0) === 0`.

**Test command:** `npx vitest run apps/web/app/app/page.test.ts`

**Commit:** `feat(grove-home): extend NEEDS YOUR EYES count + inline proposal cards`

---

### Task 8 — Adversarial gate

**File:** `docs/gates/2026-06-23-attention-queue.md`

Run the 4-reviewer adversarial gate per `adversarial-gate.yml`. Required before merge.

The gate panel must evaluate:

- **Red-team/security:** Can a client escalate a notification's `stakes` to `'high'`? (No — the only write path is service-role RPCs. Assert.) Does `loadPendingItems` ever return another account's data? (No — all queries `eq('account_id', accountId)` under user RLS.) Can the Keeper context include a prompt-injection payload via `rationale`? (Rationale is typed text from a service-role RPC; truncated to 80 chars; not rendered as HTML. Confirm the volatile suffix uses template literals, not `dangerouslySetInnerHTML`.)
- **Claims-auditor:** Is `§10.3` (one source of truth) preserved? The NEEDS YOUR EYES chipline count comes from `waitingCount + reviewItemCount` (two Supabase queries, both from the same `notifications` table or `runs` table — not from `proposals.status='pending'` directly for the total). The dock badge comes from `listLeaves` (same `notifications` table). Bell and dock badge are the same number.
- **Logic-skeptic:** Does `computeNeedsYouTotal` double-count? A proposal creates both a `proposals` row and a `review_item` notification. The count queries `notifications` (`review_item` + `read_at IS NULL`) — NOT `proposals` — so there's no double-count risk from counting proposals via two tables.
- **Cost-auditor:** `loadPendingItems` adds two queries per `keeperChatAction` call. Profile: one `SELECT` on `notifications` (indexed `account_id, kind`) + one `SELECT` on `runs` (indexed `account_id, status`). Both are bounded (limit 10 / limit 5). `loadGroveState` similarly. The unread fetch in `AppShell` is one COUNT query on mount; cached by Supabase edge. Net: 2 extra server queries per Keeper turn, 1 extra per shell mount — acceptable.

Gate report must be written to `docs/gates/2026-06-23-attention-queue.md` before the PR is opened.

**Commit:** `docs(gate): P6 attention-queue adversarial gate report`

---

### Task 9 — Full regression pass + PR

**Run the full suite:**
```
npm run lint
npm run typecheck
npx vitest run
npx vitest run tests/rls/
```

Fix any failures before opening the PR.

**Migration apply order:**
1. Apply `20260623100000_attention_queue_stakes.sql` to dev.
2. Verify: check that `notifications` table has `stakes` column; call `propose_memory_change` with 8 args and verify `stakes='high'` on the row.
3. Apply to staging, then prod.

**PR checklist:**
- [ ] `20260623100000_attention_queue_stakes.sql` applied to dev/staging/prod.
- [ ] `loadPendingItems` has unit tests green.
- [ ] `buildKeeperContext` has tests covering all branch paths.
- [ ] `AppShell` dock badge renders when unread > 0; not rendered when 0.
- [ ] `decideProposalAction` unit tests green.
- [ ] Grove Home: NEEDS YOUR EYES includes both `awaiting_approval` + `review_item` counts.
- [ ] Proposal inline approve/reject cards render; forms call `decideProposalAction`.
- [ ] Adversarial gate report filed.
- [ ] `npm run typecheck` green.
- [ ] `npm run lint` green.
- [ ] C10 verified: no write path through `loadPendingItems` or the Keeper prompt.

**Commit:** `chore: P6 attention-queue — final regression pass`

---

## Task Summary (commit order)

| # | Commit message | Files |
|---|---|---|
| 0 | `feat(db): add stakes column + extend insert/propose RPCs` | `supabase/migrations/20260623100000_attention_queue_stakes.sql` |
| 1 | `test(rls): attention-queue stakes migration + RPC param tests` | `tests/rls/attention-queue-stakes.test.ts` |
| 2 | `feat(grove): loadPendingItems — read-only pending queue utility (C10)` | `apps/web/lib/grove/pending-items.ts`, `pending-items.test.ts` |
| 3 | `feat(keeper): extend buildKeeperContext with pendingItems volatile suffix` | `packages/keeper/src/prompt.ts`, `prompt.test.ts` |
| 4 | `feat(grove): wire loadPendingItems into keeperChatAction + loadGroveState` | `apps/web/app/app/grove/actions.ts`, `actions.test.ts`, `apps/web/lib/grove/load.ts` |
| 5 | `feat(shell): lift unread count + Keeper-dock red-bubble (§10.3)` | `AppShell.tsx`, `NotificationBell.tsx`, `shell.module.css` |
| 6 | `feat(actions): decideProposalAction — inline proposal approve/reject` | `apps/web/app/app/actions.ts`, `actions.test.ts` |
| 7 | `feat(grove-home): extend NEEDS YOUR EYES count + inline proposal cards` | `apps/web/app/app/page.tsx`, `home.module.css`, `page.test.ts` |
| 8 | `docs(gate): P6 attention-queue adversarial gate report` | `docs/gates/2026-06-23-attention-queue.md` |
| 9 | `chore: P6 attention-queue — final regression pass` | (no new files) |

---

## Risks and Forks

**Risk 1 — `listLeaves` API surface for `AppShell`.**
`listLeaves` is currently called without arguments in `NotificationBell` and returns `{ items, unread }`. `AppShell` needs only `unread`. Confirm the action either accepts a `limit` or `headOnly` param, or add one (`limit: 0, head: true` style). If the action signature is locked (exported from `notifications/actions.ts`), add a lightweight `getUnreadCount()` wrapper that calls the existing action with no item fetch — avoids pulling 20 notification rows just for a count.

**Risk 2 — `@testing-library/react` not wired for `AppShell` tests.**
`AppShell` tests (Task 5) require a React test renderer. Check `vitest.config.ts` for jsdom / happy-dom environment and whether `@testing-library/react` is already in `apps/web`'s devDependencies. If not, these tests must mock at the hook level instead of rendering the full component — adjust accordingly.

**Risk 3 — `loadGroveState` initialMessages lead (Task 4a note).**
The scripted-floor `turnForState` produces `initialMessages` without model involvement. The Keeper's "pending items" lead is a model behavior (it reads the context suffix). If the user opens the Keeper without an API key (scripted floor), the pending-items intro doesn't appear in `initialMessages`. This is acceptable: the dock badge is the ambient signal, and the model behavior kicks in on the first real chat turn. Do NOT try to inject pending-items content into scripted `initialMessages` — that would break the scripted floor's determinism and misrepresent what the Keeper "knows" without a model call.

**Risk 4 — `decideProposalAction` revalidation.**
After a user approves/rejects a proposal via the inline Grove Home cards, the page should re-render to remove the card and update the "NEEDS YOUR EYES" count. The current `decideRunAction` pattern uses `revalidatePath('/app')` after the RPC call. Add the same call in `decideProposalAction`. Verify that `revalidatePath` is importable from `next/cache` in the actions file.

**Open fork (spec §F3 — confirmed user override):**
The design spec §F3 asked whether proposals should be a compact link or inline cards. The user's confirmed decision: **inline approve/reject cards per pending proposal** (Task 7d), not a compact link. This is baked into Task 7.

**Open fork (spec §F1 — stakes assignment rule):**
The spec confirms `origin='conflict'` ⇒ `stakes='high'`; routine ⇒ `'normal'`. No richer scoring function in this slice. The `propose_memory_change` callers set `p_stakes`; the migration doesn't encode the rule itself. Future collate/conflict workers (C1/C2) will pass `p_stakes='high'` when the origin is conflict — not in scope here.
