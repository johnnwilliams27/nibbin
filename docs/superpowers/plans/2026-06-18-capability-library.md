# Capability Library + Interpreter (Synthesis Core Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Spec: `docs/superpowers/specs/2026-06-18-capability-library-design.md`.

**Goal:** Add the typed **capability registry** (the durable abstraction) + a **minimal declarative-spec interpreter** the existing runner executes, with **no behavior change** to today's 6 template programs. Foundation for Composer (Slice 2).

**Load-bearing safety:** `interpretSpec` only *yields* `ProgramStep`s; the same `runner.ts` applies allowlist/quarantine/School-gate/grants/idempotency/ceilings. The interpreter executes nothing itself.

**GATED:** `packages/runtime` + migration + `apps/web/lib/runtime/programs.ts`/`engine.ts` → `docs/gates/` report + adversarial gate + dev/staging/prod apply.

## File structure
- **Create** `packages/runtime/src/capabilities.ts` — `CapabilityDescriptor` + `CAPABILITY_REGISTRY` + `capability(id)`.
- **Modify** `packages/runtime/src/types.ts` — `CapabilityStep`, `PersonaPolicy`, optional `steps`/`personaPolicy` on `AgentSpec`.
- **Create** `packages/runtime/src/interpreter.ts` — `interpretSpec(spec, connMap)`.
- **Modify** `packages/runtime/src/index.ts` — export the new surface.
- **Modify** `apps/web/lib/runtime/programs.ts` — `buildProgram(spec, …)` routes steps→interpreter, else template generator.
- **Modify** `apps/web/lib/runtime/engine.ts` — caller passes the spec; `specFromRow` reads `steps`/`persona_policy` (forward-compat).
- **Create** `supabase/migrations/20260618040000_agent_spec_steps.sql` — `steps`/`persona_policy` columns.
- **Create** tests: `packages/runtime/test/capabilities.test.ts` (conformance) + `packages/runtime/test/interpreter.test.ts` (executes a steps-spec via the runner).

---

### Task 1: Capability registry

**Files:** Create `packages/runtime/src/capabilities.ts`

