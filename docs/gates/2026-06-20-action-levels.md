# Adversarial Gate — Permission Model: Action Levels (`feature/action-levels`)

**Date:** 2026-06-21
**Range:** `cc33e113..e945f03f` (14 commits, 84 files)
**Reviewers:** red-team (opus), claims-auditor (opus), logic-skeptic (opus), cost-auditor (sonnet)
**Trigger:** foundational safety-model change — the Agent School *stage* gate (`gateSideEffect`) is removed from the execute path; a per-Nibbin owner-set `action_level` (Observe/Draft/Send) is now the sole execution gate; grade is advisory.

## Verdicts

| Reviewer | Verdict | P0 | P1 | P2 |
|---|---|---|---|---|
| red-team | PASS-WITH-FIXES | 0 | 2 | 3 |
| claims-auditor | PASS-WITH-FIXES | 4 | 7 | 4 |
| logic-skeptic | **FAIL** | 2 | 2 | 4 |
| cost-auditor | PASS-WITH-FIXES | 0 | 1 | 1 |

**Overall: FAIL — fixes required before merge.**

## What passed (positive confirmation)

- **Every money-/trust-critical wall verified intact byte-for-byte on the `send` path** (red-team): idempotency claim-before-effect (`runner.ts:416-435`), atomic send-velocity consume-before-send (`engine.ts:284-310`), resource-claim conflict lock claimed before the irreversible send (`runner.ts:366-414`), vault-only tokens / account-wide scope check unchanged, quarantine (`runner.ts:242`). An Egg+Send Nibbin cannot double-send, exceed velocity, or break a resource lock. **No containment hole.**
- **Grade→action-level decoupling is genuine** (logic-skeptic): `dispatchStep` reads `freshNibbin.stage` but never gates on it; the Task-6 invariance test is real, not a tautology.
- **Routing tiers unchanged** (cost-auditor): the router reads only `userId`/`task`/daily budget — `action_level` does not touch model selection or token budget. No runaway loops; fan-out unchanged.
- **IDOR guard solid** (red-team): `setNibbinActionLevel` resolves account server-side and scopes every query by `account_id`.
- **Migration backfill correct** (all): promotes to `send` only for `email.send`/`calendar.event-create` grant holders; does not escalate `email.draft`-only drafters.
- **Authoritative registers correct** (claims-auditor): `INVARIANTS.md` C8, `SPEC.md` C8 register, oauth-verification, subprocessors, and the `NibbinControls` action-level UI control.

## Findings → disposition

### P0 — fixed in this gate's fix wave

- **P0-1 (logic) — `email.draft`→`email.send` collapse kills every adopted email Nibbin.** Immutable `agent_specs.tools_allowlist` rows still say `email.draft`; the allowlist gate (`runner.ts:289`) kills the run. Spec line 90 mandated a migration+shim; it was missed. **Fix:** data migration rewriting `tools_allowlist` (+ `steps[].capability`) `email.draft`→`email.send` on all rows; load-time normalization shim in spec load as belt-and-suspenders; drop `email.draft` from `registry.ts:106`; end-to-end test driving a stored `email.draft` allowlist.
- **P0-2 (logic) — Observe leaks a draft for presentation steps.** `runner.ts:303` evaluates `step.presentation` before the `observe` deny. **Fix:** evaluate `level === 'observe'` first; presentation@observe test asserting `killed:observe` + zero draft rows.
- **P0 copy ×4 (claims) — surfaces still asserting the retired stage-gate:** `SPEC.md:355`, `help-compendium.md:58`, `content.ts:377/384`, `MayaDemo.tsx:331`. Exact replacements in `sdd/gate-claims.md`.

### P1 — fixed in this gate's fix wave

