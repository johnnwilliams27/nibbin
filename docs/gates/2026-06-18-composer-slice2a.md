# Adversarial Gate Report — Composer Slice 2a (detect-and-nudge synthesis loop)

**Date:** 2026-06-18
**Branch:** `feat/composer-slice2a`
**Surface:** trust-critical — an untrusted LLM proposes an executable agent spec from a user's diagnosis; a fail-closed validator gates it; the runtime executes it (drafting email via the user's Gmail connector). Highest-stakes surface in the product.
**Spec:** `docs/superpowers/specs/2026-06-18-composer-slice2a-design.md` · **Plan:** `docs/superpowers/plans/2026-06-18-composer-slice2a.md`
**Reviewers (4 lenses):** red-team · logic-skeptic · claims-auditor · cost-auditor
**Verdict: PASS** — no surviving P0/P1. The one P1 (a parity regression) and one P1 (an unbudgeted entry point) were fixed in-branch; all P2 hardening + test-gap findings were also fixed.

## Security thesis (verified by the gate)
The Composer composes **primitives** (composite capabilities with a trusted server-side `implement`), not raw atomic steps. The LLM's only freedom is **a primitive id from a fixed menu + scalar params validated against an `inputSchema`** (`staleDays` 1..30). It **cannot** emit a read `path` or `effectArgs` — those are built entirely by trusted code (`packages/runtime/src/primitives/nudge-overdue-email.ts`, = the reviewed `echo` logic). `validateComposedSpec` is **fail-closed** and runs before any DB write. The interpreter only *yields* steps; the runner gates every one (allowlist / quarantine / School / grants / idempotency / ceilings). The composed agent hatches as an **egg** and is School-gated like any Nibbin. All four reviewers independently traced this and could not break it.

## Findings & dispositions

### P1 (ship-blockers) — both FIXED
| # | Lens | Finding | Fix |
|---|------|---------|-----|
| 1 | logic-skeptic | **Echo parity regression.** The refactor moved `requireConn('gmail')` from inside `echoProgram`'s generator to eager factory-build time (`programs.ts:161`). A Gmail-disconnected Echo then threw *before* the run row was created → the throw escaped `triggerNibbinRun` → aborted the dispatch fan-out loop, cursor never advanced (event re-fires forever), and no `failed` run was recorded. Contradicts the "no template behavior change" claim. | `echoProgram` now delegates: `return nudgeOverdueEmail({ staleDays: 3 }, connections, nowMs)` — the byte-identical `'no active gmail connection — pausing politely'` throw fires inside the primitive's generator, so `executeRun` catches it → clean `failed` run, as before. (`programs.ts:167`) |
| 2 | cost-auditor | **Unbudgeted Composer entry point.** `synthesizeForWorkflow` fired a T2 Sonnet call (`custom_spec_draft`) routed `origin:'pipeline'`, which (∈ `UNBUDGETED_T2_TASKS`) bypassed the per-user daily frontier budget. No rate limit → model-call spam vector. | Route the call as `origin:'chat'` (it is a user-initiated interactive call, not a pipeline splurge), so the per-user `DEFAULT_DAILY_FRONTIER_BUDGET` applies. At-cap, `route()` returns a clean `degraded` decision; `composeSpec` detects it, skips the model, and falls back to the deterministic no-model proposal (no COGS, synthesis still works). (`compose.ts:206`) |

