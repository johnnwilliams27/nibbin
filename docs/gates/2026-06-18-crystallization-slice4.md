# Adversarial Gate Report — Crystallization Slice 4 (C-plan → durable B-spec)

**Date:** 2026-06-18
**Branch:** `feat/crystallization-slice4`
**Surface:** sensitive — a path that mints a **durable, recurring, eventually-autonomous agent** from a successful Planner run. Reuses the Composer's validator + adoption; the only new runtime code is a pure deterministic extractor + a fail-closed gate. Migration `20260618070000_agent_specs_source_plan_run.sql`.
**Spec:** `docs/superpowers/specs/2026-06-18-crystallization-slice4-design.md` · **Plan:** `docs/superpowers/plans/2026-06-18-crystallization-slice4.md`
**Reviewers (4 lenses):** red-team · logic-skeptic · claims-auditor · cost-auditor
**Verdict: PASS** — no surviving P0/P1. The gate found NO P0; the core design (faithfulness, gate fail-closed, re-derive, egg-hatch, migration parity) was verified by all four. **One P1 (an account-deletion FK landmine)** + P2/P3 hardening were fixed in-branch.

## Safety thesis (verified)
- **Faithfulness — steps from the trace, never the LLM.** `crystallizeTranscript` extracts the executable `CapabilityStep[]` deterministically; the soft-layer LLM (`proposeCrystalSoftFields`) is *structurally incapable* of reading a `steps` field (the `SoftFields` type has none). Verified by a non-tautological test: the LLM mock returns a bogus `steps:[{email.send,...}]` + a hijack name, and the assembled spec's steps are exactly the extracted primitive and `toolsAllowlist` never contains `email.send`. (claims-auditor + red-team confirmed.)
- **Gate fail-closed.** `crystallizabilityGate` refuses on `not_done`, `no_action` (read-only/research), `utility_in_path` (web.*/scratchpad/memory.retrieve/ask_human scanned across the whole transcript), `branching` (observation-derived id in a read path), `ungeneralizable` (raw atomic draft/write), `invalid_spec` (the real `validateComposedSpec`). Ambiguous → refuse. (logic-skeptic traced all six.)
- **Re-derive on adopt.** `adoptCrystal` takes NO client spec — it re-loads the account-scoped source plan_run, re-runs `crystallize`, and re-validates fail-closed; only `name`+`cadence` are client-influenced (neither a step/tool/connector sink). A foreign `planRunId` → `not_found` (no transcript leak). (red-team + logic-skeptic.)
- **No trust transfer.** The crystallized agent hatches as an **egg** (`adopt_nibbin` hardcodes `stage='egg'`); no write-grant/stage/routine-approval from the supervised run transfers; the `curriculum`/`creditProfile` are server-side constants.
- **No XSS sink.** The LLM-proposed `displayName` flows to a controlled React `<input value>` (escaped, length-capped); persona isn't rendered; steps render as text nodes.
- **Migration parity + tier cap.** `adopt_nibbin` v3 is byte-for-byte v2 + the additive `p_source_plan_run_id` param/column; the §6.4 tier cap counts the new egg (no bypass); injection-free (typed param, static body, `security definer`, service-role-only).
- **Cost bounded.** The soft-layer call is budgeted (`plan_synthesis`/`origin:'chat'`) + COGS-recorded + token-capped + prompt-bounded (goal + extracted steps, never the raw transcript) + free on no-key; the crystallize path is pure (no Planner re-run); the minted agent inherits standard ceilings + a 1h cooldown + a daily/weekly cadence floor.

