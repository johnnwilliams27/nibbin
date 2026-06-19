# Planner Slice 3a (supervised bounded-ReAct Planner) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Spec: `docs/superpowers/specs/2026-06-18-planner-slice3a-design.md`. Builds on the Composer (2a #139 / 2b #141 / 2c #142).

**Goal:** Build mode C — a supervised bounded-ReAct loop that picks its next tool at runtime over a validated, pre-provisioned surface, with plan-preview, resumable ask-human/approval blocking, the standard utility toolset (incl. web-search), and tight ceilings.

**Architecture:** A new `runPlan` harness (packages/runtime) drives a ReAct loop; it reuses the runner's per-step gates by extracting them into a shared `dispatchStep`. A plan is synthesized by an LLM (`planForIntent`), validated fail-closed (`validatePlanSpec`), previewed for consent, then executed. Writes and ask-human both pause the run as a resumable `needs_input`, persisted in a new `plan_runs` table; `respondToRequest` resumes. Web-search egresses redacted queries to an allowlisted provider and quarantines results.

**Tech Stack:** TypeScript (packages/runtime, apps/web Next 15.3), Supabase (3 DBs), the model router (`groveRouter`, `frontier` tier), the redaction battery (`@nibbin/redaction` `applyBattery`), pgvector memory (`memory_entries`, #135).

**This is a subsystem.** The 7 tasks are sequenced phases; each compiles and is independently testable. Run the full verification (tsc + vitest + eslint + next build) at the end of every task, not just at the end. The migration (Task 3) is written but applied by the controller, not the implementer.

## File structure
- **Modify** `packages/runtime/src/types.ts` — `PlanSpec`, `PlannerTool`, `PlanRunState`, `PendingRequest`; extend `RunOutcome`/`RunResult` with `needs_input`.
- **Modify** `packages/runtime/src/runner.ts` — extract per-step gating into an exported `dispatchStep`; `executeRun` calls it (no behavior change).
- **Create** `packages/runtime/src/planner.ts` — `runPlan` (the ReAct loop) + the utility dispatch + `maxIterations`/no-progress kill.
- **Create** `packages/runtime/src/utilities.ts` — the standard utility registry (scratchpad/memory.retrieve/web.search/web.fetch/ask_human/done) as typed descriptors + arg schemas.
- **Modify** `packages/runtime/src/validate.ts` — `validatePlanSpec` + `validatePick`.
- **Create** `apps/web/lib/planner/plan.ts` — `planForIntent` (LLM plan synthesis, no-key clean error).
- **Create** `apps/web/lib/planner/websearch.ts` — the redact→egress→quarantine web-search provider.
- **Create** `apps/web/lib/planner/run.ts` — server wiring: start a plan run, `respondToRequest`, the `PlanRunStore` (Supabase-backed).
- **Create** `supabase/migrations/20260618060000_plan_runs.sql` — the `plan_runs` table + RLS + RPCs.
- **Create** `apps/web/app/app/planner/` — the ad-hoc ask entry, plan-preview card, run view.
- **Create** tests across `packages/runtime/test/` + `apps/web/lib/planner/`.

---

### Task 1: PlanSpec types + fail-closed validators

**Files:** `packages/runtime/src/types.ts`; `packages/runtime/src/validate.ts`; `packages/runtime/src/utilities.ts` (new); test `packages/runtime/test/planner-validate.test.ts`

- [ ] **Step 1 — types** (`types.ts`): add
```ts
export type PlannerToolId =
  | 'scratchpad.write' | 'scratchpad.read' | 'memory.retrieve'
  | 'web.search' | 'web.fetch' | 'ask_human' | 'done';

export interface PlannerTool {
  id: PlannerToolId;
  /** does this tool egress outside the system (web.*) */
  egress: boolean;
  /** JSON-schema-lite for the pick's args (mirrors PrimitiveInputField). */
  argSchema: Record<string, { type: 'number' | 'string' | 'enum' | 'boolean'; required?: boolean; min?: number; max?: number; values?: string[] }>;
}

export interface PlanSpec {
  kind: 'plan';
  ephemeral: true;
  goal: string;
  intendedSteps: string[];               // narrative, for preview only
  toolsAllowlist: string[];              // connector capability ids + PlannerToolId
  requiredConnectors: string[];
  weightClass: 'frontier';
  ceilings: RunCeilings & { maxIterations: number };
  personaPolicy?: PersonaPolicy;
}

export interface PendingRequest {
  requestId: string;
  kind: 'auth' | 'decision' | 'value' | 'approval';
  question: string;
  context: Record<string, unknown>;      // for 'approval': the DraftStep payload
}

/** One ReAct turn, persisted for resume + audit. */
export interface PlanTurn {
  idx: number;
  pick: { tool: string; args: Record<string, unknown> } | { done: true; artifact: unknown } | { ask_human: true; kind: PendingRequest['kind']; question: string };
  observation?: string;                  // quarantined-wrapped or human response, capped
}

export interface PlanRunState {
  runId: string;
  accountId: string;
  plan: PlanSpec;
  transcript: PlanTurn[];
  scratchpad: Record<string, string>;
  status: 'running' | 'needs_input' | 'done' | 'failed' | 'killed';
  pending?: PendingRequest;
  artifact?: unknown;
}
```
Extend `RunResult` (the linear runner) is NOT changed; instead add a Planner-level outcome:
```ts
export type PlanOutcome =
  | { kind: 'needs_input'; runId: string; request: PendingRequest }
  | { kind: 'done'; runId: string; artifact: unknown }
  | { kind: 'killed'; runId: string; reason: KillReason | 'max_iterations' | 'no_progress' }
  | { kind: 'failed'; runId: string; error: string };
```
- [ ] **Step 2 — utility registry** (`utilities.ts`): export `STANDARD_UTILITIES: Record<PlannerToolId, PlannerTool>` with arg schemas — `scratchpad.write {key:string!, value:string!}`, `scratchpad.read {key:string!}`, `memory.retrieve {query:string!, k?:number(1..10)}`, `web.search {query:string!}` (egress), `web.fetch {url:string!}` (egress), `ask_human {kind:enum[auth,decision,value]!, question:string!}`, `done {summary:string!}`. Export `plannerTool(id)` using `Object.hasOwn` (the 2b prototype-safe lookup).
- [ ] **Step 3 — failing test** (`planner-validate.test.ts`): `validatePlanSpec` accepts a plan whose allowlist = `['email.read','memory.retrieve','done']` with gmail granted; rejects (a) an allowlist entry that is neither a registry capability nor a utility id, (b) an ungranted required connector, (c) `maxIterations` over bound (>30), (d) a `web.*` tool when no search provider is configured (pass a `webSearchEnabled:false` flag). `validatePick` accepts `{tool:'email.read', args:{path:'/gmail/v1/users/me/messages?q=x'}}` when in-allowlist; rejects (e) a tool not in the plan's allowlist, (f) args failing schema (`memory.retrieve {k:99}`), (g) a connector cap whose connector isn't granted, (h) a read path failing `assertSafeReadPath` (`'../x'`).
- [ ] **Step 4 — implement** (`validate.ts`): `validatePlanSpec(plan, accountConnections, opts:{webSearchEnabled:boolean})` and `validatePick(pick, plan, accountConnections)`. Reuse `capability()`/`plannerTool()`, the Slice-1 `assertSafeReadPath`/`sanitizeEffectArgs`, the 2b `resolvePrimitiveInputs` for connector-cap args, and a parallel `resolveUtilityArgs` for utility args. Fail-closed: any problem → returned in the array (`validatePlanSpec`) or thrown/`{ok:false,reason}` (`validatePick`). Export both from `index.ts`.
- [ ] **Step 5** — `cd /c/Nibbin && npx tsc --noEmit -p packages/runtime && npx vitest run packages/runtime/test/planner-validate.test.ts` → green. Commit: `feat(runtime): PlanSpec types + fail-closed validatePlanSpec/validatePick + utility registry`.

---

### Task 2: Extract `dispatchStep`; build the `runPlan` ReAct harness

**Files:** `packages/runtime/src/runner.ts`; `packages/runtime/src/planner.ts` (new); tests `packages/runtime/test/dispatch-step.test.ts`, `packages/runtime/test/planner-loop.test.ts`

- [ ] **Step 1 — extract `dispatchStep` (refactor, no behavior change).** Pull the per-step gating out of `executeRun`'s loop body (runner.ts ~172-315) into an exported function:
```ts
export type StepDisposition =
  | { kind: 'read_result'; feed: QuarantinedContent }
  | { kind: 'drafted'; draft: DraftStep }      // gated to draft (await approval)
  | { kind: 'executed'; effect: { capability: string; idempotencyKey: string } }
  | { kind: 'composed'; feed?: QuarantinedContent }
  | { kind: 'kill'; reason: KillReason };

export interface DispatchCtx {
  nibbin: NibbinRef; trigger: RunTrigger; runId: string; idx: number;
  tokensSoFar: number; ceilings: RunCeilings; repetition: Map<string, number>;
  deps: RunnerDeps;
}
export async function dispatchStep(step: ProgramStep, ctx: DispatchCtx): Promise<StepDisposition & { tokensAfter: number; idxAfter: number }>;
```
Move the allowlist/repetition/quarantine (read), the model-draft + token clamp (compose), and the School gate + grant + idempotency + execute (draft) logic into it verbatim. `executeRun` now calls `dispatchStep` per step and keeps its existing behavior: on `drafted` → `finish('awaiting_approval')` + return `awaiting_approval`; on `executed` → return `executed`; on `kill` → `kill(reason)`. **The existing runner test suite MUST stay green (this is a pure refactor).**
- [ ] **Step 2 — verify refactor** — `npx vitest run packages/runtime/test` → all green (the interpreter/runner/composer tests prove no behavior change). Commit: `refactor(runtime): extract dispatchStep from executeRun (no behavior change)`.
- [ ] **Step 3 — failing test** (`planner-loop.test.ts`): a `runPlan` over a stub `PlannerDrafter` (the tool-picker) that returns, in order: `{tool:'email.read', args:{path:'/gmail/v1/users/me/messages?q=x'}}` then `{tool:'done', args:{summary:'2 threads need attention'}}`, with a stub reader returning a quarantined inbox → `runPlan` returns `{kind:'done', artifact:{summary:...}}`, the read went through `dispatchStep` (allowlist + quarantine gate hit), and `h.executed` is empty. Second test: picker returns the SAME read 4 times → `runPlan` returns `{kind:'killed', reason:'repetition'}` (reuses the runner's repetition map) OR `'no_progress'`. Third: picker returns picks forever → `{kind:'killed', reason:'max_iterations'}` after `maxIterations`.
- [ ] **Step 4 — implement `runPlan`** (`planner.ts`):
```ts
export interface PlannerDrafter {
  /** the tool-picker model call: given the assembled context, choose the next move. */
  pick(input: { goal: string; tools: ToolDef[]; transcript: PlanTurn[]; scratchpad: Record<string,string>; budget: { iterationsLeft: number; tokensLeft: number } }): Promise<PlannerPick | null>;
}
export type PlannerPick =
  | { tool: string; args: Record<string, unknown> }
  | { done: true; artifact: unknown }
  | { ask_human: true; kind: PendingRequest['kind']; question: string };

export async function runPlan(plan: PlanSpec, deps: PlannerDeps, resume?: PlanRunState): Promise<PlanOutcome>;
```
The loop (starting fresh or from `resume.transcript`):
1. iteration guard: if `iter >= plan.ceilings.maxIterations` → killed `max_iterations`; wall-clock + token guards as in the runner.
2. `pick = await deps.planner.pick(...)`; `null` (no model) → `failed` `'planning requires a model'`.
3. `const v = validatePick(pick, plan, deps.connectors)`; invalid → append the reason to the transcript as an observation and re-pick ONCE; second invalid → `failed`.
4. dispatch:
   - `done` → persist + return `{kind:'done', artifact}`.
   - `ask_human` → create a `PendingRequest`, persist state (`status:'needs_input'`), return `{kind:'needs_input', request}`.
   - a **connector capability** → translate the pick to a `ProgramStep` (read or draft — reuse the interpreter's step-building for the picked capability/primitive), call `dispatchStep`; on `drafted` → wrap as a `needs_input(kind:'approval')` (persist, return `needs_input`); on `read_result`/`composed` → push the quarantined observation to the transcript; on `executed` → push an observation; on `kill` → killed.
   - a **utility** → `dispatchUtility(pick, state, deps)` (Task 4/5 fill web/memory; scratchpad/done here).
5. **no-progress kill:** track a hash of (transcript length + scratchpad); if N (=3) consecutive iterations add no new observation/scratchpad change → killed `no_progress`.
6. loop.
Context assembly: cap the transcript by token budget (compact oldest observations to a short summary line when over budget).
- [ ] **Step 5** — `npx tsc --noEmit -p packages/runtime && npx vitest run packages/runtime/test` → green. Commit: `feat(runtime): runPlan bounded-ReAct harness reusing dispatchStep + maxIterations/no-progress kill`.

---

### Task 3: Resumable run state — `plan_runs` migration + `respondToRequest`

**Files:** `supabase/migrations/20260618060000_plan_runs.sql` (new, NOT applied by implementer); `apps/web/lib/planner/run.ts` (new); test `apps/web/lib/planner/run.test.ts`

- [ ] **Step 1 — migration** (`20260618060000_plan_runs.sql`): a `plan_runs` table — `id uuid pk default gen_random_uuid()`, `account_id uuid not null references accounts`, `created_by uuid`, `goal text`, `plan jsonb not null`, `transcript jsonb not null default '[]'`, `scratchpad jsonb not null default '{}'`, `status text not null check (status in ('running','needs_input','done','failed','killed'))`, `pending jsonb`, `artifact jsonb`, `created_at timestamptz default now()`, `updated_at timestamptz`. RLS: account members select their own; **all writes service-role only** (mirror the existing run tables — read the `runs` table's RLS in an earlier migration and match). Two SECURITY DEFINER RPCs (`set search_path=''`): `plan_run_create(p_account, p_user, p_goal, p_plan jsonb) returns uuid` and `plan_run_save(p_run uuid, p_transcript jsonb, p_scratchpad jsonb, p_status text, p_pending jsonb, p_artifact jsonb)`; audit_log rows on create + on status→done/failed/killed. Grant execute to service_role only.
- [ ] **Step 2 — `PlanRunStore`** (`run.ts`): a Supabase-backed store implementing `create(state)`, `load(runId, accountId)` (account-scoped), `save(state)`. Plus `respondToRequest(runId, accountId, userId, response): Promise<PlanOutcome>`:
  - load the state (account-scoped; reject a foreign runId → return `failed`/throw, never leak);
  - require `status==='needs_input'` and a matching `pending.requestId` (idempotent: a resolved request returns the current state's outcome, no double-resume);
  - for `kind:'approval'`: if approved, execute the held draft via the runner's effect path (`dispatchStep` execute branch or the existing approval-execution path — reuse whatever `/approvals` uses today) then append the result as the observation; if rejected, append "human rejected the draft" as the observation;
  - for `auth|decision|value`: append the human response as the next observation;
  - clear `pending`, set `status:'running'`, and call `runPlan(plan, deps, state)` to resume.
- [ ] **Step 3 — test** (`run.test.ts`, in-memory PlanRunStore): a run that pauses on `ask_human` persists `needs_input`; `respondToRequest` with the answer resumes and reaches `done`. `respondToRequest` on an already-resolved request is idempotent (returns the same outcome, does not re-run). A foreign `accountId` cannot load/resume another account's run.
- [ ] **Step 4** — `npx tsc --noEmit -p packages/runtime && npx tsc --noEmit -p apps/web && npx vitest run packages/runtime/test apps/web/` → green. Commit: `feat(planner): plan_runs persistence + resumable respondToRequest (migration not yet applied)`.

---

### Task 4: Plan synthesis (`planForIntent`)

**Files:** `apps/web/lib/planner/plan.ts` (new); `packages/router/src/tiers.ts` (add `plan_synthesis`); test `apps/web/lib/planner/plan.test.ts`

- [ ] **Step 1 — tier** (`tiers.ts`): register a `plan_synthesis` task at the `frontier` tier (T2-class). Mirror how `custom_spec_draft` is registered; route via `groveRouter.route`. (Plan synthesis is interactive → `origin:'chat'` so it draws the per-user budget, per the 2a P1 fix.)
- [ ] **Step 2 — failing test** (`plan.test.ts`): with a mocked picker/LLM returning a valid plan JSON for "tell me what needs attention today" + gmail/calendar/stripe granted → `planForIntent` returns `{plan, preview}` where `plan` passes `validatePlanSpec`, `plan.toolsAllowlist` ⊆ {granted connector caps + utilities}, `weightClass:'frontier'`. With NO model key → `{error:'planning requires a model'}` (no throw, no partial plan). With an LLM proposing an off-surface tool → that tool is dropped/rejected and either the plan validates without it or `{error}` (never an invalid plan).
- [ ] **Step 3 — implement** (`plan.ts`): `planForIntent(intent, accountConnections)`:
  - build the available surface: connector capabilities filtered to granted connectors (reuse the Composer's `availablePrimitives`/`connectorsFor`) + the `STANDARD_UTILITIES` (web.* only if `WEB_SEARCH` is configured — see Task 5);
  - prompt the model (`plan_synthesis` tier, `anthropicGenerate` + `recordModelCall`) for strict JSON `{goal, intendedSteps, toolsAllowlist, requiredConnectors}`; parse tolerantly;
  - assemble a `PlanSpec` (`kind:'plan'`, `ephemeral:true`, `weightClass:'frontier'`, `ceilings:{...DEFAULT_CEILINGS, maxTokens: <tighter, e.g. 8000>, maxIterations: 12}`, derive `requiredConnectors` from the connector caps via `connectorsFor`);
  - run `validatePlanSpec` fail-closed → on failure `{error}`; no model → `{error:'planning requires a model'}` (NO deterministic fallback — honest §2.1).
  - return `{plan, preview:{goal, intendedSteps, surface: toolsAllowlist, connectorsNeeded: requiredConnectors}}`.
- [ ] **Step 4** — `npx tsc --noEmit -p apps/web && npx vitest run apps/web/lib/planner` → green. Commit: `feat(planner): planForIntent — LLM plan synthesis, fail-closed, no-key clean error`.

---

### Task 5: Web-search utility (redact → egress → quarantine)

**Files:** `apps/web/lib/planner/websearch.ts` (new); wire into the utility dispatch in `planner.ts`/`run.ts`; test `apps/web/lib/planner/websearch.test.ts`

- [ ] **Step 1 — failing test** (`websearch.test.ts`): `webSearch({query})` (a) runs the query through `applyBattery` (from `@nibbin/redaction`) BEFORE the outbound call — assert the fetch was called with the REDACTED query (seed a query containing an email address / phone; assert the egressed string contains the redaction placeholder, not the raw PII); (b) only calls the allowlisted provider host (a non-allowlisted URL in `web.fetch` is rejected); (c) returns a QUARANTINED, length-capped result (assert `isQuarantined`); (d) with no provider key configured, the utility is not offered (Task 4 filters it) and a direct call returns a clean error.
- [ ] **Step 2 — implement** (`websearch.ts`): `webSearch(query, deps)` and `webFetch(url, deps)`:
  - `applyBattery(query)` → the redacted query;
  - assert the target host ∈ `WEB_EGRESS_ALLOWLIST` (the search provider for `web.search`; for `web.fetch`, an allowlist or a same-redaction + SSRF guard reusing `assertSafeReadPath`-style checks — reject private IPs / non-http(s) / credentials in URL);
  - call via `fetch` with a timeout + size cap; on error → a clean quarantined "search unavailable" observation (never throw into the loop);
  - wrap the result with `quarantine(text, 'web')` (cap length) so the picker only ever sees quarantined web content;
  - `recordModelCall`-style COGS/usage row if the provider is metered.
- [ ] **Step 3 — wire dispatch:** in `planner.ts`'s `dispatchUtility`, route `web.search`/`web.fetch` → `websearch.ts`, `memory.retrieve` → the `memory_entries` retrieval (reuse the #135 `match_memory` path, account-scoped, top-k), `scratchpad.*` → read/write `state.scratchpad`, `done` → end. Each returns a quarantined (or internal) observation.
- [ ] **Step 4** — `npx tsc --noEmit -p apps/web && npx vitest run apps/web/lib/planner` → green. Commit: `feat(planner): web-search utility — redact-on-egress + egress allowlist + quarantined results`.

---

### Task 6: Plan-preview + run UX

**Files:** `apps/web/app/app/planner/page.tsx`, `apps/web/app/app/planner/actions.ts`, `apps/web/app/app/planner/PlanComposer.tsx`, `apps/web/app/app/planner/PlanRunView.tsx` (all new); test `apps/web/app/app/planner/actions.test.ts`

- [ ] **Step 1 — server actions** (`actions.ts`): `proposePlan(intent)` → `appSession()` account-scope → `planForIntent` → return `{plan, preview}` or `{error}` (does NOT run). `startPlanRun(plan)` → re-validate `validatePlanSpec` fail-closed → `PlanRunStore.create` → `runPlan` → return the `PlanOutcome` (to a `needs_input` or `done`). `respondToPlanRun(runId, response)` → `respondToRequest`. All account-scoped; all re-validate fail-closed before any model/effect.
- [ ] **Step 2 — test** (`actions.test.ts`): `startPlanRun` re-validates and refuses an off-surface plan (a tampered client plan → `{error}`, no run created); `respondToPlanRun` forwards to `respondToRequest`; foreign-account run id is refused.
- [ ] **Step 3 — UI:** `PlanComposer.tsx` — the ad-hoc ask textbox → on submit calls `proposePlan` → renders the **plan-preview card** (goal, intended steps, the provisioned surface + connectors needed, the "nothing sends or leaves without your ok" assurance) → "Run it" calls `startPlanRun`. `PlanRunView.tsx` — renders the transcript as friendly step lines, shows an awaiting-approval draft (reuse the existing approval component/pattern), and the ask-human prompt with a response field → `respondToPlanRun`. Tokens-only styling, brand voice, no coral. Reuse the Notification Center (#121) to nudge when a run needs the human (emit a notification on `needs_input`).
- [ ] **Step 4** — `npx tsc --noEmit -p apps/web` → 0. Commit: `feat(web): Planner ad-hoc ask + plan-preview + supervised run view`.

---

### Task 7: Tests + full verification

**Files:** `packages/runtime/test/planner-loop.test.ts` (extend); `apps/web/lib/planner/*.test.ts`

- [ ] **Step 1 — safety + behavior tests** (extend the suites):
  - **the core safety test:** the picker tries a tool NOT in the plan's allowlist → the pick is rejected, no step is yielded, and after the re-prompt the run `failed` (the loop cannot exceed its provisioned surface).
  - read-only goal → artifact via `done`; `h.executed` empty.
  - a write pick → `needs_input(approval)`; approve → resumes → `executed`; reject → resumes → observation "rejected", loop continues.
  - `ask_human` → `needs_input`; `respondToRequest` → resumes → `done`.
  - web-search query redacted before egress + result quarantined (Task 5 test, asserted end-to-end through a `runPlan` turn).
  - ceiling/repetition/no-progress/max_iterations kills each fire.
  - no model → `{error}` (synthesis) and `failed 'planning requires a model'` (loop).
  - `respondToRequest` idempotent on a resolved request; foreign account refused.
- [ ] **Step 2 — full verification** (the four that gate; run from `/c/Nibbin`):
  - `npx tsc --noEmit -p packages/runtime && npx tsc --noEmit -p apps/web` → exit 0 (if a stale `.next/types` error for an untouched route appears, `rm -rf apps/web/.next/types` and re-run).
  - `npx vitest run packages/runtime/test apps/web/` → green (all prior 2a/2b/2c/runner suites stay green — proves the `dispatchStep` refactor caused no regression).
  - `npx eslint packages/runtime/src apps/web/lib/planner apps/web/lib/runtime apps/web/app/app/planner` → clean.
  - `npm run build -w @nibbin/web` → Compiled successfully (grep the log for "Failed to compile"/"Module not found"/"Compiled successfully"/"Generating static pages"; don't trust the trailing echo).
- [ ] **Step 3** — Commit: `test(planner): bounded-loop safety + resume + web-egress redaction + kills`.

---

### Task 8: Verify (controller checklist before the gate)
- [ ] tsc (runtime + web) 0; vitest green (incl. unchanged runner/interpreter suites); eslint clean; next build ✓.
- [ ] Confirm: every runtime pick is re-validated fail-closed; the loop cannot use a tool outside the provisioned surface; every write is approval-gated; reads + web results quarantined; web queries redacted before egress; bounded by maxIterations/ceilings/repetition/no-progress; `frontier` weight; ephemeral (no `nibbins`/`agent_specs` row); the run is persisted + resumable; no model → clean error.
- [ ] Migration `20260618060000_plan_runs.sql` NOT applied by the implementer (controller applies dev/staging/prod after the gate).

## Self-review
- **Spec coverage:** §2.1 plan synthesis → Task 4; §2.2 preview → Task 6; §2.3 ReAct loop → Task 2; §3 resumable state/plan_runs/respondToRequest → Task 3; §4 utilities (scratchpad/memory/web/ask_human/done) → Tasks 1,5; §4 web privacy pipeline → Task 5; §5 validators → Task 1; §6 UX → Task 6; §7 weight/ceilings/runaway → Tasks 1,2; §9 testing/gating → Tasks 7,8 (+ the controller's adversarial gate). All covered.
- **dispatchStep refactor** is the riskiest change (touches the proven runner) — isolated in Task 2 with the existing suite as the regression anchor, committed separately.
- Migration additive + service-role-gated; ephemeral plan runs don't touch the roster/tier-cap. Browser/computer_use, crystallization C→B, write-to-long-term-memory, batch-drafts, delegate/sub-task all deferred (spec §8).
