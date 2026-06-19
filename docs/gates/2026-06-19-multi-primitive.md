# Adversarial Gate Report — Multi-primitive composition + spec editing

**Date:** 2026-06-19
**Branch:** `feat/multi-primitive` (rebased onto main incl. router #158 / browser #159 / memory #160 / Training #162-queue)
**Surface:** the Composer trust boundary — a synthesized agent may now carry **1–4 primitive steps** (was always 1), and a user may **edit** the reviewed proposal (reorder / remove / re-param / re-cadence) before adopting. Both ride `validateComposedSpec` in `packages/runtime/src/validate.ts`. **No migration.**
**Reviewers (4 lenses):** red-team · logic-skeptic · claims-auditor · cost-auditor.
**Verdict: PASS** — no P0/P1 from any reviewer. One P2 + supporting P3s fixed in-branch (`e7220aa`).

## What it is
- **Multi-step composition.** `composeSpec` may emit `steps: [1..4]` (`MAX_COMPOSED_STEPS=4`); `assembleSpec` derives the trusted envelope (`toolsAllowlist` / `requiredConnectors` / triggers / curriculum / credit) as the **registry union** over all steps — the LLM never supplies it. The interpreter/runner are **unmodified**: `interpretSpec` iterates `steps[]` in order through the existing per-step gate, and `executeRun` returns `awaiting_approval` on the **first** drafted disposition — so each side effect is individually approval-gated across runs (not batch-executed).
- **Spec editing.** `applyComposerEdit` rebuilds the entire trusted envelope server-side from the registry off the **edited** caps, constrained to the reviewed proposal's capability set (`allowedCaps`); the client `ComposerEdit` carries only capability ids + scalar inputs + name + cadence. Preview (`previewComposerEdit`) and adopt (`adoptSynthesized`→`applyComposerEdit`→`adoptComposedSpec`) run the identical pure function and **re-validate fail-closed** — a triple gate (preview, adopt-edit, adopt-validate).

## Findings — no P0/P1
- **red-team:** the editing surface holds — registry-rebuild + fail-closed re-validation; no way to inject a non-primitive step, raw `path`/`effectArgs`, or out-of-bounds param. Cross-step caps enforced at both the parse cap (`slice(0,4)`) AND the validator (raw 5-step spec still rejected).
- **logic-skeptic:** no P0/P1/P2 — union derivation correct (Set-deduped, registry-resolved), 4-allowed/5-rejected, empty/invalid edited spec cannot adopt, re-derivation deterministic + from edited steps, multi-step run semantics safe (per-step approval, not batch).
- **claims-auditor:** every load-bearing claim TRUE in code; edit-injection refusal genuine + non-tautological (real validator, `allowedCaps` guard; the injected step was connector-*valid* so the refusal can only come from the guard). Interpreter/runner unmodified ⇒ cross-step gating structurally unchanged.
- **cost-auditor:** bounded — multi-step is "more bounded primitive steps within the one run's existing ceilings" (4-step cap ≪ `maxSteps:120`); the edit-preview path is model-free; synthesis remains exactly one budgeted `composeSpec` call.

### P2 + P3s fixed (`e7220aa`)
| Lens | Issue | Fix |
|------|-------|-----|
| red-team | **P2 — `validateComposedSpec` only checked each step's *home* connector, not the full tool→connector union.** On the legacy raw-spec path a hand-crafted spec touching a cross-resource primitive (e.g. `nudge.unconfirmed-event` — homed on google-calendar but drafts on gmail) could pass validation while omitting `gmail` from `requiredConnectors`. Runtime failed closed (primitive throws), but the "checks the FULL union" invariant claim was false. | Accumulate `derivedConnectors` across the per-step loop via the existing `uniqueConnectorsFor` helper (the same registry mapping `validateSpec` uses — not a divergent reimpl); assert every derived connector is BOTH in `granted` AND in `spec.requiredConnectors`. All existing per-step checks kept. The edit path was already immune (it rebuilds `requiredConnectors`). |
| red-team | **P3 — `effectArgs` sink rested on a single validator line.** The generic non-primitive draft/write path was unreachable for composed specs *only* because the draft/write branch rejected atomic steps — a future mis-tagged capability could reopen raw `effectArgs` injection. | Added a kind assertion right after the registry lookup: reject any step whose capability is not `kind === 'primitive'` and not `sideEffect === 'read'` — fires independently of the draft/write branch. |
| claims-auditor | **P3 (doc) — `applyComposerEdit` docstring said an unknown cadence is "refused".** | Corrected to "falls back to / defaults to the reviewed spec's cadence" (no code change; the code already defaults). |

### Carry-forward (non-blocking, accepted)
- **P3 (logic-skeptic):** dedup keys on byte-identical `step.inputs`, so `{}` vs `{staleDays:3}` (the default) for the same capability are not flagged as duplicates. Not a safety issue — each draft is individually gated with a distinct `patternKey`; the check is scoped to byte-identical repeats (legibility, not a boundary). Left as-is.
- **P3 (cost):** `previewComposerEdit` runs one indexed `activeConnections` read per committed edit with no client-side debounce — DB read load only (no model COGS, authenticated user only). Optional: debounce client-side.

## Verification (post-rebase + fixes)
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run packages/runtime/test apps/web/lib/composer apps/web/app/app/diagnosis` → **255 passed** (17 files — incl. the merged browser/`computer_use` suite, coexisting cleanly)
- `eslint …` → clean · `npm run build -w @nibbin/web` → Compiled successfully (24/24 static pages)

## Rebase integrity
Rebased onto main after browser (#159) merged — `validate.ts` now carries both the `computer_use` flag-aware checks and the composed-spec connector-union/kind checks with no conflict; the full runtime suite (incl. computer_use tests) passes alongside the multi-primitive suite.

## Migration
None.
