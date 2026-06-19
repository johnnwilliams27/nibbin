# Reach-Me Channels 05 — Conversation Orchestrator + Cost/Abuse Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two-way conversational layer — escalation replies routed through the existing approval gate (§7.1), read-only status/Q&A over a channel (§7.2), and you-initiated work routed through plan-preview + the approval gate (§7.3) — **with the §11 cost/abuse controls built first as its launch precondition** (D-N2): COGS attribution by channel origin (N17), per-account spend caps + an SMS sub-cap + a conversation-turn budget (N15), and runaway auto-pause.

**Architecture:** Build the guardrails before the surface. First extend `model_calls` with `origin`/`channel` and thread them through `recordModelCall` (N17). Then add fail-closed budgets (a new `account_spend` ledger + RPC) checked before any channel-initiated LLM turn, plus per-(account, channel) turn-anomaly auto-pause. Only then wire the conversation orchestrator: it consumes the verified inbound from Plan 03's `handoff`, and — staying within the existing invariants — routes a button-press/keyword through the **existing approval gate** (the Keeper has no hands, C10), answers status questions via `keeperChat` (read-only), and routes typed work intents to the Planner → plan-preview → gate (deep-linking anything sensitive, N-P2). Replies go out via the Plan 02 dispatcher.

**Tech Stack:** Postgres migration + RPC; `@nibbin/router` (`route({origin})`, `recordModelCall`); `@nibbin/keeper` (`keeperChat`); `@nibbin/runtime` (the `awaiting_approval`/`DraftStep` gate + `velocity`/`admissionBlock` patterns); `@nibbin/channels` dispatcher; Vitest.

## Global Constraints
- **D-N2 ordering:** §11 controls (Tasks 1–3) MUST be in place before the §7.3 you-initiated surface (Task 6) is enabled. §7.1/§7.2 (Tasks 4–5) are lower-risk and may ship alongside.
- **C10 (Keeper has no hands):** the orchestrator never executes a write. It answers (read), collects approvals (routes to the existing gate), or initiates work (hands to the Planner under the existing gates). Validate against `packages/runtime/src/validate.ts` Keeper-terminal rules.
- **P2 / approval gate:** a channel button/keyword is a *remote control* for the existing approval gate, never a bypass. Reuse the exact in-app approve/deny path (find it: search `apps/web/lib` for the action behind the `/app/approvals` UI that resolves an `awaiting_approval` run).
- **N-P2 secret boundary:** any step needing a secret/credential/OAuth → deep-link to the app; never collected on a channel.
- **Cheapest-eval-adequate (§11):** every conversational turn routes through the existing classifier (`route({ task: 'chat', origin: 'chat', text })`); long threads compact (reuse `conversation_threads.summary`).
- **Fail-closed budgets:** at a cap → throttle with a brand-voice "taking a breather — here's why" + an in-app path; never a silent drop or unbounded spend.
- Migrations are FILES only; orchestrator applies to dev/staging/prod + hash-verifies. Pick the next free timestamp at apply time.

