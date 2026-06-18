# Composer Slice 2a — minimal synthesis loop (detect-and-nudge) — Design Spec

**Date:** 2026-06-18
**Status:** Approved-path (Slice 2a of the synthesis-core arc; user greenlit the basis: one detect-and-nudge shape, fail-closed validator, hatch review). Builds on Slice 1 (capability library + interpreter, #137). Design: `2026-06-17-agent-synthesis-design.md` §4/§6.
**Goal:** Prove the end-to-end synthesis loop — **diagnosis → Composer proposes a `steps`-spec → fail-closed validator → custom agent (templateKey=null) → interpreter runs it** — for ONE primitive shape: **detect-and-nudge** (overdue email follow-ups, today's `echo` logic).

## 1. The key architecture decision: Composer composes PRIMITIVES, not raw atomic steps
`echo`'s detection (filter unanswered + >3-days-stale, pick oldest, compute waited-days) is imperative computation the **linear** Slice-1 interpreter can't express. So — per spec §4's "five primitive shapes" — the capability library gains **primitive (composite) capabilities** with a **trusted server-side implementation**:
- A primitive descriptor adds `kind: 'primitive'` + an `inputSchema` (typed params) + an `implement(inputs, connMap, nowMs): ProgramFn` factory.
- **`nudge.overdue-email`** = `echo`'s read→detect→draft logic, parameterized (`staleDays` default 3, `scope`, the draft `intent`/persona). Its implementation reuses the existing `echoProgram` internals (refactored to take params).
- The **interpreter dispatches**: a step whose capability is a primitive → invoke `descriptor.implement(step.inputs, connMap, nowMs)` and `yield*` its steps (which are the same atomic read/compose/draft steps the runner already gates). Atomic capabilities (Slice 1) are unchanged.

**Safety consequence (load-bearing):** the LLM picks a **primitive id + typed params** validated against `inputSchema` — it **never** emits `inputs.path` or `effectArgs`. Those are built by the primitive's **trusted** implementation. So the untrusted-LLM surface is "choose from a fixed primitive set + schema-checked scalar params," not "emit arbitrary connector calls." The Slice-1 `assertSafeReadPath`/`sanitizeEffectArgs` guards remain as defense-in-depth. This is far safer than free-form step emission and is the reason Slice 2a is tractable + gateable.

## 2. Components
### 2.1 Primitive capability + `nudge.overdue-email` (`packages/runtime`)
Extend `CapabilityDescriptor` with an optional primitive form (`kind:'primitive'`, `inputSchema`, `implement`). Register `nudge.overdue-email` (resource `email`, sideEffect `draft`, connector `gmail`, `patternKeyPrefix:'email.draft'`). Its `implement` is the parameterized echo logic. (Move the reusable echo internals — `overdueInbound`, the gmail path builders, the draft assembly — into a shared place the primitive uses; `echoProgram` itself can delegate to the same internals so the template and the primitive stay identical.)

### 2.2 Interpreter dispatch (`interpreter.ts`)
For a step, look up the capability: if `kind:'primitive'`, validate `inputs` against `inputSchema`, then `yield* descriptor.implement(inputs, connMap, nowMs)()`. Else the Slice-1 atomic path. Unknown/invalid → throw (run fails cleanly). The runner still gates every yielded step.

### 2.3 Composer (`apps/web/lib/composer/compose.ts`)
`composeSpec(diagnosis, workflow, accountConnections): Promise<ComposerResult>`:
- LLM call via the existing `custom_spec_draft` task tier (T2 / Sonnet, unbudgeted pipeline — already registered in `packages/router/src/tiers.ts`), `anthropicGenerate` + `recordModelCall` (COGS).
- **Constrained output:** strict JSON `{ displayName, steps: [{capability, inputs}], personaPolicy, triggers }` where `capability` MUST be one of the available primitives and `inputs` MUST match its `inputSchema`. The prompt lists ONLY the available primitives + their param schemas for the workflow's category. For Slice 2a the realistic output is a single `nudge.overdue-email` step. No model key → honest fallback: propose the `nudge.overdue-email` primitive with default params (deterministic), so synthesis works without a key (CI-safe).
- Returns the proposed `AgentSpec` (templateKey=null) + a human-readable summary for review.

### 2.4 Fail-closed validator (`packages/runtime/src/validate.ts`, extend)
`validateComposedSpec(spec, accountConnections): string[]` — **reject unless all hold:**
- every `step.capability` ∈ `CAPABILITY_REGISTRY`;
- every primitive step's `inputs` matches the primitive's `inputSchema` (types + bounds; no extra keys);
- every `requiredConnector` is in `accountConnections` (granted/active);
- `validateTriggerGraph([...existing, spec])` passes (no cycle, per-spec rules, C10 keeper rule);
- `toolsAllowlist` ⊇ the capabilities the steps use (so the runner's allowlist gate admits them);
- (defense-in-depth) a dry-run of `interpretSpec` doesn't throw the Slice-1 path/effectArgs guards.
Any failure → the spec is NOT adopted; the UX shows why. The validator is the trust boundary; the LLM is never trusted.

### 2.5 Custom adoption (`adopt_nibbin` RPC + `adopt.ts`)
Migration `20260618050000`: extend `adopt_nibbin` with `p_steps jsonb default '[]'` + `p_persona_policy jsonb default '{}'` (drop+recreate; preserve the tier-cap lock + cycle/validation + audit). `adopt.ts`: a `adoptComposedSpec(accountId, userId, spec, name, appearance)` path that runs `validateComposedSpec` (fail-closed) + `validateTriggerGraph`, then calls the RPC with `p_template_key=null` + the steps/persona. Reuses the connector + tier-cap checks.

### 2.6 Hatch review UX (`apps/web/app/app/...`)
From the diagnosis reveal, a recommendation can "**Build a Nibbin for this**" → a **review-before-adopt** surface showing the proposed agent: the workflow it automates, the human-readable steps ("watch your inbox for overdue threads → draft a warm follow-up for your approval"), the persona, the trigger, and the connectors it needs. **Human confirm before it exists** (a synthesized agent still goes through an explicit adopt). Name + appearance like the hatch wizard. On confirm → `composeAndAdopt` server action → validate → adopt → the Beat-2 hatch ceremony.

## 3. Scope / boundaries
- **In (2a):** the primitive capability mechanism + `nudge.overdue-email`; interpreter dispatch; the Composer (constrained to available primitives) + no-key fallback; the fail-closed validator; custom adoption RPC+path; the review-before-adopt UX. End-to-end: diagnosis → review → adopt → run → drafts a follow-up gated by School.
- **Out (later):** more primitives (template-fill-and-send, summarize, sync-data, deliver-by-convention) = 2b; multi-step/multi-primitive composition; raw-atomic-step composition; editing the proposed spec; Planner (Slice 3); Crystallization (Slice 4).

## 4. Gating + tests
- **Gated:** `packages/runtime` (primitive + interpreter + validator) + migration (`adopt_nibbin` v2) + the Composer/adopt path → `docs/gates/` report + adversarial gate + dev/staging/prod apply.
- **Security testing:** the LLM cannot emit paths/effectArgs (primitive params only, schema-validated); validator fail-closed (capability∈registry, connector-granted, no-cycle, schema, allowlist⊇steps); the interpreter/runner gate every yielded step; the primitive implementation is trusted code (= echo, reviewed). No-key fallback works (CI). The composed agent hatches as an **egg** and is School-gated like any agent (drafts first; no autonomy without earned approvals + grants).
- **Tests:** validator rejects (bad capability / ungranted connector / bad params / cycle); `composeSpec` no-key fallback yields a valid `nudge.overdue-email` spec; the composed spec runs through `executeRun` (mocked deps) and produces the same `awaiting_approval` follow-up draft as `echoProgram`; `echoProgram` and the primitive share internals (a test asserts parity).
