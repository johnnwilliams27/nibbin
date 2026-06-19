# Channel-Initiated Work (§7.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a verified channel user (Telegram) text the bot a task → the bot runs the merged Planner, shows a plan preview, and on confirmation starts a plan run whose every side-effecting step is approved (or answered) **in chat** — full start-and-resume — until done. Surfaces gating that already exists in the runtime; adds no new execution authority.

**Architecture:** A per-binding **work session** (`channel_work_session`, keyed by `(channel, external_id)`) holds the one in-flight conversational state — a proposed plan awaiting Start, or a running plan awaiting an approval tap / a typed answer. Inbound routing consults the session first, so callback payloads stay tiny (`ps:go`/`pw:approve` — the session names the run/request; no run IDs in callback data, no leak). Channel-context planner wrappers (`apps/web/lib/planner/channel.ts`) call the SAME planner lib the in-app server actions use, but principal-explicit (`accountId`,`userId` resolved from the verified binding + `linked_by`), since the channel path has no `appSession`.

**Tech Stack:** Next.js 15, Supabase (Postgres 17), `@nibbin/channels`, `@nibbin/runtime` (Planner: `planForIntent`, `startPlanRun` logic, `respondToRequest`, `SupabasePlanRunStore`, `buildPlannerRunDeps`, `PLAN_CEILINGS`, `validatePlanSpec`), Vitest.

## Global Constraints

- **Extensionless relative imports** in `packages/**` and `apps/web/**` (no `.js` specifiers).
- Run **`npm run typecheck` AND `npm run lint` AND full `npm test` AND `npm run build`** before the PR (typecheck is a separate CI gate; vitest+lint do not catch all type errors). Clear `apps/web/.next` before a local typecheck.
- Every new SQL function: `security definer`, `set search_path = ''`, fully-qualified identifiers, `revoke execute from public, anon, authenticated`, `grant` to `service_role` only (these are service-role channel RPCs). `audit_log` columns: `(account_id, actor, actor_id, action, subject, meta)`.
- New migration numbered after the latest on `main` (`git ls-tree -r --name-only origin/main -- supabase/migrations | sort | tail -1`); pick the next `20260619NNNNNN`/`20260620NNNNNN` slot above it. Do NOT apply to any DB (applied at merge).
- **Feature flag:** all new behavior is gated by `deps.workEnabled` (from `CHANNELS_INITIATED_WORK_ENABLED`). Default in code stays **off**; it is enabled in prod via the env var. When `workEnabled` is false, the existing honest-degrade message is unchanged.
- **Security invariants (do not weaken):** account/user resolved ONLY from a `status='verified'` binding (+ `linked_by`); a non-verified sender is dropped pre-LLM (existing ingest). The Planner's per-write gating is the runtime's (`student` stage drafts everything; `respondToRequest` FIX 1 re-asserts surface+draft-class). This feature only *surfaces* it — never executes an effect itself.
- **Cost:** every model call already lands in `model_calls` (origin `chat`, the channel tag); the per-turn `channel_turn_take` gate (turn limit + per-channel spend cap, fail-closed) wraps each inbound work turn; the Planner enforces per-run ceilings + the 3-concurrent cap + the 5/user/day frontier budget. Wire the gate around the work turn exactly as the status turn does.

---

### Task 1: `channel_work_session` table + service-role RPCs

One row per `(channel, external_id)` binding = the single in-flight conversational state.

**Files:**
- Create: `supabase/migrations/<next>_channel_work_session.sql`
- Read first (mirror grant/RLS style): `supabase/migrations/20260618140000_channel_budgets.sql` and `20260618060000_plan_runs.sql`

**Interfaces (produces):**
- Table `public.channel_work_session(account_id uuid, channel text, external_id text, kind text check in ('proposed','awaiting'), plan jsonb, plan_run_id uuid, request_id text, request_kind text, updated_at timestamptz, primary key (channel, external_id))`.
- `channel_work_session_set(p_account uuid, p_channel text, p_external_id text, p_kind text, p_plan jsonb, p_run uuid, p_request_id text, p_request_kind text) returns void` — upsert (on conflict (channel, external_id) do update), service-role.
- `channel_work_session_clear(p_channel text, p_external_id text) returns void` — delete, service-role.
- (read is a plain service-role `select`, no RPC needed.)

