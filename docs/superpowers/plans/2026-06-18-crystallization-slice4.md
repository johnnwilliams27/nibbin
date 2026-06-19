# Crystallization Slice 4 (C-plan → durable B-spec) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Spec: `docs/superpowers/specs/2026-06-18-crystallization-slice4-design.md`. Builds on Composer (2a/2b/2c) + Planner 3a (#150).

**Goal:** Turn a successful supervised Planner run (`plan_runs` row at `done`) into a durable recurring B-spec adopted as a Nibbin, faithfully (steps extracted from the trace, not LLM-authored), gated (refuse plans that can't safely recur), reusing the Composer's validator + adoption + hatch.

**Architecture:** A deterministic `crystallizeTranscript` extracts `CapabilityStep[]` from the run transcript; a fail-closed gate refuses non-`done`/read-only/utility/branching/un-generalizable runs; an LLM soft-layer proposes only name/cadence/persona; the candidate `AgentSpec` (templateKey=null) goes through the EXISTING `validateComposedSpec` + `adoptComposedSpec`, hatching as an egg. Provenance (`source_plan_run_id`) is recorded.

**Tech Stack:** TypeScript (packages/runtime, apps/web Next 15.3), Supabase (3 DBs), the model router (`frontier`/`origin:'chat'`), reusing `validateComposedSpec`/`adoptComposedSpec`/`connectorsFor`.

## File structure
- **Modify** `packages/runtime/src/types.ts` — `CrystalResult` (`{spec}` | `{refused, reason}`) + a `CRYSTAL_REFUSAL` reason union.
- **Create** `packages/runtime/src/crystallize.ts` — `crystallizeTranscript(planRun)` (deterministic extract) + `crystallizabilityGate(planRun, accountConnections)` (fail-closed). Pure, unit-testable.
- **Modify** `packages/runtime/src/index.ts` — export the above.
- **Create** `apps/web/lib/planner/crystallize.ts` — `crystallize(planRunId, accountConnections)` (gate + extract + soft-layer + assemble + `validateComposedSpec`), `proposeCrystalSoftFields` (the LLM soft-layer + no-key defaults).
- **Modify** `apps/web/lib/runtime/adopt.ts` — `adoptComposedSpec` accepts an optional `sourcePlanRunId` passed to the RPC.
- **Create** `supabase/migrations/20260618070000_agent_specs_source_plan_run.sql` — `agent_specs.source_plan_run_id` + `adopt_nibbin` v3 (19th param). NOT applied by the implementer.
- **Modify** `apps/web/app/app/planner/actions.ts` — `proposeCrystal(planRunId)` + `adoptCrystal(planRunId, chosenName, chosenTrigger)`.
- **Create** `apps/web/app/app/planner/CrystalPreview.tsx` — the "Make this recurring" preview card; wire an affordance into `PlanRunView.tsx`.
- **Create** tests: `packages/runtime/test/crystallize.test.ts`, `apps/web/lib/planner/crystallize.test.ts`, `apps/web/app/app/planner/actions.test.ts` (extend).

---

### Task 1: Deterministic extractor + crystallizability gate

**Files:** `packages/runtime/src/crystallize.ts` (new); `packages/runtime/src/types.ts`; `packages/runtime/src/index.ts`; test `packages/runtime/test/crystallize.test.ts`

- [ ] **Step 1 — types** (`types.ts`):
```ts
export type CrystalRefusal =
  | 'not_done'            // run did not reach `done`
  | 'no_action'           // produced no approved connector action (read-only/research)
  | 'utility_in_path'     // used web.*/scratchpad/memory.retrieve/ask_human (runtime reasoning, not a B-step)
  | 'branching'           // observation-dependent branching the linear extract can't represent
  | 'ungeneralizable'     // a raw atomic pick whose args can't be reduced to a reusable step
  | 'invalid_spec';       // the extracted steps failed validateComposedSpec
export type CrystalResult = { ok: true; steps: CapabilityStep[] } | { ok: false; reason: CrystalRefusal; detail?: string };
```
- [ ] **Step 2 — failing test** (`crystallize.test.ts`): build a `PlanRunState` fixture whose transcript is two primitive picks (`{tool:'nudge.overdue-email', args:{staleDays:3}}` approved, then `{done}`); `crystallizabilityGate(run, ['gmail'])` returns `{ok:true, steps}` with one `CapabilityStep {capability:'nudge.overdue-email', inputs:{staleDays:3}}`. Then a fixture per refusal: status `failed` → `not_done`; a `done` run with only `email.read` picks + no draft → `no_action`; a transcript containing `{tool:'web.search',...}` in the path → `utility_in_path`; a transcript flagged branching (see Step 4 for the branching signal) → `branching`; a raw atomic `email.draft` pick whose args carry a concrete `threadId` that can't generalize → `ungeneralizable`; a primitive whose connector isn't granted → `invalid_spec` (via the validator).
- [ ] **Step 3 — `crystallizeTranscript`** (`crystallize.ts`): walk `planRun.transcript`; for each turn whose `pick` is `{tool, args}`:
  - if `plannerTool(tool)` (a utility id) → record a `utility_in_path` marker (the gate refuses);
  - else `capability(tool)`: a **primitive** → push `{ capability: tool, inputs: args }` (the primitive is the reusable form — args are already its typed params); a **raw atomic read** → push `{ capability: tool, inputs: { path: <generalized> } }` only if the path is a reusable query (no embedded resource id) else mark `ungeneralizable`; a **raw atomic draft/write** → `ungeneralizable` (a bespoke one-off draft is not a reusable step — reuse must ride a primitive, mirroring `validateComposedSpec`'s rule);
  - ignore `{done}`/`{ask_human}` turns for step extraction (but the gate inspects them).
  Return the ordered `CapabilityStep[]` (or the first refusal marker).
- [ ] **Step 4 — `crystallizabilityGate(planRun, accountConnections)`**: fail-closed in order — (1) `planRun.status !== 'done'` → `not_done`; (2) no transcript turn produced an approved connector action (no draft/effect observation) → `no_action`; (3) any load-bearing `{tool}` is a utility id → `utility_in_path`; (4) a branching signal is present → `branching` (branching signal for 3a: the transcript records a `reprompt`/multi-candidate marker, OR — conservatively for this slice — more than one DISTINCT primitive/capability whose ordering depended on an intermediate observation; keep it simple: if the extracted steps are a single primitive or a fixed read→draft pair it's linear; anything with an atomic read whose path was derived from a prior observation → `branching`); (5) run `crystallizeTranscript` → propagate `ungeneralizable`; (6) build a probe `AgentSpec` from the steps + `validateComposedSpec(probe, accountConnections)` → any problem → `invalid_spec`. Else `{ok:true, steps}`.
- [ ] **Step 5** — `npx tsc --noEmit -p packages/runtime && npx vitest run packages/runtime/test/crystallize.test.ts` → green. Commit: `feat(runtime): crystallizeTranscript + fail-closed crystallizability gate`.

---

### Task 2: Soft-layer proposal + candidate spec assembly

**Files:** `apps/web/lib/planner/crystallize.ts` (new); test `apps/web/lib/planner/crystallize.test.ts`

- [ ] **Step 1 — failing test** (`crystallize.test.ts`): with the soft-layer LLM mocked to return `{displayName:'Overdue follow-ups', suggestedTrigger:{kind:'schedule', schedule:'daily.morning'}, personaPolicy:{tone:'warm'}}`, `crystallize(planRun, ['gmail'])` returns `{spec, preview}` where `spec.templateKey===null`, `spec.steps` == the extracted steps (NOT LLM-derived), `spec.toolsAllowlist`/`requiredConnectors` derived via `connectorsFor` from the steps, `spec.triggers` includes the suggested schedule + a `{kind:'user'}` trigger, and `validateComposedSpec(spec, ['gmail'])` returns `[]`. With NO model key (soft-layer LLM → null): `displayName` falls back to a deterministic default (e.g. derived from the goal), `suggestedTrigger` is undefined (user must pick), persona default — and the spec still validates. A refused gate → `crystallize` returns `{refused, reason}` and never calls the LLM.
- [ ] **Step 2 — `proposeCrystalSoftFields(goal, steps)`**: route the model (`plan_synthesis` tier already exists, or add a `crystallize` task — reuse `plan_synthesis`), `origin:'chat'` (budget-drawn), `anthropicGenerate` + `recordModelCall`. Strict JSON `{displayName, suggestedTrigger?, personaPolicy?}` — NEVER steps. No key / parse-fail → `{ displayName: defaultNameFromGoal(goal), suggestedTrigger: undefined, personaPolicy: {} }`.
- [ ] **Step 3 — `crystallize(planRun, accountConnections)`**: run `crystallizabilityGate` → on `{ok:false}` return `{refused:true, reason}`; else `proposeCrystalSoftFields`; assemble `AgentSpec` — `templateKey:null`, `steps`, `toolsAllowlist = unique(steps.flatMap(s => effectiveTools(s.capability)))`, `requiredConnectors = connectorsFor` over those tools, `triggers = [...(suggestedTrigger ? [withDefaults(suggestedTrigger)] : []), {kind:'user', debounceSecs:0, cooldownSecs:0}]`, the standard `curriculum` + `creditProfile` (reuse the Composer's defaults). Run `validateComposedSpec` fail-closed → on failure return `{refused:true, reason:'invalid_spec', detail}`. Return `{ spec, preview: { steps: humanReadable(steps), suggestedTrigger, connectorsNeeded: requiredConnectors } }`.
- [ ] **Step 4** — `npx tsc --noEmit -p apps/web && npx vitest run apps/web/lib/planner/crystallize.test.ts` → green. Commit: `feat(planner): crystallize — soft-layer proposal + candidate B-spec assembly (steps from trace)`.

---

### Task 3: Provenance migration + adopt path

**Files:** `supabase/migrations/20260618070000_agent_specs_source_plan_run.sql` (new, NOT applied); `apps/web/lib/runtime/adopt.ts`

- [ ] **Step 1 — migration**: `alter table public.agent_specs add column if not exists source_plan_run_id uuid references public.plan_runs(id);` (nullable, additive). Then drop+recreate `adopt_nibbin` adding a 19th trailing param `p_source_plan_run_id uuid default null`, inserting it into `agent_specs.source_plan_run_id`. Reproduce the v2 body (from `20260618050000_adopt_nibbin_steps.sql`) BYTE-FOR-BYTE + the one new param/column (the advisory lock, §6.4 tier cap, egg insert, audit insert, grants all preserved). Update the `revoke`/`grant` to the 19-arg signature. Do NOT apply (controller applies dev/staging/prod).
- [ ] **Step 2 — `adopt.ts`**: `adoptComposedSpec` gains an optional `sourcePlanRunId?: string` param, passed to the RPC as `p_source_plan_run_id`. `adoptTemplate`/`adoptComposedSpec`'s existing callers pass undefined (→ null). Keep all existing validation.
- [ ] **Step 3** — `npx tsc --noEmit -p apps/web` → 0. Commit: `feat: adopt_nibbin v3 — source_plan_run_id provenance (migration not yet applied)`.

---

### Task 4: Server actions (propose + adopt, re-derive fail-closed)

**Files:** `apps/web/app/app/planner/actions.ts`; test `apps/web/app/app/planner/actions.test.ts` (extend)

- [ ] **Step 1 — `proposeCrystal(planRunId)`**: `appSession()` account-scope; load the plan_run via the account-scoped `PlanRunStore.load(planRunId, accountId)` (a foreign id → `{refused:true, reason:'not_found'}`, never leak); `crystallize(planRun, activeConnections)`; return the `{spec, preview}` or `{refused, reason}`. Does NOT adopt.
- [ ] **Step 2 — `adoptCrystal(planRunId, chosenName, chosenTrigger)`**: account-scope; **re-load the source plan_run and re-run `crystallize` deterministically** (do NOT trust any client-passed spec — re-derive from the source so a tampered payload can't inject steps); if refused → return the refusal; apply the user's `chosenName` + `chosenTrigger` (validate `chosenTrigger` is a known cadence; the recurring trigger is the USER's choice) onto the re-derived spec; `validateComposedSpec` fail-closed again; `adoptComposedSpec(accountId, userId, spec, chosenName, appearance, { sourcePlanRunId: planRunId })` → returns the Beat-2 `AdoptOutcome` (egg hatch). 
- [ ] **Step 3 — test** (`actions.test.ts`): `adoptCrystal` re-derives from the source (a client-passed tampered spec is ignored — assert the adopted spec's steps == the re-extracted ones); a foreign `planRunId` is refused; `chosenTrigger` not in the allowed cadence set is rejected; the adopted Nibbin is an egg with `source_plan_run_id` set.
- [ ] **Step 4** — `npx tsc --noEmit -p apps/web && npx vitest run apps/web/app/app/planner` → green. Commit: `feat(web): proposeCrystal/adoptCrystal — re-derive + re-validate fail-closed, user trigger, egg hatch`.

---

### Task 5: "Make this recurring" preview UX

**Files:** `apps/web/app/app/planner/CrystalPreview.tsx` (new); `apps/web/app/app/planner/PlanRunView.tsx` (modify)

- [ ] **Step 1** — in `PlanRunView.tsx`, when a run is `done`, show a "**Make this recurring**" button → calls `proposeCrystal`. On `{refused, reason}`, render the reason inline in friendly language (a map from `CrystalRefusal` → a one-line explanation, e.g. `utility_in_path` → "This one needed live web lookups, so it's better to re-run it when you need it."). On `{spec, preview}`, render `CrystalPreview`.
- [ ] **Step 2** — `CrystalPreview.tsx` (client): show the recurring steps in plain language, a **cadence picker** (the user's explicit choice — default to the suggested cadence if present, else unselected; the options are the standard cadences), the connectors needed, a name field (default the suggested name), and the assurance "hatches as an egg — drafts everything for your approval until it earns autonomy." Confirm → `adoptCrystal(planRunId, name, trigger)` → on success route into the Beat-2 hatch ceremony (reuse the adopt-outcome handling from `BuildNibbinButton`). Tokens-only, brand voice, no coral.
- [ ] **Step 3** — `npx tsc --noEmit -p apps/web` → 0. Commit: `feat(web): Make-this-recurring crystallize preview (cadence consent + egg-hatch assurance)`.

---

### Task 6: Tests + full verification

**Files:** the test files above

- [ ] **Step 1 — faithfulness + gate coverage** (assert across the suites):
  - **Faithfulness:** the soft-layer LLM output cannot introduce a step — a test where the mocked LLM returns extra junk fields / a bogus `steps` key asserts the adopted spec's steps == the deterministically-extracted ones (steps come from the trace, never the LLM).
  - **Each refusal reason** has a test (`not_done`, `no_action`, `utility_in_path`, `branching`, `ungeneralizable`, `invalid_spec`).
  - **Egg hatch / no trust transfer:** the crystallized Nibbin is created at stage `egg` (via `adoptComposedSpec`), regardless of the supervised approvals in the source run.
  - **Foreign-account** plan_run id is refused.
  - **No-key** soft-layer falls back to deterministic name + no suggested cadence; the spec still validates.
  - **Provenance:** the adopted spec carries `source_plan_run_id`.
- [ ] **Step 2 — full verification** (from `/c/Nibbin`):
  - `npx tsc --noEmit -p packages/runtime && npx tsc --noEmit -p apps/web` → exit 0 (stale `.next/types` for untouched routes are pre-existing — `rm -rf apps/web/.next/types` + re-run).
  - `npx vitest run packages/runtime/test apps/web/` → green (all prior suites stay green).
  - `npx eslint packages/runtime/src apps/web/lib/planner apps/web/lib/runtime apps/web/app/app/planner` → clean.
  - `npm run build -w @nibbin/web` → Compiled successfully (grep the log; don't trust the trailing echo).
- [ ] **Step 3** — Commit: `test(crystallization): faithfulness (steps from trace) + refusal reasons + egg hatch + provenance`.

---

### Task 7: Verify (controller checklist before the gate)
- [ ] tsc (runtime + web) 0; vitest green; eslint clean; next build ✓.
- [ ] Confirm: executable steps are extracted from the trace, never LLM-authored; the gate refuses non-`done`/read-only/utility/branching/un-generalizable runs; `adoptCrystal` re-derives + re-validates fail-closed from the source plan_run; the crystallized agent hatches as an egg (no trust transfer); the recurring trigger is the user's explicit choice; provenance recorded; account-scoped.
- [ ] Migration `20260618070000` NOT applied by the implementer (controller applies dev/staging/prod after the gate).

## Self-review
- **Spec coverage:** §2 derivation (deterministic extract + soft-layer) → Tasks 1,2; §3 gate → Task 1; §4 trigger consent → Tasks 4,5; §5 egg/no-trust-transfer → Tasks 4,6; §6 flow + provenance → Tasks 3,4,5; §8 tests/gating → Tasks 6,7. All covered.
- **Reuse:** `validateComposedSpec`, `adoptComposedSpec`, `connectorsFor`, the Beat-2 hatch, the `plan_synthesis` tier — all reused, not rebuilt. The only new runtime code is the extractor + gate (pure, unit-tested). Migration additive (provenance column + one optional RPC param). Non-linear/utility plans refused by design; spec-editing / auto-suggest / cross-run-merge deferred.
- **Type consistency:** `CrystalResult`/`CrystalRefusal` used consistently; `crystallize` returns `{spec, preview}` | `{refused, reason}`; `adoptComposedSpec`'s new `sourcePlanRunId` threads to `p_source_plan_run_id`.
