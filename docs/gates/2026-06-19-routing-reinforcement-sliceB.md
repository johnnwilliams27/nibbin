# Adversarial Gate Report — Routing Reinforcement Slice B + P8 cost-aware

**Date:** 2026-06-19
**Branch:** `feat/routing-reinforcement-sliceB`
**Surface:** `packages/router` (sensitive-path) + `apps/web/lib/grove` wiring. A reinforcement POLICY on top of the static router, reading the Slice-A `model_task_performance` substrate. **No migration** (reuses the Slice-A RPC).
**Reviewers:** logic-skeptic · red-team · claims-auditor (cost N/A — `route()` stays synchronous, no new model calls, no cost-surface change).
**Verdict: PASS** — no P0/P1. Four converging P3s fixed in-branch.

## What this is
Generalizes per-task model resolution from one static model → an ordered **candidate set** (the eval-cleared allowlist; default empty so today's single model is the sole candidate), plus a deterministic `chooseModel` weighting that reads the Slice-A signal (approved-unedited rate, refusal/error, cost) and shifts traffic among candidates by **quality-within-budget** with a min-volume floor, **P8 cost-aware** (cheapest within a quality tolerance). **Zero behavior change today** (one candidate + empty signal → returns exactly today's model); reinforcement is default-off (`NIBBIN_REINFORCEMENT`) and inert until ≥2 eval-cleared candidates + data accrue. Never introduces an unvetted model (the candidate set IS the allowlist).

## Findings & dispositions
**No P0/P1.** All verified clean:
- **logic-skeptic:** no-behavior-change *verified* (traced `route()`→`modelFor`→`chooseModel`'s `<2 candidates || !source` early return + the `route-unchanged` pin over all 6 T0/8 T1/5 T2 tasks, incl. an empty-perf-source pass); weighting sound (min-volume floor on the incumbent + per-challenger floor → no thin-challenger unseat; refusal/error exclusion; no div-by-zero; P8 cost + rank tiebreak); degraded path bypasses reinforcement; fail-safe perf source.
- **red-team:** PASS — service-role-only telemetry read (no cross-account leak; model id never user-visible), static model forced to lead the candidate set, fail-safe on bad reads, genuinely inert when off, no new external surface.
- **claims-auditor:** PASS — all four headline claims TRUE; mutation-tested the safety/cost tests as non-vacuous; no migration (reuses the Slice-A `model_task_performance_read`); scope router+grove only.

### P3s fixed (`ddb985e`)
| Lens | P3 | Fix |
|------|-----|-----|
| red-team + logic-skeptic | env/config candidates weren't constrained to a vetted-model set (operator could fat-finger an unvetted id) | `validateCandidates()` (runs at `createRouter` + `reconfigure`): every candidate must be a configured-model-union member OR pass the `claude-*` shape gate; empty/unvetted → throws at construction (fail-closed). Makes "never an unvetted model" structural. *(Honest note: the shape gate is a convention backed by the eval-suite process, since an existing test registers a `claude-*` cheaper-variant challenger not in the pin union.)* |
| logic-skeptic | snapshot `key()` had no delimiter (theoretical collision) | `${model}\|${task}\|${tier}` |
| claims-auditor | dead `qualityBandMicros` JSDoc line (no such field) | removed |

## Verification (post-fix)
- `tsc -p packages/router` + `-p apps/web` → 0
- `vitest run packages/router apps/web/lib/grove` → **106 passed**; `route-unchanged` green (no behavior change); existing router suite unbroken
- `eslint packages/router/src apps/web/lib/grove` → clean
- (also re-encoded `performance-source.ts` to UTF-8 — a stray-NUL artifact from the build agent; now clean text)

## Migration
None.

## Readiness note
This builds the reinforcement **machinery**; it acts on data that doesn't exist yet (still one model per tier, the Slice-A signal view is empty until traffic accrues). It is correct + inert until a 2nd eval-cleared candidate is configured and signal accumulates — infra-ahead-of-data by design.