## File Structure
- **Create** `supabase/migrations/20260618060000_model_calls_channel_origin.sql` — additive `origin`/`channel` columns + a channel-COGS aggregate.
- **Create** `supabase/migrations/20260618070000_channel_budgets.sql` — `account_spend` daily ledger + `channel_turn_take` fail-closed RPC + per-(account,channel) turn anomaly helper.
- **Modify** `apps/web/lib/llm/client.ts` — `recordModelCall` accepts `origin`/`channel`.
- **Create** `packages/channels/src/conversation/` — `budget.ts` (turn-budget gate types), `orchestrator.ts` (intent routing).
- **Create** `apps/web/lib/channels/conversation.ts` — wires the orchestrator to keeperChat + the approval gate + the dispatcher (replaces Plan 03's no-op `handoff`).
- Tests alongside each.

---

### Task 1: COGS attribution — `model_calls` origin + channel (N17)

**Files:**
- Create: `supabase/migrations/20260618060000_model_calls_channel_origin.sql`
- Modify: `apps/web/lib/llm/client.ts` (`recordModelCall`)
- Test: `apps/web/lib/llm/client.test.ts` (extend or create)

**Interfaces:**
- Consumes: existing `model_calls` (`20260612120000_m65_budget_cogs.sql:96`), `recordModelCall` (`apps/web/lib/llm/client.ts:38`).
- Produces: `model_calls.origin text check (origin in ('chat','pipeline'))`, `model_calls.channel text`; `recordModelCall` gains optional `origin?`, `channel?`.

- [ ] **Step 1: Write the migration**
```sql
-- N17: tag every LLM turn with where it came from. origin distinguishes
-- user-initiated chat from pipeline/agent work; channel records the reach-me
-- surface ('telegram','sms','whatsapp', or null for in-app/web). Additive +
-- nullable so existing inserts keep working.
alter table public.model_calls add column origin text check (origin in ('chat', 'pipeline'));
alter table public.model_calls add column channel text
  check (channel is null or channel in ('push','email','sms','telegram','whatsapp','in_app'));
create index model_calls_channel_idx on public.model_calls (account_id, channel, created_at);

-- channel-scoped COGS (for the §11 spend caps + admin visibility)
create or replace function public.account_channel_cogs(p_account uuid, p_channel text, p_days integer default 1)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_microusd), 0)::bigint
  from public.model_calls
  where account_id = p_account
    and (p_channel is null or channel = p_channel)
    and created_at > now() - make_interval(days => p_days);
$$;
revoke execute on function public.account_channel_cogs(uuid, text, integer) from public, anon;
grant execute on function public.account_channel_cogs(uuid, text, integer) to authenticated, service_role;
```

- [ ] **Step 2: Extend `recordModelCall`**

In `apps/web/lib/llm/client.ts`, add `origin?: 'chat' | 'pipeline'` and `channel?: string` to the `ModelCallRecord` type and pass them into the `.insert({...})` as `origin: rec.origin ?? null, channel: rec.channel ?? null`.

- [ ] **Step 3: Test**

Add to `apps/web/lib/llm/client.test.ts` a case asserting the insert payload includes `origin` + `channel` when provided (mock the supabase `.insert`). Run the test → PASS.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260618060000_model_calls_channel_origin.sql apps/web/lib/llm/client.ts apps/web/lib/llm/client.test.ts
git commit -m "feat(cost): tag model_calls with origin + channel (N17 COGS attribution)"
```

---

### Task 2: Fail-closed budgets — spend cap + SMS sub-cap + turn budget (N15)

**Files:**
- Create: `supabase/migrations/20260618070000_channel_budgets.sql`
- Test: `tests/rls/channel-budgets.test.ts`

**Interfaces:**
- Produces:
  - `account_spend (account_id, day_key date, conversation_turns int, channel_spend_microusd jsonb)` — daily.
  - `public.channel_turn_take(p_account uuid, p_day date, p_turn_limit int, p_channel text, p_channel_spend_cap_microusd bigint) returns table (granted boolean, turns int, channel_spent bigint)` — atomically: check the day's turn count < limit AND the channel's spend (from `account_channel_cogs`) < cap; if granted, increment the turn counter; fail-closed.

- [ ] **Step 1: Write the migration**
```sql
-- §11 budgets. A channel-initiated conversational turn (an LLM call) is metered
-- exactly like in-app work: it draws on the same credit system AND is bounded by
-- a per-day turn budget and a per-channel spend cap (the metered SMS sub-cap is
-- the tightest). Fail-closed: channel_turn_take returns granted=false at the cap.
create table public.account_spend (
  account_id uuid not null references public.accounts (id) on delete cascade,
  day_key date not null,
  conversation_turns int not null default 0 check (conversation_turns >= 0),
  primary key (account_id, day_key)
);
alter table public.account_spend enable row level security;
create policy account_spend_member_read on public.account_spend
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke all on public.account_spend from anon;
revoke insert, update, delete, truncate, references, trigger on public.account_spend from authenticated;

create or replace function public.channel_turn_take(
  p_account uuid,
  p_day date,
  p_turn_limit int,
  p_channel text,
  p_channel_spend_cap_microusd bigint
)
returns table (granted boolean, turns int, channel_spent bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turns int;
  v_spent bigint := public.account_channel_cogs(p_account, p_channel, 1);
begin
  insert into public.account_spend (account_id, day_key, conversation_turns)
  values (p_account, p_day, 0)
  on conflict (account_id, day_key) do nothing;

  select conversation_turns into v_turns
    from public.account_spend
   where account_id = p_account and day_key = p_day
   for update;

  if v_turns >= p_turn_limit or v_spent >= p_channel_spend_cap_microusd then
    return query select false, v_turns, v_spent;
    return;
  end if;

  update public.account_spend
     set conversation_turns = conversation_turns + 1
   where account_id = p_account and day_key = p_day
   returning conversation_turns into v_turns;
  return query select true, v_turns, v_spent;
end;
$$;
revoke execute on function public.channel_turn_take(uuid, date, int, text, bigint) from public, anon, authenticated;
grant execute on function public.channel_turn_take(uuid, date, int, text, bigint) to service_role;
```

- [ ] **Step 2: Write the RLS/behavior test**

Create `tests/rls/channel-budgets.test.ts` (mirror `drip.test.ts` setup): a member can read their own `account_spend`; anon cannot; `channel_turn_take` is service-role-only; it grants until `p_turn_limit`, then returns `granted=false`; it returns `granted=false` immediately when `account_channel_cogs` ≥ cap (seed a `model_calls` row with a big `cost_microusd` for `channel='sms'`).

- [ ] **Step 3: Run → PASS (or skipped without DB). Commit.**
```bash
git add supabase/migrations/20260618070000_channel_budgets.sql tests/rls/channel-budgets.test.ts
git commit -m "feat(cost): fail-closed channel turn budget + per-channel spend cap (N15)"
```

---

### Task 3: Runaway auto-pause + the "taking a breather" gate

**Files:**
- Create: `packages/channels/src/conversation/budget.ts`
- Test: `packages/channels/test/conversation-budget.test.ts`

**Interfaces:**
- Produces:
  - `interface TurnGateDeps { take(accountId, channel): Promise<{ granted: boolean; turns: number; channelSpent: number }>; anomaly(accountId, channel): Promise<boolean> }`
  - `interface TurnGateConfig { turnLimit: number; smsSpendCapMicroUsd: number; defaultSpendCapMicroUsd: number }`
  - `gateTurn(accountId, channel, deps, cfg): Promise<{ ok: true } | { ok: false; reason: 'budget' | 'anomaly'; notice: string }>` — the single pre-LLM check. Picks the SMS sub-cap for `channel==='sms'`, else the default cap. Anomaly auto-pause (per-(account,channel) volume spike) returns `ok:false, reason:'anomaly'`. The `notice` is brand-voice "taking a breather".

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { gateTurn, type TurnGateDeps } from '@nibbin/channels';

const cfg = { turnLimit: 50, smsSpendCapMicroUsd: 200_000, defaultSpendCapMicroUsd: 1_000_000 };

function deps(over: Partial<TurnGateDeps> = {}): TurnGateDeps {
  return {
    async take() { return { granted: true, turns: 1, channelSpent: 0 }; },
    async anomaly() { return false; },
    ...over,
  };
}

describe('gateTurn', () => {
  it('passes when under budget and not anomalous', async () => {
    expect(await gateTurn('a', 'telegram', deps(), cfg)).toEqual({ ok: true });
  });
  it('blocks (budget) with a brand-voice breather notice', async () => {
    const r = await gateTurn('a', 'sms', deps({ async take() { return { granted: false, turns: 50, channelSpent: 0 }; } }), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('budget'); expect(r.notice).toMatch(/breather/i); expect(r.notice).toMatch(/app/i); }
  });
  it('blocks (anomaly) before spending', async () => {
    const r = await gateTurn('a', 'telegram', deps({ async anomaly() { return true; } }), cfg);
    expect(r).toMatchObject({ ok: false, reason: 'anomaly' });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `packages/channels/src/conversation/budget.ts`:
```ts
import type { ChannelKind } from '../types.js';

export interface TurnGateDeps {
  take(accountId: string, channel: ChannelKind): Promise<{ granted: boolean; turns: number; channelSpent: number }>;
  anomaly(accountId: string, channel: ChannelKind): Promise<boolean>;
}

export interface TurnGateConfig {
  turnLimit: number;
  smsSpendCapMicroUsd: number;
  defaultSpendCapMicroUsd: number;
}

const BREATHER =
  'Your grove is taking a breather — it has been unusually busy and paused to stay within your limits. Open the app to pick up where it left off.';

export type TurnGateResult = { ok: true } | { ok: false; reason: 'budget' | 'anomaly'; notice: string };

export async function gateTurn(
  accountId: string, channel: ChannelKind, deps: TurnGateDeps, _cfg: TurnGateConfig,
): Promise<TurnGateResult> {
  // anomaly check first — auto-pause before any spend (ties §11 / AS-§18.4)
  if (await deps.anomaly(accountId, channel)) return { ok: false, reason: 'anomaly', notice: BREATHER };
  const r = await deps.take(accountId, channel);
  if (!r.granted) return { ok: false, reason: 'budget', notice: BREATHER };
  return { ok: true };
}
```
Export `gateTurn`, `TurnGateDeps`, `TurnGateConfig`, `TurnGateResult` from `index.ts`. The `take` impl in `apps/web` calls `channel_turn_take` with the SMS sub-cap when `channel==='sms'`, else the default; `anomaly` reuses the per-(account,channel) volume-vs-baseline check modeled on `packages/runtime/src/stores.ts:189` (`admissionBlock`).

- [ ] **Step 4: Run → PASS. Commit.**
```bash
git add packages/channels/src/conversation/budget.ts packages/channels/src/index.ts packages/channels/test/conversation-budget.test.ts
git commit -m "feat(cost): pre-LLM turn gate — budget + per-channel cap + anomaly auto-pause"
```

---

### Task 4: §7.1 — escalation replies route through the existing approval gate

**Files:**
- Create: `packages/channels/src/conversation/orchestrator.ts` (the pure intent router)
- Test: `packages/channels/test/orchestrator.test.ts`

**Interfaces:**
- Consumes: `InboundChannelMessage` (Plan 03).
- Produces:
  - `type Intent = { kind: 'approval'; requestId: string; decision: 'approve' | 'deny' } | { kind: 'status'; text: string } | { kind: 'work'; text: string }`
  - `classifyIntent(inbound: InboundChannelMessage): Intent` — a button/keyword with `inReplyTo` + `action` → `approval`; a question → `status`; an imperative/work request → `work` (reuse the router's classifier signals for status-vs-work, or a small verb heuristic; the model arbitrates ambiguous cases in Task 6).

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { classifyIntent } from '@nibbin/channels';

describe('classifyIntent', () => {
  it('a button press with requestId + action is an approval', () => {
    expect(classifyIntent({ channel: 'telegram', externalId: '9', text: 'r1:approve', inReplyTo: 'r1', action: 'approve', receivedAt: 1 }))
      .toEqual({ kind: 'approval', requestId: 'r1', decision: 'approve' });
  });
  it('a question is a status intent', () => {
    expect(classifyIntent({ channel: 'telegram', externalId: '9', text: 'what is my grove doing?', receivedAt: 1 }).kind).toBe('status');
  });
  it('an imperative is a work intent', () => {
    expect(classifyIntent({ channel: 'telegram', externalId: '9', text: 'draft this month invoice follow-ups', receivedAt: 1 }).kind).toBe('work');
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `packages/channels/src/conversation/orchestrator.ts`:
```ts
import type { InboundChannelMessage } from '../inbound/types.js';

export type Intent =
  | { kind: 'approval'; requestId: string; decision: 'approve' | 'deny' }
  | { kind: 'status'; text: string }
  | { kind: 'work'; text: string };

const WORK_VERBS = /\b(draft|write|send|chase|schedule|follow ?up|create|reply|cancel|pay|book|update)\b/i;
const QUESTION = /\?|\b(what|when|why|how|did|is|are|status|show|tell me)\b/i;

export function classifyIntent(inbound: InboundChannelMessage): Intent {
  if (inbound.inReplyTo && inbound.action) {
    return { kind: 'approval', requestId: inbound.inReplyTo, decision: inbound.action };
  }
  // imperative work verbs win over question words ("draft and send me X")
  if (WORK_VERBS.test(inbound.text)) return { kind: 'work', text: inbound.text };
  if (QUESTION.test(inbound.text)) return { kind: 'status', text: inbound.text };
  return { kind: 'status', text: inbound.text };
}
```
Export `classifyIntent`, `Intent` from `index.ts`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Wire the approval path** in `apps/web/lib/channels/conversation.ts` (created here, expanded in Tasks 5–6): for an `approval` intent, call the **existing** in-app approve/deny function (the one behind `/app/approvals` that resolves an `awaiting_approval` run — locate it and import it; do NOT reimplement the gate). On success, deliver a confirmation via the Plan 02 dispatcher ("Approved — Scout is on it."). Add a unit test that the approval intent calls the gate function with `(requestId, decision)` and never executes a write directly.

- [ ] **Step 6: Commit**
```bash
git add packages/channels/src/conversation/orchestrator.ts packages/channels/src/index.ts packages/channels/test/orchestrator.test.ts apps/web/lib/channels/conversation.ts
git commit -m "feat(channels): intent classifier + escalation replies through the existing approval gate (§7.1)"
```

---

### Task 5: §7.2 — status/questions (read-only) via keeperChat

**Files:**
- Modify: `apps/web/lib/channels/conversation.ts`
- Test: `apps/web/lib/channels/conversation.test.ts`

**Interfaces:**
- Consumes: `gateTurn` (Task 3), `classifyIntent` (Task 4), `keeperChat` (`@nibbin/keeper`), `route` (`@nibbin/router`), `recordModelCall` with `origin:'chat', channel`, the dispatcher (Plan 02).
- Produces: `handleInbound(verified, deps): Promise<void>` — the real implementation of Plan 03's `handoff`. For a `status` intent: run `gateTurn`; if blocked, deliver the breather notice; else call `keeperChat` (read-only — answers from run history/memory; never a tool/write), record the turn's COGS with `origin:'chat'` + the channel, and deliver the reply.

- [ ] **Step 1: Write the failing test** — assert: (a) a blocked turn delivers the breather notice and never calls `keeperChat`; (b) an allowed status turn calls `keeperChat` once, records a `model_calls` row with `origin:'chat'` + the right `channel`, and delivers the reply text. (Inject fakes for the gate, keeperChat, recorder, dispatcher.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the `status` branch of `handleInbound` (quarantined inbound text from Plan 03 is the `keeperChat` input; the keeper stays the pure no-hands function). Compact the thread into `conversation_threads.summary` when `turn_count` crosses a threshold (reuse the existing summary field; a simple truncate-to-N is fine for v1, flagged for upgrade).

- [ ] **Step 4: Run → PASS. Commit.**
```bash
git add apps/web/lib/channels/conversation.ts apps/web/lib/channels/conversation.test.ts
git commit -m "feat(channels): you-initiated status/questions over a channel (read-only, budgeted) (§7.2)"
```

---

### Task 6: §7.3 — you-initiated work → plan-preview → approval gate (the headline, gated)

**Files:**
- Modify: `apps/web/lib/channels/conversation.ts`
- Test: `apps/web/lib/channels/conversation.test.ts` (extend)

**Interfaces:**
- Consumes: the Planner seam. **Dependency note:** the full Planner (AS-§6, "typed intent → plan-preview") is part of Agent Synthesis and may not exist yet. Build the seam with the Planner **injected** (`deps.planner?: (accountId, text) => Promise<PlanPreview | null>`); when absent or it returns null, deliver an honest "I can't take that on yet — here's what I can do" reply (never a silent no-op, never an ungated action).
- Produces: the `work` branch of `handleInbound`:
  1. `gateTurn` (budget/anomaly) — this is the §11 launch gate for §7.3 (D-N2). If blocked → breather.
  2. `deps.planner(accountId, quarantinedText)` → a `PlanPreview { title; steps; needsSecret: boolean }`.
  3. If `needsSecret` or any step is sensitive/destructive → deliver a **deep-link to the app** (N-P2), do NOT collect on-channel.
  4. Else deliver the plan-preview with Approve/Deny actions → on approval, route through the **existing approval gate** (same path as Task 4) which runs the plan under the normal validator/School/credit gates. The orchestrator itself never executes (C10).

- [ ] **Step 1: Write the failing tests** — assert: (a) `work` intent is gated by `gateTurn` (blocked → breather, planner never called); (b) a plan needing a secret delivers a deep-link and never an on-channel action; (c) an approved non-sensitive plan-preview routes to the existing gate, not a direct execute; (d) with no planner injected, an honest "can't act yet" reply is delivered.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the `work` branch per the interface above. Keep a `CHANNELS_INITIATED_WORK_ENABLED` flag (default false) so §7.3 can be dark-launched until the Planner + §11 are verified together (D-N2: the controls ship *as part of* §7.3). Behind the flag-off path, deliver the honest "status/questions only for now" reply.

- [ ] **Step 4: Run → PASS. Typecheck (`tsc -p apps/web`). Commit.**
```bash
git add apps/web/lib/channels/conversation.ts apps/web/lib/channels/conversation.test.ts
git commit -m "feat(channels): you-initiated work seam — plan-preview + approval gate + secret deep-link (§7.3, gated)"
```

- [ ] **Step 5: Wire `handleInbound` into Plan 03's `handoff`** — replace the no-op in `apps/web/lib/channels/ingest-deps.ts` `handoff` with a call to `handleInbound`, passing the service-role deps (gate `take`/`anomaly`, keeperChat with the model client, the approval-gate function, the dispatcher). Add an integration test that a verified inbound chat round-trips to a delivered reply. Commit.

---

## Self-review notes
- **D-N2 ordering honored:** §11 controls (Tasks 1–3) precede and gate §7.3 (Task 6); the turn gate runs before every channel-initiated LLM call.
- **N5/N7/N8/N9 (gate, no-hands, secret boundary):** approvals + work both route through the *existing* approval gate; the orchestrator never executes; secrets deep-link. C10 verified against `runtime/validate.ts`.
- **N15/N17 (cost+abuse):** `model_calls.origin/channel` (N17); fail-closed `channel_turn_take` with SMS sub-cap; pre-LLM anomaly auto-pause; cheapest-adequate via the existing classifier; "taking a breather" at the cap.
- **N10 (memory):** the keeper sees the Plan 03 quarantined+redacted text; threads compact into `conversation_threads.summary`.
- **Honest degradation:** §7.3 is flag-gated and, without a Planner, returns an honest "can't act yet" — never a silent or ungated action.
- **Deferred:** the real Planner (Agent Synthesis); richer thread summarization; per-(account,channel) anomaly tuning; admin COGS-by-channel card (the `account_channel_cogs` aggregate is ready to surface).
