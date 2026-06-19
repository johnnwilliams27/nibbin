# Gate Report — Routing eval-suite harness (clear a 2nd reinforcement candidate)

**Date:** 2026-06-19
**Branch:** `feat/routing-eval-harness` (rebased onto main incl. #165/#166/#167/#168/#169)
**Surface:** a dev/CI eval tool under `packages/router/eval/` that scores challenger models vs incumbents per routed task (LLM-judge rubric over fixtures) and, via a `--write` step **not run in this PR**, arms `DEFAULT_TASK_CANDIDATES`. **Ships the candidate set EMPTY — zero runtime behavior change.** No migration.
**Review:** right-sized — this PR has no runtime effect, so the risk is the tool's correctness (the routing-arming activation is a separate, future PR that gets its own gate). Verification below + a focused reviewer was dispatched; the load-bearing facts (no runtime change, `route-unchanged` green, bundle isolation, clearance-rule + grouping tests) are green.
**Verdict: PASS** — no runtime behavior change; the mechanism is tested.

## What it is
The real unblock for Routing Reinforcement Slice B: reinforcement is inert because `DEFAULT_TASK_CANDIDATES` is empty (1 candidate per task), and a 2nd candidate can only be added once it has demonstrably passed an eval (the candidate set IS the eval-cleared allowlist; `validateCandidates` rejects unvetted models). This harness IS that eval gate — fixtures + a versioned LLM-judge rubric (`claude-opus-4-8`) → a per-(task,candidate) score → a clearance decision computed from scores (never hardcoded) → a `--write` that arms the candidate set.

## Candidate matrix (Anthropic-only — the user's selection)
- **Haiku 4.5 → T2 cost** (`custom_spec_draft`, `complex_plan`, `plan_synthesis`): cheaper challenger, clears within `qualityTolerance`.
- **Sonnet 4.6 → T1 quality** (`specialist_draft`, `map_labeling`): quality-headroom challenger, clears at ≥ incumbent.
- **Opus 4.8 → planning ceiling** (`complex_plan`, `plan_synthesis`): quality challenger + churn-resilience fallback. These two tasks thus carry BOTH a Haiku cost-challenger and an Opus quality-challenger; if both clear, the armed set is `[Sonnet, Haiku, Opus]` (incumbent first).
- `diagnosis_synthesis` / `nibbin_note` (the deliberate Opus splurges) NOT challenged.
(OSS / non-Anthropic candidates are logged as a deferred backlog item — they need a privacy/subprocessor decision + a multi-provider gateway seam first.)

## Correctness (verified)
- **No runtime change / no bundle bloat:** `DEFAULT_TASK_CANDIDATES` ships empty; the `route-unchanged` test stays green (19 cases); nothing under `eval/` is imported by `@nibbin/router`'s published `src/index.ts` or by `apps/web` runtime (the package `exports` maps only `./src/index.ts`); the web build is unaffected.
- **Clearance rule** (`eval/clearance.ts`): cost challenger clears at `incumbent − challenger ≤ qualityTolerance`; quality challenger at `≥ incumbent`; an IEEE-754 epsilon keeps the inclusive bar robust. Tests assert it fires EXACTLY at the bar.
- **Multi-challenger composition** (`eval/write.ts`, added with the Opus bundle): `clearedEntries` GROUPS multiple cleared challengers for one task into ONE ordered `[incumbent, ...challengers]` set (no duplicate object keys) — tested with `complex_plan` cleared by both Haiku and Opus → `[Sonnet, Haiku, Opus]`.
- **`--write` safety:** refuses on `--mock`; arms only cleared pairs; the brace-matched source transform fails LOUD if the `DEFAULT_TASK_CANDIDATES` marker is missing; a 3-candidate armed set passes `validateCandidates` (test).
- **Mock mode is spend-free** (no API/network); a mock report can't be mistaken for real clearance (`--write` refused on mock).

## Verification (post-rebase)
- `tsc -p packages/router` → 0
- `vitest run packages/router` → **113 passed** (mock-harness + clearance + grouping + `route-unchanged`)
- `eslint packages/router/src packages/router/eval …` → clean · `npm run build -w @nibbin/web` → Compiled (eval tool not bundled)

## Activation (separate follow-up, after a real run)
1. `ANTHROPIC_API_KEY=… npm run eval:routing` → real clearance report (5 tasks × 5 fixtures × candidates + Opus judge — modest spend).
2. `--write` arms `DEFAULT_TASK_CANDIDATES` for cleared pairs (a follow-up PR carrying the report as evidence — gets its own gate since it changes routing).
3. Flip `NIBBIN_REINFORCEMENT=true` once ≥1 task has ≥2 cleared candidates. It stays INERT until ≥`minDecidedCalls` (30) decided calls/candidate accrue (today: 12 total) — armed but dormant; the min-volume floor + `qualityTolerance` mean it can never degrade quality beyond noise.

## Migration
None.