- [ ] **Step 1: Write the migration** — table with RLS enabled + `revoke all from anon, authenticated` (service-role-definer writes only); FK `account_id → accounts(id) on delete cascade`; both RPCs `security definer`/`search_path=''`/`grant execute to service_role`. `channel_work_session_set` upserts on `(channel, external_id)`. Keep it minimal — no triggers.
- [ ] **Step 2:** (No app test for the table itself; it's exercised via Task 3's orchestrator tests + an optional `tests/rls/` smoke that calls set/clear as service-role.) Add the RLS smoke if the harness is quick to extend; else note it.
- [ ] **Step 3: Commit.**

---

### Task 2: Channel-context planner wrappers (`apps/web/lib/planner/channel.ts`)

Principal-explicit equivalents of the `proposePlan`/`startPlanRun`/`respondToPlanRun` server actions, callable from the service-role channel path (no `appSession`). Reuse the same lib primitives so behavior can't drift.

**Files:**
- Create: `apps/web/lib/planner/channel.ts`
- Read first: `apps/web/app/app/planner/actions.ts` (the logic to mirror: re-stamp `PLAN_CEILINGS`, `validatePlanSpec` fail-closed, `countRunning` cap = `MAX_CONCURRENT_RUNNING` 3, `SupabasePlanRunStore.create`, `buildPlannerRunDeps`, `runPlan` with `newRunId`, `respondToRequest`), `apps/web/lib/planner/plan.ts` (`planForIntent`), `apps/web/lib/planner/run.ts` (`respondToRequest`, `buildPlannerRunDeps`, `PlanResponse`), `apps/web/lib/runtime/engine.ts` (`activeConnections`).
- Test: `apps/web/lib/planner/channel.test.ts`

**Interfaces (produces):**
- `proposePlanForChannel(accountId, userId, intent): Promise<ProposeResult>` — `grantedProviders(accountId)` then `planForIntent(...)`.
- `startPlanRunForChannel(accountId, userId, plan): Promise<PlanOutcome | { error: string }>` — re-stamp ceilings, validate fail-closed, concurrency cap, create, `runPlan`.
- `respondToPlanRunForChannel(accountId, userId, runId, response): Promise<PlanOutcome>` — `buildPlannerRunDeps` + `respondToRequest`.
- A shared `grantedProviders(accountId)` (extract the one from `actions.ts` into a shared util both import, OR replicate — prefer extracting `apps/web/lib/planner/principal.ts` with the ceiling-restamp + validate + concurrency core and have BOTH `actions.ts` and `channel.ts` call it, to prevent drift. If extraction risks the server actions, replicate with a clear comment and a TODO to converge.)

