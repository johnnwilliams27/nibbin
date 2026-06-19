# Planner (Slice 3a) — the supervised bounded-ReAct Planner — Design Spec

**Date:** 2026-06-18
**Status:** Approved-path (Slice 3 of the synthesis-core arc; user approved the architecture 2026-06-18). Builds on the shipped Composer (2a #139 / 2b #141 / 2c #142). Design context: `2026-06-17-agent-synthesis-design.md` §4 (B/C split), §6 (Planner), §7 (execution harness, §7.1–7.4), §8 (validator), §9 (resilience/needs_input).
**Goal:** Build mode **C** — a **supervised, bounded ReAct loop** where a synthesized agent picks its next tool at runtime over a **validated, pre-provisioned** tool surface, with **plan-preview**, **resumable ask-human / approval blocking**, the **standard utility toolset** (incl. web-search), and tight ceilings. Ephemeral (not a rostered Nibbin) but the run is persisted for resume + audit. **Defers only browser/`computer_use`.**

## 0. Scope honesty (this is a subsystem, not a primitive)
This is the largest slice of the arc. It introduces a runtime model-driven loop (vs. today's front-loaded linear interpreter), a new resumable run state, the first open-web egress, and a supervised-run UX. The implementation plan sequences it into internal phases (synthesis → harness+utilities → resume+escalation → web-search → UX → tests), each independently verifiable. The adversarial gate here is the heaviest of the arc: runtime tool-selection + open-web egress are both novel high-stakes surfaces.

## 1. The safety thesis (what makes C safe)
Identical in spirit to the Composer's, extended to a runtime loop:
- **Provisioning is pre-set, never self-granted (§7.3).** The plan-preview consent gate provisions the loop to exactly `toolsAllowlist` (vetted connector capabilities) + a fixed named utility set. The loop **selects among** loaded tools; it cannot grant itself a new tool, connector, or scope. Needing more → escalate (`needs_input`), never silent self-expansion.
- **The validator is the trust boundary, applied twice.** Fail-closed on the `PlanSpec` up front, AND fail-closed on **every runtime tool-pick** (the picked tool ∈ provisioned surface; args schema-checked; a connector step's connector granted). An invalid pick never yields a step — the loop re-prompts once, else fails cleanly.
- **The runner's gates are unchanged and still apply to every yielded step** (allowlist, quarantine, School `gateSideEffect`, write-grants, idempotency, ceilings, repetition-kill). The harness only *yields* `ProgramStep`s; it executes nothing.
- **Every write is approval-gated** (P2) exactly as today (`awaiting_approval`); the loop cannot send without the human.
- **Bounded:** `maxIterations` (loop turns) + `maxSteps`/`maxTokens`/`maxWallClockMs` + repetition-kill + a no-progress kill. **`frontier` weight** (3×) — `computer_use` (10×) is reserved for when browser lands.
- **Open-web egress is the new surface:** web-search/fetch queries pass through the **redaction battery** before leaving the system, the provider host is **egress-allowlisted**, and results are **quarantined** exactly like connector reads. This is the privacy-load-bearing part (the LLM is told its final text is data; results are never un-quarantined).

## 2. Architecture — three stages
### 2.1 Plan synthesis (`apps/web/lib/planner/plan.ts`)
`planForIntent(intent, accountConnections): Promise<{ plan: PlanSpec; preview: PlanPreview } | { error }>`.
- An LLM **plan call** (model router, a new `plan_synthesis` task tier — `frontier`/T2-class, COGS recorded) proposes, in strict JSON: `{ goal, intendedSteps: string[] (narrative), toolsAllowlist: string[] (capability ids + utility ids), requiredConnectors, weightClass:'frontier', ceilings }`. The prompt lists the available connector capabilities (filtered to granted connectors) + the fixed utility set + their schemas, and the user's intent.
- Assembles a **`PlanSpec`** (the spec shape + `kind:'plan'`, `ephemeral:true`, `trigger:{kind:'once'}`, `maxIterations`). Runs the **extended validator** (`validatePlanSpec`, §5) fail-closed → on failure returns `{error}` (NEVER an invalid plan).
- **No deterministic no-key fallback** (a reasoning loop needs a model). No model key → `{ error: 'planning requires a model' }`. (Honest difference from the Composer.)

### 2.2 Plan-preview (the consent gate) (`apps/web/app/app/planner/`)
The user sees: the goal, the intended steps (narrative), the **exact tool + connector surface** the loop is provisioned to, which connectors it needs, and the standing assurance that **nothing sends or egresses without explicit approval**. Approving provisions the loop to that surface. (This is the §6/§7.3 plan-preview: surface-level consent, not per-step pre-approval — per-write approval is still enforced at runtime.)

### 2.3 Bounded ReAct execution (`packages/runtime/src/planner.ts`)
A new harness `runPlan(plan, deps, state?)` (alongside the linear `interpretSpec`), driven by the **existing runner** for gating. Each iteration:
1. **Assemble context** (§7.4): system prompt + goal + tool definitions (provisioned surface only) + the transcript so far + retrieved memory (top-k from `memory.retrieve`) + scratchpad, within the token budget; long runs compact the transcript.
2. **Tool-picker model call** → a structured choice: `{tool, args}` (a connector capability or an egressing/internal utility) | `{ask_human, kind, question}` | `{done, artifact}`.
3. **Re-validate the pick fail-closed** (`validatePick`): tool ∈ provisioned surface; args ∈ the tool's schema; a connector step's connector granted. Invalid → one re-prompt with the validation error appended to the transcript; second invalid → run `failed` (clean).
4. **Dispatch:** a connector capability → yield the corresponding `ProgramStep` (read/draft) to the runner (same gates); an internal utility (scratchpad/done) → handled in-harness; an egressing utility (web.search/web.fetch) → redact-then-egress-then-quarantine (§4); `ask_human` → pause with `needs_input`.
5. **Observe:** the quarantined result (or human response on resume) is appended to the transcript.
6. Loop until `done`, a blocking pause (`needs_input`/`awaiting_approval`), or a ceiling/kill.

## 3. Resumable run state (`packages/runtime` + migration)
- **`RunOutcome` gains `needs_input`** carrying the pending request: `{ requestId, kind: 'auth'|'decision'|'value'|'approval', question, context }`. **Unification:** the runner is unchanged — a yielded draft step still returns `awaiting_approval` from the runner. The **Planner harness wraps that** into a `plan_runs` pause of `needs_input(kind:'approval')` with the draft as `context`. So writes and ask-human resolve through ONE plan-level pause/resume mechanism (`respondToRequest`), even though the underlying runner outcome for a draft is still `awaiting_approval`. (The linear-interpreter path is untouched: `awaiting_approval` keeps its current meaning there.)
- **`plan_runs` table** (migration `20260618060000`): persists the run's `plan` snapshot, the **transcript** (ordered tool-picks + observations), the **scratchpad**, the current status (`running`/`needs_input`/`done`/`failed`/`killed`), the pending request, and the artifact. Account-scoped RLS; service-role writes; audit row on create + resolve.
- **`respondToRequest(runId, response)`** rehydrates `state` from `plan_runs`, appends the human response (an approval decision, an auth grant, a value, a free-text answer) as the next observation, and resumes `runPlan` from the persisted transcript. Idempotent on a resolved request.
- Ephemeral = **not** an `agent_specs`/`nibbins` row (no roster entry, no recurring trigger, no tier-cap slot). The *run* is persisted (in `plan_runs`) for resume + audit only.

## 4. Standard utility toolset (§7.2)
A fixed registry of utilities the harness dispatches (distinct from connector capabilities; the plan's `toolsAllowlist` may include them):
- **`scratchpad.write` / `scratchpad.read`** — run-scoped working memory in `plan_runs.scratchpad`. Internal, no egress.
- **`memory.retrieve`** — READ the shipped RAG `memory_entries` (#135), top-k, account-scoped. (Write-to-long-term-memory deferred.)
- **`web.search` / `web.fetch`** — the new open-web utility. **Privacy pipeline (load-bearing):** the query/URL is run through the **redaction battery** (`applyBattery`, the same as connector content) before egress; the provider host is on a dedicated **egress allowlist**; the response is **quarantined** (wrapped, never un-quarantined to the picker except as a quarantined observation) and length-bounded; the call is recorded (COGS/flywheel). A provider key absent → the utility is not offered in the surface.
- **`ask_human` / `escalate`** — emit an `AgentRequest` → `needs_input` (kind `auth|decision|value`). The §9 unblock hierarchy (prefer official connector/stored auth; hand CAPTCHA/MFA/confirm to the human) informs the request kind.
- **`done` / `return_artifact`** — ends the loop, returning the artifact (a structured summary/answer/working file) as the run result.

## 5. Validator extensions (`packages/runtime/src/validate.ts`)
- **`validatePlanSpec(plan, accountConnections)`** — fail-closed: every `toolsAllowlist` entry is a known connector capability OR a known utility id; required connectors granted; ceilings within the `frontier` budget (incl. `maxIterations` bound); the §8 checks (typecheck, scope, side-effect routing, fail-closed). Reuses `validateComposedSpec`'s capability/connector logic.
- **`validatePick(pick, plan, accountConnections)`** — fail-closed per iteration: the picked tool ∈ the plan's provisioned surface; args validated (connector caps → the capability/primitive `inputSchema` + the Slice-1 `assertSafeReadPath`/`sanitizeEffectArgs` guards; utilities → the utility's arg schema). Any failure → not yielded.

## 6. UX (`apps/web/app/app/planner/`)
- **Ad-hoc ask entry** — a text box ("ask a Nibbin to look into / handle something"), tokens-only, brand voice.
- **Plan-preview card** — goal + intended steps + provisioned surface + connectors needed + the no-egress/no-send-without-you assurance → "Run it" / "Cancel".
- **Run view** — live progress (the transcript as friendly step lines), the awaiting-approval drafts (reuse the approval UX), and the **ask-human prompt** with a response field; the Notification Center (#121) nudges when a run needs the human. Resolving an approval/ask-human resumes the run.

## 7. Weight / COGS / runaway
- **`frontier` weight (3×)**; `computer_use` reserved for browser. New **`maxIterations`** ceiling (default conservative, e.g. 12) + the existing `maxSteps`/`maxTokens`/`maxWallClockMs` + repetition-kill + a **no-progress kill** (N consecutive picks that yield no new observation/scratchpad change). Every tool-picker call + generative step recorded in `model_calls`.

## 8. Boundaries
- **In (3a):** plan synthesis + validator; the bounded ReAct harness; the standard utility toolset incl. web-search (with the redaction/egress/quarantine pipeline); resumable `needs_input` + `plan_runs` + `respondToRequest`; the plan-preview + run UX; the migration; tests + a heavy adversarial gate.
- **Out (later):** browser/`computer_use` tools (§4 computer-use layer); crystallization C→B (Slice 4); write-to-long-term-memory; the batch-drafts-at-end refinement; multi-agent delegate/sub-task.

## 9. Testing + gating
- **Gated** (`packages/runtime` + `apps/web/app/api`/planner + migration + the first open-web egress) → `docs/gates/` report + 4-reviewer adversarial gate (the heaviest of the arc) + dev/staging/prod migration apply.
- **Tests:** validator rejects (off-surface pick, ungranted connector, bad args, cycle, over-ceiling, unknown utility); a read-only goal loop returns an artifact; a write pauses → approve → resumes and completes; ask-human pauses → respond → resumes; **web-search query is redacted before egress + the result is quarantined** (assert the egressed query carries no un-redacted PII and the observation is wrapped); ceiling / repetition / no-progress kills fire; no-model → clean `{error}`; `respondToRequest` is idempotent on a resolved request; the loop cannot pick a tool outside the provisioned surface (the core safety test).
- **Security testing:** the picker cannot self-grant (provisioning fixed at preview); every pick re-validated fail-closed; every write approval-gated; reads + web results quarantined; queries redacted on egress; bounded by iterations/ceilings; ephemeral + supervised. The agent can ask for more power, never take it.
