# Capability Library + Interpreter (Synthesis Core, Slice 1) — Design Spec

**Date:** 2026-06-18
**Status:** Approved-path (Slice 1 of the synthesis-core arc). Foundation for Composer (B) / Planner (C) per `2026-06-17-agent-synthesis-design.md` §4/§6.
**Goal:** Introduce the **typed capability registry** (the durable abstraction agents are composed from) and a **minimal declarative-spec interpreter** that the existing runner executes — proving Composer's output format runs end-to-end — **without changing today's behavior**.

## 1. Honest scope (why not "re-express all 6 programs")
Today's 6 programs (`apps/web/lib/runtime/programs.ts`) are hand-written async generators. The simple ones are linear (read → draft); the others (`echo`, `sweep`, `tally`) do real **computation between steps** (filter overdue threads, count newsletter senders, aggregate per-day minutes). Forcing that imperative logic into a declarative `steps[]` would require a mini-workflow engine (transforms/filters/control-flow) — out of scope for a foundation slice and not what Composer generates. So:
- **Templates keep their imperative programs.** They are **bound to the registry by conformance** (every capability they use must be a registry entry) — not rewritten.
- **The interpreter handles the linear primitive shapes** (detect-and-nudge / template-fill-and-send / summarize) that Composer (Slice 2) actually emits. We prove it with a declarative example agent + tests.

## 2. The safety property (load-bearing)
`interpretSpec()` **only yields `ProgramStep`s** — it never executes a side effect itself. The **same `runner.ts` consumes them and applies every existing wall**: `toolsAllowlist` check, quarantine enforcement, School `gateSideEffect`, write-grants, idempotency, ceilings, repetition kill. So a steps-spec is gated **identically** to a template program. The interpreter cannot bypass any safety boundary, and Composer-generated agents inherit the full runtime gate for free.

## 3. Components
### 3.1 Capability registry (`packages/runtime/src/capabilities.ts`, new)
```ts
export interface CapabilityDescriptor {
  id: string;                 // 'email.read', 'email.draft', 'invoice.nudge'
  resource: string;           // 'email', 'invoice', 'calendar', 'payments'
  verb: string;               // 'get' | 'draft' | 'send' | 'nudge' | ...
  sideEffect: 'read' | 'draft' | 'write';
  requiredConnector: string;  // 'gmail', 'stripe', ...
  /** routine-matching identity for draft/write capabilities (School §4.7). */
  patternKeyPrefix?: string;
}
export const CAPABILITY_REGISTRY: Record<string, CapabilityDescriptor> = { /* the capabilities today's programs use */ };
export function capability(id: string): CapabilityDescriptor | undefined;
```
Covers every capability the 6 programs + grants reference (`email.read`, `email.draft`, `calendar.read`, `payments.read`, `invoice.nudge`, …). This is the durable metadata layer (the spec's `(resource, verb) → side-effect`).

### 3.2 Conformance (test + optional runtime assert)
A test asserts: every `capability` string yielded by the 6 programs **and** every `toolsAllowlist` entry across the templates is a registry id (no orphans). This binds the existing imperative programs to the registry without rewriting them. (Optional defense-in-depth: the runner could assert `capability(step.capability)?.sideEffect` matches the step kind — additive, since the allowlist already gates.)

### 3.3 `AgentSpec.steps` + `personaPolicy` (`types.ts`, extend)
```ts
export interface CapabilityStep {
  capability: string;                 // refs CAPABILITY_REGISTRY
  inputs?: Record<string, unknown>;   // bound args (e.g. a read path, draft effectArgs)
  prompt?: ComposePrompt;             // present = generative draft (model)
  presentation?: boolean;             // a no-side-effect presentation draft
  title?: string;
}
export interface PersonaPolicy { voice?: string; tone?: string; brandKit?: string }
// on AgentSpec (both OPTIONAL, back-compat):
steps?: CapabilityStep[];
personaPolicy?: PersonaPolicy;
```

### 3.4 Interpreter (`packages/runtime/src/interpreter.ts`, new)
`interpretSpec(spec, connMap): ProgramFn` — yields `ProgramStep`s for a linear `steps[]`:
- a `read` capability → a `ReadStep` (path from `inputs.path`); the read result feeds the next step (the generator receives the quarantined feed, same protocol as today's programs).
- a `draft`/`write` capability → a `DraftStep` (`patternKey` from the registry's `patternKeyPrefix`, `effectArgs` from `inputs`, `prompt` passed through for a model draft, `presentation` honored). It does NOT execute — the runner gates it.
Validates each `step.capability` against the registry (throws → run fails cleanly, never a silent bad step). Bounded by the runner's ceilings regardless.

### 3.5 Routing (`buildProgram`)
`buildProgram(spec, connMap, nowMs)`: **if `spec.steps?.length` → `interpretSpec(spec, connMap)`**; else the existing per-template generator (unchanged). So template agents are byte-for-byte unchanged; only steps-specs (future Composer output; the Slice-1 proof agent) use the interpreter.

### 3.6 Migration
`agent_specs` gains `steps jsonb not null default '[]'` + `persona_policy jsonb not null default '{}'` (back-compat; existing rows/templates get empties). The adopt/snapshot path carries them through (empty for templates).

## 4. Proof (what "done" means)
- **Conformance test** green (no orphan capabilities).
- **Interpreter test:** a declarative `steps`-spec (e.g. a "follow-up" agent: `email.read` → generative `email.draft`) runs through `executeRun` with mocked deps and produces the expected `awaiting_approval` draft — proving the steps format executes via the real runner + its gates (allowlist/quarantine/school).
- **No behavior change** for the 6 templates (they still route to their imperative programs; existing runtime tests stay green).

## 5. Boundaries / gating
- **In:** the registry, conformance, `steps`/`personaPolicy` types + migration, the linear interpreter, `buildProgram` routing, tests.
- **Out (later slices):** Composer (LLM→spec + validation + custom adoption), Planner (ReAct), Crystallization, non-linear/control-flow steps, capability demand-signal flywheel.
- **Gated:** `packages/runtime` + the migration + `apps/web/lib/runtime/programs.ts` → `docs/gates/` report + adversarial gate + dev/staging/prod apply. Security testing: the interpreter yields steps only (no side effect); the runner's gates are unchanged + still apply; conformance prevents orphan capabilities; migration defaults are back-compat.
