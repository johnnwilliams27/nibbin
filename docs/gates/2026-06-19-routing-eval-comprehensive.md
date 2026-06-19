# Gate Report — Comprehensive routing eval + arm 11 candidate menus

**Date:** 2026-06-19
**Branch:** `feat/routing-eval-comprehensive` (off main incl. #177)
**Surface:** (1) expands the eval harness to the maximal envelope (dev/CI tool) + (2) arms **11** eval-cleared candidate menus in `packages/router/src/tiers.ts` from a real maximal run (routing change). No migration.
**Reviewers:** logic-skeptic (routing-arming safety + evidence) · harness-runner reviewer (concurrency/cache/fixtures/isolation) · CI adversarial-gate.
**Verdict: PASS** — no P0/P1/P2 from either reviewer.

## What it is
A maximal eval (Haiku/Sonnet/Opus across all 13 challengeable tasks, ~20 diverse fixtures/task incl. adversarial-as-data, 3-sample-median Opus judge) cleared **12 of 16 pairs → 11 tasks armed** (incumbent-first; `--write`):
- **8 T1 tasks** → `[Haiku, Sonnet]` (Sonnet quality headroom — large margins on `memory_extract` 0.887 vs 0.571, `training_feedback` 0.925 vs 0.748, `scan_synthesis` 0.901 vs 0.736; thin on `specialist_draft`).
- **`custom_spec_draft`** → `[Sonnet, Haiku, Opus]` (cost win Haiku 0.964≈0.960 + quality option Opus 0.972).
- **`complex_plan`, `plan_synthesis`** → `[Sonnet, Opus]` (Opus cleared; cheaper Haiku correctly did NOT — 0.033 / 0.090 below tolerance).
- **Splurges report-only, NEVER armed:** `diagnosis_synthesis` (Sonnet 0.743 vs Opus 0.934), `nibbin_note` (Sonnet 0.608 vs Opus 0.785) — the eval CONFIRMS Opus is warranted; "never cost-optimize the belief-earning moment" now evidenced, not just asserted.

Harness changes: ~260 fixtures + versioned rubrics across 13 tasks, 3-sample-median judge, splurge `reportOnly` guard, graceful Fable pricing, and runner hardening (bounded concurrency `EVAL_CONCURRENCY=6` + per-call retry + per-task score cache) so a maximal run is tractable + survivable. **Fable 5 excluded** (the account lacks "fable-mythos" access; the API rejects it — so it's not a viable prod candidate; harness still handles it if access is granted).

## Findings
**Logic-skeptic (routing) — PASS, no must-fix:**
1. **route() UNCHANGED** with the perf source off (`NIBBIN_REINFORCEMENT` gates the source in `apps/web/lib/grove/router.ts`; `chooseModel` returns `candidates[0]` = incumbent). All 11 incumbents are the configured static model (Haiku for T1, Sonnet for T2). Even flag-on, the snapshot starts empty → fallback until decided-call volume accrues. `route-unchanged` green for all 11.
2. **chooseModel safe for every shape** — quality challengers win only on a live >tolerance margin past `minDecidedCalls=30`; the 3-element `custom_spec_draft` set can't cost-runaway (Opus wins only if >0.03 above BOTH cheaper models); `complex_plan`/`plan_synthesis` are budget-bound (not in `UNBUDGETED_T2_TASKS`).
3. `validateCandidates` passes all 11 (all `claude-*`/configured).
4. **Clearances independently recomputed** from the report — exactly 12 clear / 4 don't; armed sets correct + incumbent-first; no fabrication.
5. **Splurge guard** holds — both absent from `DEFAULT_TASK_CANDIDATES`, still Opus-pinned.

**Harness-runner reviewer — PASS, no must-fix:**
- `mapPool` order-preserving (position-indexed) + race-free (`next++` atomic on the event loop) + edge cases handled + throw-propagating.
- `withRetry` rethrows (no swallow), retry lands in the right slot, mock passthrough.
- `scoreOnce` cache: no key collision, incumbent reuse provably score-identical to per-pair scoring, mock-deterministic.
- 3-sample median correct; fixtures faithful (diagnosis prompt byte-identical to `synthesis.ts`; others disclosed reproductions), redaction-safe (fake bait as DATA), no `temperature`.
- Bundle isolation preserved; prod COGS pricing stays fail-loud (`costMicroUsd`/`ratesForModel` throw on unknown; `*OrNull` variants are eval-only).

### P3 (non-blocking, no fix)
- `mapPool` doesn't cancel sibling workers on a rejection (harmless for a finite dev run).
- `training_feedback` + a few fixtures are faithful *reproductions* (server-only prod builders can't be imported) — disclosed in the file headers.

## Verification
- `tsc -p packages/router` + `-p apps/web` → 0 · `vitest run packages/router` → **132 passed** (incl. `route-unchanged` + armed-state + splurge-guard + concurrency/median) · `eslint` clean · `npm run build -w @nibbin/web` → Compiled successfully (eval tool not bundled).

## Activation
`NIBBIN_REINFORCEMENT` is already on in prod. Each armed menu activates per-task as ≥30 decided calls/candidate accrue; the cost-aware policy keeps cheap Haiku wherever it's within tolerance and only pays up for Sonnet/Opus on a real live quality margin. Re-run `npm run eval:routing` later to re-vet or add candidates (incl. Fable if access is granted).

## Migration
None.