- **P1-2 (logic) — gate `else→execute` is fail-OPEN** for unknown/NULL `action_level`. **Fix:** branch on `level === 'send'` for the execute arm; default everything else to draft; coalesce `?? 'draft'` in `SupabaseRunStore.getNibbin`.
- **P1-1 (logic) + F1 (cost) + P1-2 (red-team) — native-draft mirror cluster.** The mirror is dead (`nativeDraft` flag is on the capability descriptor but read from `effectArgs`; nothing bridges them); `createDraft` has no idempotency guard (orphan-on-retry); the executor trusts `nativeDraftRef`/`dismiss` from `effectArgs` without provenance (latent send-at-draft landmine, unreachable today). **Fix:** bridge the descriptor flag into the gate (`runner.ts:324`); idempotency/existing-ref guard before `createDraft`; resolve `nativeDraftRef` server-side from `run_steps.payload` for the current `(runId, stepIdx)` and reject effectArgs-supplied refs; strip reserved keys `nativeDraft`/`nativeDraftRef`/`dismiss` from spec-supplied inputs in `validateComposedSpec`/interpreter; replace the tautological Task-4 tests with a real primitive-driven end-to-end test.
- **P1 copy ×7 (claims) —** landing School ladder, about, adopt, help `content.ts`, `help-compendium.md` glossary, tracked `reference/*.html`. Exact replacements in `sdd/gate-claims.md`.

### Product decision (owner)

- **Egg+Send semantics (red-team P2-1 / logic-adjacent).** The Egg run-admission fence stopped an Egg+Send Nibbin from acting until it hatched to Student — stage still gated the first run, contradicting "Send = act regardless of stage." **Owner chose: remove the Egg fence** so `action_level` is the truly sole gate. **Fix:** relax the admission fence so a run admits regardless of stage and is governed only by `action_level`; update the `egg→not_started` tests to assert egg+observe/draft/send behave per the action-level gate.

### P2 — fixed where cheap, else recorded

- Calendar grant not materialized at `send` (`action-level-actions.ts`) — also upsert `calendar.event-create` for `google-calendar`.
- Stale executor/`RunnerDeps` comments asserting removed grant/School gates — correct to "action_level is the sole gate."
- `NibbinControls` Send-below-Graduate warning says "will draft first, then ask you to confirm each send" — under-claims Send (which acts autonomously); reword.
- Observe runs terminate as `killed` (pollutes kill-rate telemetry); `patternKey` lineage discontinuity; no-op `20260620200000` migration — recorded, low impact.
- P2 copy ×4 (claims): `MOAT.md`, `CLAUDE.md`/`AGENTS.md`, `PRODUCT-FOUNDATION.md`, connector-builder SKILL.md — "unlocks/gates/earns autonomy" → advisory-grade framing.

## Re-review

After the fix wave, the safety-critical runtime changes (egg-fence removal, observe ordering, fail-safe default, native-draft wiring + provenance, allowlist migration/shim) get a focused re-review before the PR opens.

## Resolution

- **Runtime/logic fix wave** — commit `8caee2d5`. All P0/P1 logic+cost+red-team findings fixed; `email.draft`→`email.send` data migration (`20260620210000`) applied to dev/staging/prod (all SUCCESS). Owner-chosen Egg-fence removal landed. Native-draft mirror now descriptor-driven + orphan-guarded; provenance closed via `sanitizeEffectArgs` (the sole spec-inputs→effectArgs path) + a `validateComposedSpec` backstop.
- **Copy fix wave** — commit `354a86b5`. All 4 P0 + 7 P1 + 4 P2 copy findings fixed, plus 5 additional survivors caught by a synonym grep (`DiagnosisReveal`, `CrystalPreview`, `compose.ts`, Keeper prompt). `NibbinControls` Send warning corrected (Send acts on its own). Final grep: only 2 benign non-model hits.
- **Focused re-review of `8caee2d5`** — **PASS-WITH-FIXES (0 P0, 0 P1, 1 P2)**. Confirmed: egg-fence removal SAFE (all other admission guards stage-independent and intact; observe-kills refund; gate has zero `stage` refs); provenance stripping COMPLETE; no tests weakened. The 1 P2 (untested load-time shim) closed by `4b92f85c` (`spec-normalize.test.ts`, 4 tests).
- **Final verification:** lint clean; full suite 2111 passed / 6 skipped; only the 3 pre-existing `@sparticuz/chromium` env failures remain (green in CI).

**Gate status: PASS** (all FAIL-causing P0/P1 resolved and re-verified).
