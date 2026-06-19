# Gate Report — Activate reinforcement: arm 2 eval-cleared candidate sets

**Date:** 2026-06-19
**Branch:** `feat/routing-arm-candidates` (off main incl. #169/#173)
**Surface:** routing — arms `DEFAULT_TASK_CANDIDATES` (`packages/router/src/tiers.ts`) from a REAL eval run, turning Routing Reinforcement Slice B from inert to **armed** for 2 tasks. No migration.
**Review:** focused logic-skeptic (the reinforcement *machinery* was already gated at #158; this reviews whether arming THESE specific sets is safe, evidence-backed, and behavior-neutral until the flag flips) + the CI adversarial-gate (sensitive surface).
**Verdict: PASS** — no P0/P1/P2.

## What it is
A real eval run (`docs/eval/routing-2026-06-19.md`, Opus judge, 7 candidate pairs over redaction-safe fixtures) cleared **2 of 7**. `--write` armed them, incumbent-first:
- **`custom_spec_draft` → `[claude-sonnet-4-6, claude-haiku-4-5-20251001]`** — COST win: Haiku **0.988** within `qualityTolerance` (0.03) of Sonnet 0.990, at ~3× lower cost ($0.0009 vs $0.0030/call).
- **`complex_plan` → `[claude-sonnet-4-6, claude-opus-4-8]`** — QUALITY headroom: Opus **0.980 ≥** Sonnet 0.928.
The other 5 correctly did NOT clear (conservative): `complex_plan` cost (Haiku −0.040), `plan_synthesis` cost (Haiku −0.122), `specialist_draft` quality (Sonnet 0.944<0.952), `map_labeling` quality (Sonnet 0.910<0.912), `plan_synthesis` quality (Opus 0.986<0.996). Also fixes an eval-only bug: the current models reject the deprecated `temperature` param, now stripped on the eval's generate seam (prod calls untouched).

## Findings (logic-skeptic — PASS, no must-fix)
1. **route() UNCHANGED while `NIBBIN_REINFORCEMENT` off.** `modelFor` forces the static model to lead the candidate set; `chooseModel` returns `candidates[0]` immediately when there's no perf source. For both armed t2 tasks the incumbent is `claude-sonnet-4-6` (today's model). `route-unchanged` test covers both tasks and stays green. **Zero behavior change today.**
2. **Safe when reinforcement IS on.** `custom_spec_draft [Sonnet, Haiku]`: Haiku wins only past `minDecidedCalls=30` + above `qualityBar` + within `qualityTolerance` → can't degrade quality beyond noise; cost strictly improves. `complex_plan [Sonnet, Opus]` (pricier challenger): cost-aware tie-break keeps cheaper Sonnet unless Opus shows a real quality margin OUTSIDE tolerance; bounded by the T2 per-user daily frontier budget (`complex_plan` is NOT unbudgeted). **No cost-runaway when the flag flips.**
3. **`validateCandidates` passes** both sets (all `claude-*` / configured models) — no fail-closed throw at construction.
4. **Clearances match the evidence** — all 7 recomputed from the JSON against the stated rule; exactly 2 clear, 5 excluded correctly; no fabrication; incumbent-first.
5. **`temperature` fix is eval-scoped** — wraps the eval's `createAnthropicClient` only; not used by `apps/web`/`packages/runtime`. Prod unaffected.

### Cosmetic P3s
- Stale "DEFAULT IS EMPTY" docblock in `tiers.ts` → **fixed** (now describes the armed state + the until-flipped guarantee).
- Verified `NIBBIN_REINFORCEMENT` is the real on-switch: `apps/web/lib/grove/router.ts` `performanceFromEnv()` injects the perf source only when the env var is truthy. (Handoff instruction is accurate.)

## Verification
- `tsc -p packages/router` → 0 · `vitest run packages/router` → **115 passed** (incl. `route-unchanged` + the new armed-state assertions) · `eslint …` clean

## Activation (remaining — ops)
Flip `NIBBIN_REINFORCEMENT=true` in Vercel prod. Armed-but-dormant until ≥30 decided calls/candidate accrue in the 30-day window (prod has 12 total today); then it shifts `custom_spec_draft`→Haiku on cost and `complex_plan`→Opus on quality, within the policy guardrails.

## Migration
None.