- [ ] **Step 1** — first grep the 6 programs for every capability string used + every `toolsAllowlist` entry across templates so the registry is complete: `cd /c/Nibbin && grep -oE "capability: '[^']+'" apps/web/lib/runtime/programs.ts | sort -u` and inspect `packages/runtime/src/templates.ts` `toolsAllowlist`. Then write:
```ts
export interface CapabilityDescriptor {
  id: string;
  resource: string;
  verb: string;
  sideEffect: 'read' | 'draft' | 'write';
  requiredConnector: string;
  /** routine-matching identity prefix for draft/write capabilities (School §4.7). */
  patternKeyPrefix?: string;
}

/** The capabilities today's programs + grants reference. The durable abstraction
 *  Composer/Planner compose from (spec §4: (resource, verb) → side-effect). */
export const CAPABILITY_REGISTRY: Record<string, CapabilityDescriptor> = {
  'email.read':    { id: 'email.read',    resource: 'email',    verb: 'get',   sideEffect: 'read',  requiredConnector: 'gmail' },
  'email.draft':   { id: 'email.draft',   resource: 'email',    verb: 'draft', sideEffect: 'draft', requiredConnector: 'gmail', patternKeyPrefix: 'email.draft' },
  'email.send':    { id: 'email.send',    resource: 'email',    verb: 'send',  sideEffect: 'write', requiredConnector: 'gmail', patternKeyPrefix: 'email.send' },
  'calendar.read': { id: 'calendar.read', resource: 'calendar', verb: 'get',   sideEffect: 'read',  requiredConnector: 'gmail' },
  'payments.read': { id: 'payments.read', resource: 'payments', verb: 'get',   sideEffect: 'read',  requiredConnector: 'stripe' },
  'invoice.nudge': { id: 'invoice.nudge', resource: 'invoice',  verb: 'nudge', sideEffect: 'draft', requiredConnector: 'stripe', patternKeyPrefix: 'invoice.nudge' },
  // ADD any others the grep surfaces (do not omit — the conformance test will fail otherwise).
};

export function capability(id: string): CapabilityDescriptor | undefined {
  return CAPABILITY_REGISTRY[id];
}
```
(Match `requiredConnector` to what each program's `requireConn(...)` uses — verify against programs.ts. Verify `email.send` is the grant capability — check `engine.ts` `maybeInsertSendGrant`/the grants. Adjust the set to exactly cover reality.)

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p packages/runtime` → exit 0. Commit: `feat(runtime): capability registry — the typed abstraction for synthesis`.

---

### Task 2: Spec types — `steps` + `personaPolicy`

**Files:** Modify `packages/runtime/src/types.ts`

- [ ] **Step 1** — add the types + extend `AgentSpec` (both optional → back-compat):
```ts
export interface CapabilityStep {
  capability: string;                  // refs CAPABILITY_REGISTRY
  inputs?: Record<string, unknown>;    // bound args: a read `path`, or draft `effectArgs`
  prompt?: ComposePrompt;              // present = generative draft (model)
  presentation?: boolean;              // no-side-effect presentation draft
  title?: string;
}
export interface PersonaPolicy { voice?: string; tone?: string; brandKit?: string }
```
and inside `AgentSpec`, after `creditProfile`:
```ts
  /** Composed steps (Composer/Planner output). Absent for template agents,
   *  which run their hand-written program. */
  steps?: CapabilityStep[];
  personaPolicy?: PersonaPolicy;
```
(`ComposePrompt` is already defined in this file — reuse it.)

- [ ] **Step 2** — `npx tsc --noEmit -p packages/runtime` → exit 0. Commit: `feat(runtime): AgentSpec.steps + personaPolicy (Composer output shape)`.

---

### Task 3: The interpreter

**Files:** Create `packages/runtime/src/interpreter.ts`; modify `packages/runtime/src/index.ts`

- [ ] **Step 1** — read `programs.ts` (`ProgramFn`/`ProgramStep` shapes + how `readMailbox` feeds results back via `yield`) to match the generator protocol exactly. Then write `interpretSpec`:
```ts
import type { AgentSpec, ProgramFn, ProgramStep } from './types.js';   // match the repo's extension style
import { capability } from './capabilities.js';

type ConnectionMap = Record<string, string>;

/** Run a linear capability `steps[]` as a ProgramFn (detect-and-nudge /
 *  template-fill-and-send / summarize shapes). Yields ProgramSteps ONLY — the
 *  runner applies every gate (allowlist/quarantine/School/grants/idempotency).
 *  Validates each capability against the registry; an unknown one throws (the
 *  run fails cleanly) rather than yielding an ungated step. */
export function interpretSpec(spec: AgentSpec, connMap: ConnectionMap): ProgramFn {
  const steps = spec.steps ?? [];
  return async function* () {
    for (const s of steps) {
      const cap = capability(s.capability);
      if (!cap) throw new Error(`unknown capability ${s.capability}`);
      const connectionId = connMap[cap.requiredConnector];
      if (!connectionId) throw new Error(`no active ${cap.requiredConnector} connection`);

      if (cap.sideEffect === 'read') {
        const path = typeof s.inputs?.path === 'string' ? s.inputs.path : '';
        if (!path) throw new Error(`read step ${s.capability} missing inputs.path`);
        // the runner returns the quarantined read result as the generator's next() value
        yield { kind: 'read', capability: s.capability, connectionId, path } satisfies ProgramStep;
        continue;
      }

      // draft | write → a DraftStep the runner gates (draft-vs-execute by School).
      const patternKey = `${cap.patternKeyPrefix ?? s.capability}:${spec.templateKey ?? 'custom'}`;
      yield {
        kind: 'draft',
        capability: s.capability,
        connectionId,
        patternKey,
        presentation: s.presentation ?? false,
        title: s.title ?? cap.resource,
        draft: '',                                   // model fills via prompt path; '' for deterministic
        effectArgs: (s.inputs ?? {}) as Record<string, unknown>,
        ...(s.prompt ? { /* see note */ } : {}),
      } satisfies ProgramStep;
    }
  };
}
```
**Generative drafts:** today a model draft is produced by a separate `compose` step with a `prompt` (the runner calls `deps.model.draft` and feeds the text back), then the program puts that text into the `DraftStep.draft`. Mirror that: if `s.prompt` is set, FIRST `yield` a `ComposeStep` with the prompt, capture the returned quarantined text via the generator `next()` value, and use it as the `DraftStep.draft`. Read how `echoProgram` (programs.ts) does the compose→draft handoff and replicate it exactly so token accounting + quarantine match. (The `satisfies ProgramStep` sketch above omits this; implement the compose-then-draft sequence for `prompt` steps.)

- [ ] **Step 2** — export `interpretSpec`, `CapabilityDescriptor`, `CAPABILITY_REGISTRY`, `capability`, `CapabilityStep`, `PersonaPolicy` from `packages/runtime/src/index.ts`.
- [ ] **Step 3** — `npx tsc --noEmit -p packages/runtime` → exit 0. Commit: `feat(runtime): interpretSpec — run a declarative capability steps-spec`.

---

### Task 4: Route `buildProgram` to the interpreter

**Files:** Modify `apps/web/lib/runtime/programs.ts`, `apps/web/lib/runtime/engine.ts`

- [ ] **Step 1 — `programs.ts`** change `buildProgram` to take the spec and route on `steps`:
```ts
import { interpretSpec, type AgentSpec } from '@nibbin/runtime';
export function buildProgram(spec: AgentSpec, connections: ConnectionMap, nowMs: number): ProgramFn {
  if (spec.steps && spec.steps.length > 0) return interpretSpec(spec, connections);
  switch (spec.templateKey) {
    case 'echo': return echoProgram(connections, nowMs);
    // … the existing 6 cases, keyed off spec.templateKey …
    default: throw new Error(`no program for spec (templateKey=${spec.templateKey})`);
  }
}
```
- [ ] **Step 2 — `engine.ts`** the caller (`triggerNibbinRun`) currently does `buildProgram(nibbin.spec.templateKey ?? '', connMap, nowMs)` → change to `buildProgram(nibbin.spec, connMap, nowMs)`. Also update `specFromRow` to read `steps`/`persona_policy` from the row (default `[]`/`{}`) into the `AgentSpec` (forward-compat so a future custom spec round-trips). Confirm no other `buildProgram(` callers; if any, update them.
- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): route runs to the spec interpreter when steps are present`.

---

### Task 5: Tests

**Files:** Create `packages/runtime/test/capabilities.test.ts`, `packages/runtime/test/interpreter.test.ts`

- [ ] **Step 1 — conformance** (`capabilities.test.ts`): assert every `toolsAllowlist` entry across `SHOP_TEMPLATES` is a registry id; and (importing the 6 programs is web-side, so) at minimum assert the registry covers the known capability set + that each descriptor's `sideEffect` is consistent (read/draft/write). If feasible without circular deps, also assert the capabilities the programs yield are registry ids (else leave a web-side test note).
- [ ] **Step 2 — interpreter** (`interpreter.test.ts`): build an `AgentSpec` with `steps: [{capability:'email.read', inputs:{path:'/gmail/v1/users/me/messages?...'}}, {capability:'email.draft', prompt:{intent:'…', context:'…'}, inputs:{to:'…'}}]`, run it through `executeRun` with mocked `RunnerDeps` (reuse the existing runner test's mocks/fixtures — read `packages/runtime/test/*runner*`/`trust-gate` for the harness), and assert: the read step is gated by the allowlist, the draft step returns `awaiting_approval` with the expected draft, and an unknown-capability spec throws/fails cleanly. This proves a steps-spec executes via the real runner + its gates.
- [ ] **Step 3** — `cd /c/Nibbin && npx vitest run packages/runtime/test` → green (incl. existing runner/trust-gate tests unchanged). Commit: `test(runtime): capability conformance + interpreter-runs-a-steps-spec`.

---

### Task 6: Migration

**Files:** Create `supabase/migrations/20260618040000_agent_spec_steps.sql`

- [ ] **Step 1** — additive, back-compat:
```sql
-- Synthesis Slice 1: Composer/Planner output shape on agent_specs. Back-compat:
-- existing rows + template adoptions default to empty; only composed specs fill them.
alter table public.agent_specs
  add column if not exists steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array'),
  add column if not exists persona_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(persona_policy) = 'object');
```
- [ ] **Step 2** — do NOT apply (controller applies dev/staging/prod). Commit: `feat(db): agent_specs.steps + persona_policy (synthesis Slice 1)`.

---

### Task 7: Verify
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p packages/runtime` → exit 0.
- [ ] `cd /c/Nibbin && npx vitest run packages/runtime/test apps/web/` → green (no regression; the 6 templates still route to their imperative programs — behavior unchanged).
- [ ] Confirm: `interpretSpec` yields steps only (no side-effect execution in it); the runner's gates are untouched; the registry covers every capability the templates/programs use (conformance green).
- [ ] Grep no stray `buildProgram(` caller passes a `templateKey` string instead of the spec.

## Self-review
- Foundation only: registry + interpreter + types + migration + routing; templates unchanged (imperative programs preserved, bound by conformance). Composer/Planner/Crystallization deferred. Safety preserved (interpreter yields steps; runner gates them). Migration additive/back-compat. Unlocks Slice 2 (Composer emits `steps` over the registry → interpreter runs them, fully gated).