- [ ] **Step 1: Write a failing test** for `startPlanRunForChannel` using `InMemoryPlanRunStore` + a stub planner deps (mirror how `actions`/planner tests inject deps). Assert: a tampered/off-surface plan is refused with `{error}` and NO run created; a valid plan returns a `PlanOutcome`; the concurrency cap returns `{error}` at 3 running.
- [ ] **Step 2:** Run it → fails (module missing).
- [ ] **Step 3: Implement `channel.ts`** mirroring `actions.ts` exactly but with explicit `(accountId, userId)`; no `'use server'`, no `appSession`, no `rateGuard` UI string (keep the concurrency cap; the per-turn `channel_turn_take` gate is the channel's rate guard). Re-stamp `PLAN_CEILINGS`, `validatePlanSpec` fail-closed before any create.
- [ ] **Step 4:** Run tests → pass.
- [ ] **Step 5: Commit.**

---

### Task 3: Orchestrator session state machine (`conversation.ts`)

Make `handleInbound` session-aware and add the work loop. This is the heart of the feature.

**Files:**
- Modify: `apps/web/lib/channels/conversation.ts` (`HandleInboundDeps` + `handleInbound`)
- Modify: `packages/channels/src/conversation/intent.ts` (or wherever `classifyIntent`/`Intent` live — grep) only if a new intent discriminant is needed; prefer routing in `handleInbound` over changing the classifier.
- Test: the existing conversation orchestrator test file (grep `handleInbound` under `packages/channels/test` / `apps/web`) — extend it.

**New deps on `HandleInboundDeps`:**
- `proposeWork(accountId, userId, intent): Promise<ProposeResult>`
- `startWork(accountId, userId, plan): Promise<PlanOutcome | {error}>`
- `respondWork(accountId, userId, runId, response): Promise<PlanOutcome>`
- `session: { get(channel, externalId): Promise<WorkSession | null>; set(s: WorkSession): Promise<void>; clear(channel, externalId): Promise<void> }`
- `principal(channel, externalId): Promise<{ accountId: string; userId: string } | null>` — resolve from the verified binding (+ `linked_by`), mirroring `decideViaChannel`. (handleInbound already gets `accountId` from ingest; `userId`=`linked_by` is the new bit. Pass both in via the existing verified payload if cleaner.)
- `replyWithActions(channel, externalId, body, actions): Promise<void>` — a reply carrying inline buttons (Task 4).
- `workEnabled: boolean` (already present).

`WorkSession = { accountId; channel; externalId; kind: 'proposed'|'awaiting'; plan?; planRunId?; requestId?; requestKind?: 'approval'|'auth'|'decision'|'value' }`

**Routing logic (pseudocode — implement faithfully):**

```
handleInbound(verified, deps):
  session = await deps.session.get(channel, externalId)

  // (A) Button callbacks (inbound.action / structured callback — see Task 4)
  if inbound is a plan callback:
     if 'ps:go'      and session?.kind==='proposed':  outcome = startWork(acct,user,session.plan); await applyOutcome(...)
     if 'ps:cancel'  and session?.kind==='proposed':  clear; reply "Okay — dropped it."
     if 'pw:approve' and session?.kind==='awaiting' && requestKind==='approval':
                       outcome = respondWork(acct,user,session.planRunId,{requestId:session.requestId,approval:'approved'}); applyOutcome
     if 'pw:reject'  ... approval:'rejected'; applyOutcome
     return
  // legacy agent-run approve/deny callback (existing decideViaChannel path) is UNCHANGED — keep it.

  // (B) Free-text while a session is awaiting a typed answer
  if session?.kind==='awaiting' && requestKind in ('auth','decision','value'):
     outcome = respondWork(acct,user,session.planRunId,{requestId:session.requestId, value: inbound.text}); applyOutcome; return
  if session?.kind==='awaiting' && requestKind==='approval':
     reply "Tap Approve or Reject on the message above (or say 'cancel')."  // 'cancel' keyword → clear+reply
     return
  if session?.kind==='proposed':
     reply "Tap Start to go ahead, or Cancel."  // 'cancel' keyword → clear
     return

  // (C) No active session → classify
  intent = deps.classify(inbound)
  approval → existing decideViaChannel path (UNCHANGED)
  status   → existing gate→answer path (UNCHANGED)
  work:
     if !deps.workEnabled: existing honest-degrade (UNCHANGED); return
     g = await deps.gate(acct, channel); if !g.ok: reply g.notice; return
     res = await deps.proposeWork(acct,user,inbound.text)
     if 'error' in res: reply res.error; return
     await deps.session.set({kind:'proposed', plan:res.plan, ...})
     replyWithActions(preview(res.preview), [Start, Cancel])
     if g.warn: reply g.warn.notice
     return

applyOutcome(outcome, ctx):
  switch outcome.kind:
   'needs_input' && request.kind==='approval':
       session.set({kind:'awaiting', planRunId:runId, requestId:request.requestId, requestKind:'approval'})
       replyWithActions(draftSummary(request), [Approve, Reject])
   'needs_input' (auth|decision|value):
       session.set({kind:'awaiting', planRunId:runId, requestId:request.requestId, requestKind:request.kind})
       reply(request.question)
   'done':   session.clear(); reply(resultSummary(outcome.artifact))
   'failed': session.clear(); reply("That didn't work out — open the app to see what happened.")
   'killed': session.clear(); reply(killSummary(outcome.reason))   // friendly per reason
```

- `preview(p)` renders goal + intendedSteps + a one-line "it can use: <surface/connectors>". `draftSummary(request)` renders `request.context.title`/what it'll do. `resultSummary(artifact)` renders the artifact's human text (best-effort; fall back to "Done.").
- A `'cancel'` free-text keyword while a session is active → `clear` + "Okay — dropped it." (so a user is never stuck).

- [ ] **Step 1:** Write failing orchestrator tests for each branch (propose→Start→needs_input(approval)→approve→done; a value question answered by text; cancel; workEnabled=false degrade unchanged; status/approval paths still work) using injected fake deps + a fake session store.
- [ ] **Step 2–4:** Implement the routing + `applyOutcome`; iterate to green.
- [ ] **Step 5: Commit.**

---

### Task 4: Telegram buttons + callback parsing

Let replies carry inline buttons and route the new callback payloads, without breaking the legacy agent-run `requestId:approve|deny`.

**Files:**
- Modify: `packages/channels/src/inbound/telegram.ts` (`parseTelegramUpdate` — recognize `ps:go|ps:cancel|pw:approve|pw:reject` and surface them as a structured field on `InboundChannelMessage`, e.g. `planAction?: 'ps:go'|'ps:cancel'|'pw:approve'|'pw:reject'`; keep `inReplyTo`/`action` for legacy).
- Modify: `packages/channels/src/types.ts` (`InboundChannelMessage.planAction?`; `ChannelAction` — add an explicit `callbackData?: string` so an action can carry `ps:go` etc.).
- Modify: `packages/channels/src/adapters/telegram.ts` (render `ChannelAction.callbackData` when present as the inline button `callback_data`; existing `approve|deny` rendering unchanged).
- Modify: the reply path so the orchestrator can send buttons — add `replyWithActions` to `ingest-deps.ts` (Task 5) backed by `port.deliver({ kind:'reply', body, actions })`; confirm `port.deliver`/`OutboundChannelMessage` carries `actions` (the escalation path already renders actions — reuse that field).
- Test: `packages/channels/test/inbound-telegram.test.ts` (+ adapter test) — new callbacks parse; legacy approve/deny still parse; `callbackData` renders.

- [ ] **Step 1:** Failing tests for the 4 new callback payloads + legacy unchanged + `callbackData` button render.
- [ ] **Step 2–4:** Implement; green.
- [ ] **Step 5: Commit.**

---

### Task 5: Wire channel deps + result delivery (`ingest-deps.ts`)

Build the live deps for Task 3 over the service client + the verified binding.

**Files:**
- Modify: `apps/web/lib/channels/ingest-deps.ts` (`supabaseIngestDeps`): add `proposeWork`/`startWork`/`respondWork` (delegating to `apps/web/lib/planner/channel.ts`), `session` (over `channel_work_session_set`/`_clear` + a select), `principal` (resolve account+`linked_by` from `notification_channels`, mirroring `decideViaChannel`), `replyWithActions` (via `buildReply` + actions), and pass `workEnabled = process.env.CHANNELS_INITIATED_WORK_ENABLED === 'true'`.
- Read first: `apps/web/lib/runtime/decide.ts` (binding→account+linked_by resolution to mirror), `apps/web/lib/channels/ports.ts` (the reply/deliver path + actions).
- Test: extend `apps/web/lib/channels/ingest-deps.test.ts` for the new deps' wiring (mock the RPCs/planner).

- [ ] **Step 1–4:** Implement each dep; unit-test the wiring (the planner calls are mocked — the real loop is the planner's own tests).
- [ ] **Step 5: Commit.**

---

## Cross-cutting (after all tasks)
- [ ] `npm run typecheck` (clear `.next` first), `npm run lint`, full `npm test`, `npm run build` — all green; grep changed files for `.js` specifiers.
- [ ] Open PR `feature/channel-initiated-work` → `main`; auto-merge squash.
- [ ] Adversarial gate (sensitive surface: initiates real work from chat) — 4 reviewers + record under `docs/gates/`.
- [ ] At merge: apply the Task 1 migration to dev→staging→prod; set `CHANNELS_INITIATED_WORK_ENABLED=true` in Vercel prod (default-ON per owner decision) + redeploy.
