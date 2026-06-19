# Routing eval-suite harness (clear a 2nd reinforcement candidate) — design

**Date:** 2026-06-19
**Status:** approved (user: "build the eval-suite harness"). Independent of the browser work. No DB migration (it may WRITE a small clearance artifact + edit `tiers.ts`).
**Goal:** the real unblock for Routing Reinforcement Slice B — a runnable, deterministic harness that evaluates a challenger model against the incumbent per routed task, scores quality with an LLM-judge rubric over representative fixtures, emits a clearance report, and (for tasks a challenger clears) populates `DEFAULT_TASK_CANDIDATES` so reinforcement has ≥2 eval-cleared candidates to act on. Replaces the un-fabricatable "just add a 2nd model."

## Why this, not a flag flip
`DEFAULT_TASK_CANDIDATES` (`packages/router/src/tiers.ts`) is empty → reinforcement is inert (1 candidate per task). The candidate set IS the eval-cleared allowlist; `validateCandidates` rejects unvetted models. So reinforcement can only turn on for a task once a 2nd model has demonstrably passed an eval. This harness IS that eval gate (M6.5 §9 "swaps gated by the eval suite").

## What "cleared" means
A challenger CLEARS a task when its aggregate judge score over that task's fixtures is **within `qualityTolerance` (0.03) of, or above, the incumbent's** for a *cheaper* challenger (a P8 cost win at no meaningful quality loss), OR **≥ the incumbent** for a quality-headroom challenger. Clearing is evidence from a real run — the harness NEVER hardcodes a clearance.

## Components (a dev/CI tool — NOT in the router runtime path)
Place under `packages/router/eval/` (or `scripts/eval-routing/`) — importable by tests, not by the router's published entry.
1. **Fixtures** (`fixtures/<task>.ts`) — ~5–8 representative inputs per evaluated task, drawn from the real prompt shapes (composer draft, planner step, diagnosis synthesis, map_labeling, memory_extract, etc.). Keep them small + redaction-safe (no real PII).
2. **Candidate matrix** (config) — the (task → [incumbent, …challengers]) pairs to evaluate. Seed with the highest-value, P8-aligned set (adjustable):
   - **T2 tasks** (incumbent `claude-sonnet-4-6`) challenged by **`claude-haiku-4-5-20251001`** (cheaper — the clearest cost win where Haiku is adequate).
   - **T1 tasks** (incumbent `claude-haiku-4-5-20251001`) challenged by **`claude-sonnet-4-6`** (quality headroom, for quality-sensitive T1 tasks).
   - (diagnosis_synthesis stays Opus — do NOT challenge the deliberate splurge.)
3. **Runner** (`run.ts`) — for each (task, candidate, fixture): build the task's REAL prompt (reuse the existing prompt builders where importable; else a faithful fixture prompt) and call the candidate model. Needs `ANTHROPIC_API_KEY`. A **`--mock` mode** returns deterministic canned outputs + a deterministic fake judge so the harness is unit-testable in CI WITHOUT spend.
4. **Judge** (`judge.ts`) — LLM-as-judge: `claude-opus-4-8` scores each candidate output against a per-task rubric (correctness, schema/format adherence, safety/faithfulness) → 0..1. Aggregate to a per-(task,candidate) score. The judge prompt + rubric are explicit and versioned. (Mock mode bypasses with a seeded scorer.)
5. **Report** (`report.ts`) — emit `docs/eval/routing-<date>.md` (+ a JSON): per-(task,candidate) score, incumbent score, cleared bool + reason, estimated cost delta. Human-readable evidence.
6. **Clearance wiring** — a documented step (`--write`) that, for cleared (task→challenger) pairs, edits `DEFAULT_TASK_CANDIDATES[task] = [incumbent, challenger]` (incumbent FIRST = safe default). This is what arms reinforcement for that task. The edit reflects a REAL run's report; never wire an un-cleared pair.

## Tests (CI, mock mode — no API, no spend)
- the runner in `--mock` mode produces deterministic outputs; the judge scorer aggregates correctly; the clearance rule fires exactly at the bar (within-tolerance cheaper → cleared; below-bar → not; quality challenger ≥ incumbent → cleared).
- `validateCandidates` still accepts a wired `[incumbent, challenger]` pair (both are configured/`claude-*` models) — i.e. a cleared edit doesn't trip the router's construction-time guard.
- the route-unchanged invariant: with `DEFAULT_TASK_CANDIDATES` still empty (pre-wiring), `route()` is byte-for-byte unchanged (the existing `route-unchanged` test must stay green).

## Activation (after build + gate + merge)
1. Run the harness for real (`ANTHROPIC_API_KEY` set): `npm run eval:routing` → produces the clearance report. (Modest fixture counts keep the spend small.)
2. For cleared pairs, `--write` populates `DEFAULT_TASK_CANDIDATES` (a small follow-up PR carrying the report as evidence).
3. Flip `NIBBIN_REINFORCEMENT=true` once ≥1 task has ≥2 cleared candidates. **It stays INERT until ≥`minDecidedCalls` (30) decided calls/candidate accrue in the 30-day window** (today: 12 calls total) — the min-volume floor protects against thin data, so flipping it early is safe-but-dormant ("armed"). Reinforcement then shifts traffic only within `qualityTolerance`, so it can never degrade quality beyond noise.

## Verification (build-time)
- `tsc` (router + the eval package) → 0
- `vitest run packages/router …` → green incl. mock-mode harness tests + the unchanged `route-unchanged` test
- `eslint …` clean · `npm run build -w @nibbin/web` → Compiled successfully (the eval tool must not bloat the web/runtime bundle — it's dev/CI only)

## Usage (as built)
The harness lives at `packages/router/eval/` (a dev/CI tool — NOT exported from `@nibbin/router`'s published entry, so it never enters the web/runtime bundle).
- Free, deterministic mock run (CI-safe, no spend): `npm run eval:routing -- --mock`
- Real run (needs `ANTHROPIC_API_KEY`, spends): `ANTHROPIC_API_KEY=… npm run eval:routing`
- Real run + arm cleared pairs into `DEFAULT_TASK_CANDIDATES`: `ANTHROPIC_API_KEY=… npm run eval:routing -- --write` (refused on `--mock`).

Both modes write `docs/eval/routing-<date>.md` + `.json`. The candidate matrix is `eval/candidates.ts`; per-task fixtures + versioned rubrics are `eval/fixtures/<task>.ts`; the LLM-judge (`claude-opus-4-8`) is `eval/judge.ts`; the clearance rule is `eval/clearance.ts`. Mock-mode runner/judge/aggregation/clearance + the `--write` dry-run are covered by `packages/router/test/eval-harness.test.ts` (no API, no spend). This PR ships `DEFAULT_TASK_CANDIDATES` STILL EMPTY (the `route-unchanged` invariant stays green); a populated set is a follow-up PR carrying a real run's report.

## Out of scope
Golden-dataset curation beyond the seed fixtures; auto-running on a schedule; clearing T0 (no cheaper model than Haiku). The real eval RUN + the candidate-set edit are activation steps (this PR delivers the runnable, tested harness + the wiring mechanism).
