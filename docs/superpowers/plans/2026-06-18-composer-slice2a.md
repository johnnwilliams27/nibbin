# Composer Slice 2a (detect-and-nudge synthesis loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Spec: `docs/superpowers/specs/2026-06-18-composer-slice2a-design.md`. Builds on Slice 1 (#137).

**Goal:** End-to-end synthesis for ONE shape — diagnosis → Composer proposes a `steps`-spec (a `nudge.overdue-email` **primitive** + typed params) → fail-closed validator → custom agent (templateKey=null) → interpreter dispatches the primitive's trusted implementation (= echo) → drafts a follow-up, School-gated.

**Load-bearing safety:** the LLM picks a primitive id + schema-validated params only — never `inputs.path`/`effectArgs` (built by trusted primitive code). Validator fail-closed. Interpreter/runner gate every yielded step. Composed agent hatches as an egg.

**GATED:** `packages/runtime` + migration (`adopt_nibbin` v2) + the Composer/adopt path + UX → `docs/gates/` report + 4-reviewer adversarial gate + dev/staging/prod apply.

## File structure
- **Modify** `packages/runtime/src/capabilities.ts` — primitive form on `CapabilityDescriptor` + register `nudge.overdue-email`.
- **Create** `packages/runtime/src/primitives/nudge-overdue-email.ts` — the parameterized echo logic (shared impl).
- **Modify** `apps/web/lib/runtime/programs.ts` — `echoProgram` delegates to the shared impl (parity; no behavior change).
- **Modify** `packages/runtime/src/interpreter.ts` — dispatch primitive steps to `implement()`.
- **Modify** `packages/runtime/src/validate.ts` — `validateComposedSpec(spec, accountConnections)`.
- **Create** `apps/web/lib/composer/compose.ts` — `composeSpec(...)` (LLM + no-key fallback).
- **Modify** `apps/web/lib/runtime/adopt.ts` — `adoptComposedSpec(...)`.
- **Create** `supabase/migrations/20260618050000_adopt_nibbin_steps.sql` — `adopt_nibbin` + `p_steps`/`p_persona_policy`.
- **Create** the review-before-adopt UX (a server action + a review surface reachable from the diagnosis reveal).
- **Create** tests: validator, composeSpec no-key fallback, composed-spec-runs-via-runner, echo↔primitive parity.

---

### Task 1: Primitive capability mechanism + `nudge.overdue-email`

**Files:** `packages/runtime/src/capabilities.ts`; `packages/runtime/src/primitives/nudge-overdue-email.ts` (new)

- [ ] **Step 1** — extend `CapabilityDescriptor` (optional primitive form, back-compat with the 6 atomic entries):
```ts
export interface PrimitiveInputField { type: 'number' | 'string' | 'enum'; default?: unknown; min?: number; max?: number; values?: string[]; required?: boolean }
export interface CapabilityDescriptor {
  id: string; resource: string; verb: string;
  sideEffect: 'read' | 'draft' | 'write';
  requiredConnector: string;
  patternKeyPrefix?: string;
  kind?: 'atomic' | 'primitive';          // default 'atomic'
  inputSchema?: Record<string, PrimitiveInputField>;  // primitives only
}
```
The implementation factory is registered separately (a `PRIMITIVE_IMPLS: Record<string, PrimitiveImpl>` map, so the descriptor stays pure data). `PrimitiveImpl = (inputs, connMap, nowMs) => ProgramFn`.

- [ ] **Step 2 — `primitives/nudge-overdue-email.ts`** — extract the reusable echo internals (read mailbox, `overdueInbound`, gmail path builders, the draft assembly with `safeAddress`/`safeHeaderValue`) into a parameterized `ProgramFn` factory: `nudgeOverdueEmail({ staleDays = 3, intent? }, connMap, nowMs)`. Identical logic to `echoProgram`. (Read `programs.ts` echo + helpers; move the shared bits here, exported, so both the primitive and `echoProgram` import them.)
- [ ] **Step 3** — register `nudge.overdue-email` in `CAPABILITY_REGISTRY` (`kind:'primitive'`, sideEffect `draft`, connector `gmail`, `patternKeyPrefix:'email.draft'`, `inputSchema:{ staleDays:{type:'number',default:3,min:1,max:30} }`) + its impl in `PRIMITIVE_IMPLS`.
- [ ] **Step 4** — `cd /c/Nibbin && npx tsc --noEmit -p packages/runtime` → exit 0. Commit: `feat(runtime): primitive capabilities + nudge.overdue-email (detect-and-nudge)`.

