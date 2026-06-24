# C2 follow-up — LLM-judged semantic contradiction + real stakes-scoring

**Date:** 2026-06-24
**Status:** design → implemented on `feat/c2-llm-contradiction-stakes`
**Builds on:** C1 collate pass (`collate.ts`), C2 heuristic conflict detection
(`conflict-detect.ts`, PR #253, migration `20260624120000`), P6 attention queue.

## Problem

C2 shipped HEURISTIC-only. Two documented gaps:

1. **False-positive conflicts.** The heuristic flags a field as conflicting when
   ≥2 sources have *normalized*, non-substring values. But "Net 30" vs "net-30
   days" are not contradictory, and two distinct phrasings of the same policy
   are noise. Conversely a tiny string delta can be a real reversal ("deposit
   refundable" vs "deposit non-refundable"). String distance is the wrong
   oracle for *semantic* contradiction.
2. **Hardcoded stakes.** `conflict-detect.ts` sets `stakes='high'` iff the
   field key is in a 3-element set; everything else is `'normal'`. The P6
   attention queue trusts that flag verbatim. There is no scoring from the real
   signals of how much a given conflict actually matters.

## Design

Two pure modules + one LLM judging pass, layered so the cheap deterministic
path is unchanged and the expensive path only runs on real candidates.

### 1. LLM-judged semantic contradiction (`conflict-judge.ts`)

- The heuristic in `conflict-detect.ts` stays the **prefilter**: it produces
  candidate `FieldConflict`s exactly as today (cheap, deterministic, no model).
- A new `judgeContradiction()` takes one candidate's `fieldKey` + the distinct
  competing values and asks the router-selected model a single yes/no question:
  *are these values genuinely contradictory, or just different phrasings /
  elaborations of a compatible fact?* It returns
  `{ verdict: 'contradiction' | 'compatible' | 'uncertain', reason }`.
- **Layered, not replacing.** Only candidates the heuristic already flagged are
  judged — the LLM can only *suppress* a candidate (compatible) or *confirm*
  it, never invent one. This bounds cost (model runs ≤ once per heuristic
  candidate per collate run) and keeps the fail-safe: on model error / no key /
  `uncertain`, we **fall back to flagging** (fail-open toward surfacing — a
  missed real contradiction is worse than one extra review item).
- **Router tier.** New routed task `contradiction_judge` at **T1** (Haiku-class,
  candidate-armed for Sonnet later via the existing eval-gated mechanism). This
  is a frequent background classification over short text — exactly the T1
  profile, and never the frontier budget. No provider is hardcoded; the model
  id comes from `groveRouter.route()` and the call goes through
  `anthropicGenerate()` / `recordModelCall()` like every other brain LLM call.
- **Derived-not-raw + RLS-safe.** The only text sent to the model is the field
  values that are ALREADY curated/proposed memory (they passed the P2 redaction
  gate before they became proposals). We send no raw source bytes, no PII
  beyond what is already in the derived field. The judge runs inside
  `collateAccount`, which is service-role and per-account scoped; values for one
  account never mix with another. The prompt frames values as DATA, never
  instructions (prompt-injection discipline, mirrors `doc-extract.ts`).

### 2. Real stakes-scoring (`stakes-score.ts`)

Pure function `scoreStakes(signals): 'normal' | 'high'`. Signals:

- **Field criticality** — pricing / policies / hard_rules are inherently
  high-consequence (the old hardcoded set becomes the strongest single signal,
  not the only one).
- **Competing-source count** — more independent sources disagreeing = more real.
- **Authority spread** — when the *highest-authority* source is itself in
  conflict (e.g. a document contradicts another document), it matters more than
  a low-trust observation disagreeing with a doc.
- **Divergence magnitude** — heuristic proxy: number of distinct normalized
  values among the competitors (a 3-way split is higher-stakes than a 2-way).

The function sums weighted signals into a score and thresholds to the existing
two-level output the attention queue + `flag_field_conflict` RPC expect
(`'normal' | 'high'`). We deliberately keep the **output domain unchanged**
(two levels) — the notifications CHECK and the P6 queue already only know
normal/high, so widening it would be a cross-cutting migration. Scoring is the
internal upgrade; the contract is stable.

`conflict-detect.ts` is refactored to call `scoreStakes` instead of the
hardcoded set, so the heuristic-only path also benefits and the behavior is
centralized. The old `HIGH_STAKES_FIELDS` set becomes one input to the score.

## Wiring

`collate.ts` step 3 becomes: detect (heuristic) → for each candidate, judge
(LLM, fail-open) → if confirmed, recompute stakes via `scoreStakes` (already
embedded in the conflict) → `flag_field_conflict`. The judge is gated behind a
model being available; with no `ANTHROPIC_API_KEY` the pass behaves exactly as
today (flag all heuristic candidates) — graceful degradation, identical to
`doc-extract.ts`.

## Migration

`20260624140000_contradiction_judge_audit.sql` (idempotent, NOT applied to any
remote DB — applied at merge). Adds an optional `judge_verdict text` +
`judge_reason text` column to `field_flags` so the Memory UI can show *why* the
system thinks two values conflict, and so a suppressed-as-compatible decision is
auditable. Columns are nullable and additive; existing rows unaffected. No RLS
change (field_flags already member-read). `flag_field_conflict` gains two
optional trailing params (`p_judge_verdict`, `p_judge_reason`, default null) —
the established additive-overload pattern (drop old signature, recreate).

## Non-goals / deferred

- Three-level stakes (low/normal/high) — would require a notifications CHECK
  migration + P6 queue changes; out of scope, output stays two-level.
- Batching multiple candidates into one model call — current volume (few
  conflicts/account/run) does not justify the prompt-engineering risk; one call
  per candidate is simpler and bounded.
- Learning the stakes weights — kept as fixed, documented constants (mirrors the
  deterministic, non-ML reinforcement stance in the router).
