# Comprehensive routing eval (maximal) — design

**Date:** 2026-06-19
**Status:** approved (user chose the "Maximal confidence" envelope). Builds ON the merged eval harness (`packages/router/eval/`, PRs #173/#177). No migration.
**Goal:** comprehensively vet the routing table so more task→candidate menus can be armed with statistical confidence — getting closer to a broadly-enabled 2-model menu. Maximal rigor: ~20 diverse fixtures/task, 3-sample judging on every output, all Anthropic candidates incl. Fable 5, splurges stress-tested.

## Coverage matrix (task × candidates)
Incumbents from `tiers.ts` (`DEFAULT_MODELS`/`DEFAULT_TASK_MODELS`). Challengers below.

**T1 (incumbent `claude-haiku-4-5-20251001`) — quality + peer:**
`specialist_draft`, `scan_synthesis`, `onboarding_understanding`, `training_feedback`, `map_labeling`, `sweep_pass1`, `sweep_pass2`, `memory_extract` — challenged by **`claude-sonnet-4-6`** (quality headroom) and **`claude-fable-5`** (peer).

**T2 non-splurge (incumbent `claude-sonnet-4-6`) — cost + quality + peer:**
`custom_spec_draft`, `complex_plan`, `plan_synthesis` — challenged by **`claude-haiku-4-5-20251001`** (cost), **`claude-opus-4-8`** (quality), **`claude-fable-5`** (peer).

**T2 splurge (incumbent `claude-opus-4-8`) — REPORT-ONLY, NEVER auto-armed:**
`diagnosis_synthesis`, `nibbin_note` — challenged by **`claude-sonnet-4-6`** and **`claude-fable-5`** for INSIGHT only (is a cheaper model adequate for the belief-earning moments?). **Hard rule:** the harness MUST exclude these from `--write` arming regardless of score (a `reportOnly` flag on the pair + a splurge denylist in `write.ts`), honoring §6.3 "never cost-optimize the moment that earns belief." The report surfaces the scores; `DEFAULT_TASK_CANDIDATES` for these stays untouched (Opus-pinned).

**T0: excluded** (Haiku is already the cheapest class, tasks are scripted/templated where possible, no cost or quality lever). Documented; can be added later if a specific T0 quality complaint arises.

## Fable 5 candidate
`claude-fable-5` — passes `validateCandidates` (the `claude-*` shape gate). **Pricing:** ensure `packages/router/src/pricing.ts` has an entry; if Fable's per-token price is unknown, `costMicroUsd` must degrade gracefully (return null/0 + the report shows cost delta "N/A" for Fable) — quality clearance is still valid; only the cost-delta line is informational. Do NOT crash on an unknown model.

## Fixtures (~20/task, deliberately diverse)
Per task ~20 redaction-safe synthetic inputs (NO real PII), spanning: ~8 typical, ~5 hard/complex, ~4 edge/messy/ambiguous, ~3 adversarial-as-DATA (injection text that must be treated as content, not instructions — verifies the model doesn't obey embedded commands). Each faithful to the task's REAL prompt shape (reuse the existing fixtures' shape + the prod prompt builders). Expand the 5 existing tasks 5→20; author 20 each for the 8 new T1 tasks + the 2 splurges. Rubrics: a versioned `Rubric` per task (correctness / schema-format / safety-faithfulness) — author for all new tasks; bump existing rubric versions only if criteria are refined.

## Judge — 3-sample median (the maximal lever)
Add a `sampleCount` option to the LLM judge (default 1; this run uses **3**). For each output, run the Opus judge 3× and take the **MEDIAN** of the 3 scores (robust to a single outlier). Versioned judge prompt. Mock judge stays deterministic (sampleCount has no effect in mock / returns the seeded score). This is the variance-reduction that makes "evidence" trustworthy at scale.

## Clearance + arming (rule unchanged)
- Cost challenger clears within `qualityTolerance`; quality/peer challenger clears at `≥ incumbent` — computed from the median-aggregated scores, never hardcoded.
- **Splurge `reportOnly` pairs are NEVER written** to `DEFAULT_TASK_CANDIDATES` (even if they "clear"). Enforced in `write.ts` (`clearedEntries` skips `reportOnly`).
- Non-splurge cleared challengers are armed, composing per-task multi-challenger sets (`[incumbent, ...clearedChallengers]`, e.g. `[haiku, sonnet, fable]`) — the grouping logic already exists.
- Incumbent-first → route() unchanged until enough decided-call volume accrues (`NIBBIN_REINFORCEMENT` is already on in prod).

## Report
Per-(task, candidate): median score + the 3 raw samples (variance visibility) + cost delta (N/A for Fable if pricing unknown) + cleared/not + a `reportOnly` marker for splurges. Plus a summary of which menus would be armed.

## Tests (mock, CI, spend-free)
- 3-sample median logic (deterministic): given 3 mock scores, the median is taken.
- **splurge `reportOnly`:** a splurge pair that scores as "cleared" is NOT armed by `--write` (asserted) — the hard guard.
- Fable candidate passes `validateCandidates`; an armed `[incumbent, sonnet, fable]` set is accepted.
- new fixtures/rubrics load + parse; clearance rule unchanged; **`route-unchanged` stays green**; bundle isolation preserved (`eval/` not imported by the router's published entry or apps/web).
- `costMicroUsd` degrades gracefully on an unknown (Fable) model.

## Build → run → activation
1. Build the expansion (fixtures, rubrics, Fable matrix, 3-sample judge, splurge `reportOnly`, pricing). All mock-mode tests green.
2. Run the maximal eval for real (`vercel env pull` the prod `ANTHROPIC_API_KEY`, run, delete the dump).
3. Review the report; `--write` arms newly-cleared NON-splurge candidates.
4. PR (gated — changes routing) + auto-merge. New menus activate as volume accrues (`NIBBIN_REINFORCEMENT` already on).

## Verification
`tsc -p packages/router` → 0 · `vitest run packages/router` → green (incl. route-unchanged + new tests) · `eslint` clean · `npm run build -w @nibbin/web` → Compiled (eval not bundled).