---

### Task 2: `echoProgram` delegates to the shared impl (parity)

**Files:** `apps/web/lib/runtime/programs.ts`

- [ ] **Step 1** — refactor `echoProgram` to call the shared `nudgeOverdueEmail` internals (so the template and the primitive are the SAME code). Keep `echoProgram`'s signature/behavior identical. (If the shared impl lives in `packages/runtime`, import it; ensure no behavior drift — the existing echo tests must pass.)
- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web && npx vitest run apps/web/ packages/runtime/test` → green (echo behavior unchanged). Commit: `refactor(web): echoProgram delegates to the shared nudge-overdue-email impl`.

---

### Task 3: Interpreter dispatches primitives

**Files:** `packages/runtime/src/interpreter.ts`

- [ ] **Step 1** — in the step loop, after `capability()` lookup: if `cap.kind === 'primitive'`, validate `step.inputs` against `cap.inputSchema` (coerce defaults; reject unknown keys / out-of-bounds → throw), then `yield* PRIMITIVE_IMPLS[cap.id](resolvedInputs, connMap, nowMs)()`. Else the existing atomic path (Slice 1, unchanged). `nowMs` — thread it into `interpretSpec(spec, connMap, nowMs)` (the caller `buildProgram` already has `nowMs`).
- [ ] **Step 2** — `npx tsc --noEmit -p packages/runtime` → exit 0. Commit: `feat(runtime): interpreter dispatches primitive capabilities`.

---

### Task 4: Fail-closed validator

**Files:** `packages/runtime/src/validate.ts`

- [ ] **Step 1** — `validateComposedSpec(spec: AgentSpec, accountConnections: string[]): string[]` returning problems (empty = ok). Enforce, fail-closed: each `step.capability` ∈ `CAPABILITY_REGISTRY`; each primitive step's `inputs` matches `inputSchema` (types/bounds, no extra keys); `requiredConnectors ⊆ accountConnections`; `toolsAllowlist ⊇ {step.capability}`; `validateTriggerGraph([...existing?, spec])` clean; reject any atomic step whose `inputs.path` fails `assertSafeReadPath` / draft `effectArgs` that `sanitizeEffectArgs` would alter (defense-in-depth — should be moot since primitives own those). Export from index.
- [ ] **Step 2** — `npx tsc --noEmit -p packages/runtime` → exit 0. Commit: `feat(runtime): validateComposedSpec — fail-closed gate for synthesized specs`.

---

### Task 5: Composer

**Files:** `apps/web/lib/composer/compose.ts` (new)

- [ ] **Step 1** — `composeSpec(diagnosis, workflow, accountConnections): Promise<{ spec: AgentSpec; summary: string } | { error: string }>`. Build the available-primitive menu (registry entries with `kind:'primitive'` whose connector ∈ accountConnections) + their input schemas. Prompt the LLM (task `custom_spec_draft`, via `groveRouter.route` + `anthropicGenerate`, `recordModelCall`) to output STRICT JSON `{ displayName, capability, inputs, personaPolicy, triggers? }` choosing ONE primitive for the workflow. Parse tolerantly. **No-key / parse-failure fallback:** deterministically propose `nudge.overdue-email` with default params + a sensible displayName/persona/trigger (so synthesis works with no model — CI-safe). Assemble an `AgentSpec` (templateKey=null, version 1, steps=[the primitive step], toolsAllowlist=[capability], requiredConnectors=[connector], a default daily trigger, the template `PROMOTION` curriculum + a standard credit profile). Run `validateComposedSpec` — if it fails, return `{ error }` (never adopt an invalid spec).
- [ ] **Step 2** — `npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): Composer — propose a validated steps-spec from a diagnosis (detect-and-nudge)`.

---

### Task 6: Custom adoption (RPC migration + adopt path)

**Files:** `supabase/migrations/20260618050000_adopt_nibbin_steps.sql`; `apps/web/lib/runtime/adopt.ts`

- [ ] **Step 1 — migration** — drop+recreate `adopt_nibbin` adding `p_steps jsonb default '[]'` + `p_persona_policy jsonb default '{}'`, inserting them into `agent_specs.steps`/`persona_policy`. Preserve EVERYTHING else byte-for-byte (the per-account tier-cap advisory lock, the egg creation, the audit insert, grants/revoke). Read the current `adopt_nibbin` from `20260611120000_m4_runtime_shop_scan.sql` and reproduce it exactly + the two params. Do NOT apply (controller applies dev/staging/prod).
- [ ] **Step 2 — `adopt.ts`** — add `adoptComposedSpec(accountId, userId, spec, chosenName?, appearance?)`: run `validateComposedSpec(spec, activeConnections)` + `validateTriggerGraph([...existing, spec])` (fail-closed → throw/return error before any write); compute missing connectors (reuse the existing check); call `adopt_nibbin` with `p_template_key=null`, the spec fields, `p_steps=spec.steps`, `p_persona_policy=spec.personaPolicy`. Return the same `AdoptResult` shape (so the Beat-2 hatch ceremony works). Keep `adoptTemplate` unchanged.
- [ ] **Step 3** — `npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat: adopt a composed custom spec (adopt_nibbin v2 + adoptComposedSpec)`.

---

### Task 7: Review-before-adopt UX

**Files:** a server action (`apps/web/app/app/diagnosis/actions.ts` or a new composer route) + a review surface

- [ ] **Step 1** — server action `synthesizeForWorkflow(diagnosisId, workflowKey): Promise<ComposerReviewResult>`: load the diagnosis (account-scoped), find the workflow, call `composeSpec`, return the proposed spec + human summary + the connectors it needs (or an error). Does NOT adopt.
- [ ] **Step 2** — server action `adoptSynthesized(diagnosisId, workflowKey, chosenName): Promise<AdoptOutcome>`: re-compose (or accept the reviewed spec via a signed/echoed payload — simplest: re-run `composeSpec` deterministically for the workflow so the adopted spec == the reviewed one), then `adoptComposedSpec`. Reuse the Beat-2 `AdoptOutcome`/`AdoptButton` ceremony.
- [ ] **Step 3 — UI:** on the diagnosis reveal, for a workflow without a matching shop template (or as an alternative to "Adopt {template}"), a "**Build a Nibbin for this**" affordance → a review card (client component) showing: the workflow, the human-readable plan ("Watch your inbox for threads you haven't answered in N days → draft a warm follow-up for your approval"), the persona, the trigger, the connectors needed, and a name field → confirm → `adoptSynthesized` → hatch ceremony. Tokens-only, brand voice, no coral. Read `DiagnosisReveal.tsx` + the Beat-2 `AdoptButton` to match patterns.
- [ ] **Step 4** — `npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): synthesize-and-adopt a custom Nibbin from the diagnosis (review-before-adopt)`.

---

### Task 8: Tests
- [ ] `packages/runtime/test`: `validateComposedSpec` rejects (unknown capability / ungranted connector / bad params / out-of-bounds / cycle / allowlist gap) + accepts a valid nudge spec; interpreter dispatches the primitive (a steps-spec with `nudge.overdue-email` runs through `executeRun` mocked → `awaiting_approval` follow-up draft); echo↔primitive parity (same yielded steps/effectArgs).
- [ ] `apps/web`: `composeSpec` no-key fallback returns a valid `nudge.overdue-email` spec that passes `validateComposedSpec`; a malformed-connector workflow returns `{ error }`.
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p packages/runtime && npx tsc --noEmit -p apps/web && npx vitest run packages/runtime/test apps/web/` → green. Also run `cd /c/Nibbin && npx eslint packages/runtime/src apps/web/lib/composer apps/web/lib/runtime` and `cd /c/Nibbin && npm run build -w @nibbin/web` → both clean (lint + next build — the two checks that bit prior PRs). Commit: `test: composer validator + synthesis loop + echo parity`.

---

### Task 9: Verify
- [ ] tsc (runtime + apps/web) exit 0; `vitest` green; `eslint` clean; `next build` succeeds.
- [ ] Confirm: the LLM output is constrained to primitive+params (never paths/effectArgs); `validateComposedSpec` is fail-closed; the composed agent hatches as an egg + is School-gated; echo behavior unchanged; no-key fallback works.
- [ ] migration NOT applied by the implementer (controller applies).

## Self-review
- Synthesis loop end-to-end for one shape, safe-by-construction (LLM → primitive+params only; validator fail-closed; interpreter/runner gate; egg + School). Reuses Slice-1 interpreter/guards, the existing `custom_spec_draft` tier, the Beat-2 adopt ceremony, and the echo logic (shared with the primitive → parity). Other shapes / multi-primitive / Planner / Crystallization deferred. Migration additive (adopt_nibbin v2 preserves the tier-cap + audit).