### P2 (hardening) — all FIXED
| # | Lens | Finding | Fix |
|---|------|---------|-----|
| 3 | cost / red-team / logic-skeptic | **Review→adopt drift + double model call.** `adoptSynthesized` re-ran `composeSpec` (LLM call #2); with a live key (temp 0.3) the adopted spec could differ from the reviewed card ("approve N=7, hatch N=3"), and it wasted a call. | `synthesizeForWorkflow` now returns the composed `spec`; `adoptSynthesized(spec, name?)` forwards that reviewed spec to `adoptComposedSpec`. 2nd `composeSpec` call removed. `adoptComposedSpec`'s fail-closed `validateComposedSpec` (vs registry + live connections) still runs before any write, confining the client-supplied spec. (`actions.ts`, `BuildNibbinButton.tsx`) |
| 4 | red-team | **Prototype-chain lookups.** `capability(id)` (`CAPABILITY_REGISTRY[id]`) and `resolvePrimitiveInputs`'s `key in schema` resolved inherited members (`constructor`/`toString`/`__proto__` not rejected). Inert today (single-primitive funnel) but live the moment a 2nd primitive lands. | `Object.hasOwn` guards on both. (`capabilities.ts:120`, `interpreter.ts:156`) + regression tests. |
| 5 | red-team | **Latent generic atomic-draft path.** A composed atomic `draft`/`write` step would carry `effectArgs` from `step.inputs` with only CRLF/length sanitization. Unreachable from today's Composer, but the latent risk if a future composer emits raw side-effect steps. | `validateComposedSpec` now rejects any composed step whose capability has `sideEffect ∈ {draft,write}` and `kind !== 'primitive'` — composed side effects MUST ride a primitive that owns its effectArgs. (`validate.ts`) + regression test. |

### Test-gap & doc findings (claims-auditor) — all CLOSED
- **T2 (P2):** the spec claimed an end-to-end `interpretSpec`→`executeRun` draft-producing test that didn't exist (the two halves were tested separately). Added: overdue mailbox → `interpretSpec` → `executeRun` → `awaiting_approval` with the expected draft `effectArgs` + `patternKey`.
- **T3 (P2):** no test for the atomic-read-path SSRF/traversal defense-in-depth. Added: composed `email.read` with `../../admin` / `http://evil` / `//evil` is rejected by `validateComposedSpec`.
- **T1 (P3):** misnamed `overdueMailbox` fixture returned an empty mailbox. Renamed to `emptyMailbox`; added a real path-aware `overdueMailbox`.
- **D1 (documented deviation):** the implementation sets a composed spec's `toolsAllowlist` to the primitive's **`effectiveTools`** (`['email.read','email.draft']`), not `[capability]` as the plan said. This is a **correctness fix, not a weakening**: the runner gates on the *yielded atomic* capability, never the primitive id (which isn't a connector capability and would fail `validateSpec`). The plan's `[capability]` would have produced a spec killed at the first read. Honest, load-bearing, recorded here per the gate.

### Verified clean (not findings)
Runtime fan-out is **one draft per run** (oldest overdue thread only; mailbox sample capped 40/scope). Runner ceilings (`maxSteps 120 / maxTokens 12k / maxWallClockMs 60k`) bound every run; composed trigger carries a 3600s cooldown enforced at admission; eggs don't run. No-key fallback is genuinely key-free (no model call made then discarded). Migration `20260618050000` reproduces the advisory lock / §6.4 tier cap / egg insert / audit insert / grant byte-for-byte (diffed vs `20260611120000`); two trailing jsonb params appended with defaults; no SQL-injection / RLS-bypass vector; `security definer` + `set search_path=''` retained.

## Verification (post-fix)
- `npx tsc --noEmit -p packages/runtime` → exit 0
- `npx tsc --noEmit -p apps/web` → exit 0
- `npx vitest run packages/runtime/test apps/web/` → **378 passed (52 files)**
- `npx eslint packages/runtime/src apps/web/lib/composer apps/web/lib/runtime apps/web/app/app/diagnosis` → clean
- `npm run build -w @nibbin/web` → Compiled successfully; static pages 20/20

## Migration
`supabase/migrations/20260618050000_adopt_nibbin_steps.sql` — `adopt_nibbin` v2 (+`p_steps`/`p_persona_policy`). Applied to dev / staging / prod by the controller (see apply log below).

## Residual / deferred
- Budget-exhausted "Build a Nibbin" degrades silently to the deterministic proposal; `decision.notice` is available if a user-facing "built it the simple way today" message is wanted later (non-blocking).
- Out of 2a scope (per spec): more primitive shapes (2b), multi-primitive composition, editing the proposed spec, Planner (Slice 3), Crystallization (Slice 4).
