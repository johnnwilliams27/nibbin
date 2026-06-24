# Adversarial gate — feat/c2-llm-contradiction-stakes (2026-06-24)

- **Branch / PR:** `feat/c2-llm-contradiction-stakes` → `main` (#261)
- **Reviewed diff:** `git diff main..feat/c2-llm-contradiction-stakes`
- **Gate run by:** Claude (Opus 4.8) on 2026-06-24, four parallel adversarial subagents

## Scope

C2 follow-up: (1) LLM-judged semantic contradiction layered on the heuristic
prefilter; (2) real weighted stakes-scoring replacing the hardcoded `stakes='high'`.

New/changed:
- `apps/web/lib/brain/conflict-judge.ts` (NEW) — LLM judge, injected deps, fail-open.
- `apps/web/lib/brain/stakes-score.ts` (NEW) — pure weighted stakes scorer.
- `apps/web/lib/brain/conflict-detect.ts` — uses `scoreStakes`; exposes `distinctValues`.
- `apps/web/lib/brain/collate.ts` — wires the judge into step 3 (fail-open, high-stakes
  advisory-only, per-run cap), persists judge verdict/reason.
- `packages/router/src/{types,tiers}.ts` — adds `contradiction_judge` (T1) task.
- `supabase/migrations/20260624140000_contradiction_judge_audit.sql` (NEW, NOT applied).

## CI step
- typecheck: ☑  tests: ☑ (3593+ pass; +4 new)  lint: ☑  audit: n/a  SAST: n/a  redaction corpus: ☑ (in suite)  trigger-graph: n/a

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 1 | 2 |
| claims-auditor | PASS | 0 | 0 | 1 | 3 |
| logic-skeptic | PASS (after fix) | 0 | 1 | 1 | 1 |
| cost-auditor | PASS | 0 | 0 | 0 | 2 |

## Findings (severity-ranked)

- **P1 (logic-skeptic) — judge fed wrong value set.** The judge received a value
  set re-derived from all of `fieldMap`, not the heuristic's competing distinct
  set, so it could mark a real A/C contradiction "compatible" off values the
  heuristic never compared (and only suppression is destructive).
  *Fix (applied):* `detectFieldConflicts` now returns `distinctValues` — the exact
  trimmed originals for the distinct competing normalized set — and `collate.ts`
  passes `conflict.distinctValues` to the judge. Regression test added
  (`conflict-detect.test.ts` distinctValues case). **RESOLVED.**

- **P2-1 (red-team) / P2 (logic-skeptic) — judge could suppress a high-stakes
  conflict.** A single confident-wrong T1 `compatible` on pricing/policy/
  hard_rule would silently delete it from the review queue (and re-judge
  identically each run = persistent suppression).
  *Fix (applied):* `shouldSuppress(outcome, stakes)` — high-stakes conflicts are
  ADVISORY ONLY (always flagged; verdict recorded for context). Only confident-
  compatible NORMAL-stakes candidates are suppressed. Unit tests added.
  **RESOLVED.**

- **P3 (cost-auditor) — unbounded per-run judge fan-out.** Custom fields are
  owner-extensible with no per-account cap. *Fix (applied):*
  `MAX_JUDGE_CALLS_PER_RUN = 25` — beyond it, candidates are flagged without
  judging (fail-open, caps spend only). **RESOLVED.**

- **P3 (logic-skeptic) — `VALUE_CAP` truncated at 1000 < 6000 column limit;**
  values diverging only after char 1000 looked identical. *Fix (applied):*
  raised `VALUE_CAP` to 6000 (the field column limit). **RESOLVED.**

- **P3 (red-team) — no cap on number of values in prompt.** *Fix (applied):*
  `MAX_VALUES = 8` slice in `buildUserMessage`. Test added. **RESOLVED.**

- **P3 (claims-auditor) — weak authority test** (asserted `>=` monotonicity only).
  *Fix (applied):* tightened to assert the high-auth case crosses to `high` and
  low-auth stays `normal`. **RESOLVED.**

- **P2 (claims-auditor) — error path records `deps.model`, ok path `result.model`.**
  Harmless (error rows carry the routed id); no fix needed. Tracked, non-blocking.

- **P3 (claims-auditor) — derived-not-raw is upstream-enforced**, not enforced in
  this module. Accurate today for all proposal writers (doc_extract, capture both
  redaction-gate before proposing). Documented as an upstream invariant in the
  module header. Non-blocking.

- **P3 (cost-auditor) — re-judges standing open conflicts each nightly run.**
  Bounded by the small standing-conflict count (<$0.05/user/month worst case).
  Deferred as an optional future optimization (skip re-judge when an open flag
  already carries a verdict for the same value set). Non-blocking.

## Cost projection (cost-auditor)
~<$0.0005/judge call (Haiku, cached system prefix, maxTokens 200). Typical user
0–3 standing conflicts → <$0.05/user/month even re-judged nightly. Does not move
the COGS needle. T1, never frontier budget, ledgered + usage-charged.

## Disposition
- Blocking (P0/P1) resolved: ☑ (the single P1 + both P2-1/P2 crux fixes applied)
- Non-blocking tracked: ☑ (model-id record cosmetic; re-judge optimization)
- **Gate verdict:** PASS
- **Signed:** Claude (Opus 4.8), pending John's review, 2026-06-24