## Findings & dispositions (all fixed in-branch)
| # | Lens | Sev | Finding | Fix |
|---|------|-----|---------|-----|
| 1 | logic-skeptic | **P1** | **FK landmine** — `source_plan_run_id uuid references plan_runs(id)` with no `ON DELETE` would abort the account-deletion cascade (the documented M7 class — 5 tables previously burned). | `... on delete set null` (preserves the durable spec, drops dangling provenance). |
| 2 | logic-skeptic | P2 | **Branching under-refuse / dead read** — a `listing-read → primitive` run crystallized with a leading atomic read whose result the linear interpreter discards (dead weight; the primitive re-reads/re-detects). Not unsafe (egg-gated + primitive owns detection) but the extract was misleading. | The extractor now **drops** a decorative leading atomic read when a following primitive reads the same connector — the spec is just the primitive (the faithful "the primitive is the chore"). Genuine observation-derived-id branching still refuses. Spec §2 documents the drop. |
| 3 | logic-skeptic | P2 | **Soft-layer mis-attributed account id as `userId`** → wrong per-user budget key + wrong `model_calls.user_id`. | Threaded the real `user.id` into `crystallize`/`proposeCrystalSoftFields`. |
| 4 | cost-auditor | P2 | **`proposeCrystal`/`adoptCrystal` skipped `rateGuard`** (the other Planner entry points use it). | Added `rateGuard(accountId)` to both. |
| 5 | claims-auditor | P2 | **Egg test was mock-passing** (asserted against a mocked `adoptComposedSpec`). | Strengthened to assert the load-bearing contract: `adoptCrystal` routes through `adoptComposedSpec` with a `templateKey:null` spec (egg-ness then guaranteed by the migration's hardcoded `stage='egg'`). |
| 6 | cost-auditor | P3 | **No source idempotency** — a double-submit could mint two duplicate recurring agents (both tier-capped). | Partial unique index `agent_specs(account_id, source_plan_run_id) where not null`; `adoptCrystal` returns a clean `already_recurring` on conflict. |
| 7 | red-team | P3 | **Client cooldown not floored.** | `Math.max(3600, …)` clamp on the chosen trigger. |
| 8 | red-team | P3 | **Propose-time validate skipped `existing`** (cross-account cycle check) — harmless (adopt-time is authoritative) but no parity. | Threaded `existing` into the propose-time `validateComposedSpec`. |
| 9 | red-team | P3 | **Revoked-grant adopt → generic error** instead of the structured reconnect flow. | `adoptCrystal` now computes the missing connectors and returns the `?needs=…` reconnect redirect (mirrors `adoptSynthesized`). |

### Doc-only corrections (no code change; recorded for accuracy)
- The implementer's headline mis-ordered the gate checks (actual: `not_done → utility → branching → ungeneralizable → no_action → invalid_spec`); each reason still fires for its fixture — no behavioral bug.
- "Reuses `connectorsFor`" was an overclaim — it's a parallel `connectorsForSteps` re-implementation that *mirrors* the Composer's; `validateComposedSpec`/`adoptComposedSpec` ARE genuinely reused.

## Verification (post-fix)
- `npx tsc --noEmit -p packages/runtime` → exit 0
- `npx tsc --noEmit -p apps/web` → exit 0
- `npx vitest run packages/runtime/test apps/web/` → **597 passed (74 files)**
- `npx eslint packages/runtime/src apps/web/lib/planner apps/web/lib/runtime apps/web/app/app/planner` → clean
- `npm run build -w @nibbin/web` → Compiled successfully

## Migration
`20260618070000_agent_specs_source_plan_run.sql` — `agent_specs.source_plan_run_id` (FK `on delete set null`) + the partial unique index + `adopt_nibbin` v3 (19th param). Applied to dev / staging / prod by the controller (see apply log).

## Deferred (per spec §7) — arc state after Slice 4
Editing the crystallized spec pre-adopt; auto-*suggesting* crystallization; cross-run merging. With Composer (B) + Planner (C) + Crystallization (C→B) all shipped, the **two authoring modes and the bridge between them are complete.** Remaining synthesis-adjacent work (separate, larger designs): browser/`computer_use` tools; routing reinforcement; Training Mode; the two Planner follow-ups (DNS-rebind SSRF, primitive-internal repetition on resume).
