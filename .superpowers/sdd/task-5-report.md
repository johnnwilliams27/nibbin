# P5 Task 5 — SynthesisCard type + knowledge_lookup classifier signal

**Date:** 2026-06-23
**Branch:** `feature/company-brain-synthesis` (worktree `C:\nib-p5`)
**Status:** COMPLETE — all tests green (21 classifier + 13 types = 34 new tests; 2243 total)

---

## What was built

### 5a — SynthesisCard + Citation types (`packages/keeper/src/types.ts`)

Added two new exported types after `ChartCard`:

- **`Citation`** — one cited source row: `label`, `kind` ('memory'|'source'), optional `sourceId`, `excerpt` (≤200 chars verbatim), `score` (0..1 normalised hybrid score).
- **`SynthesisCard extends CardBase`** — the new card kind: `kind: 'synthesis'`, `summary` (compact bubble text, ≤300 chars), `fullAnswer` (full cited prose for modal), `citations: Citation[]`, `gapNote: string | null`, `corpusCounts: { memory: number; sources: number }`, and the required `transcript` field from `CardBase` (a11y parity §4.2).

`SynthesisCard` was added to the `KeeperCard` union as the ninth member.

Both types are re-exported from `packages/keeper/src/index.ts`.

### 5b — `knowledge_lookup` signal (`packages/router/src/classifier.ts`)

Added a regex check **before** the final tier-assignment block in `classifyComplexity`. The signal fires on retrieval-shaped question markers:

```ts
const KNOWLEDGE_LOOKUP =
  /\b(what do I charge|my (policy|rate|policies|rates|pricing)|do I have|what('?s| is) in my (notes|memory|files)|what('?ve| have) I|tell me (about|what)|what do (you|I) know about)\b/i;
if (KNOWLEDGE_LOOKUP.test(trimmed)) {
  signals.push('knowledge_lookup');
}
```

Key design decisions (per spec §9, option B):
- **No score contribution** — a short lookup stays T0; the synthesis engine does the work, not the LLM tier.
- **No extra model call** — purely regex, zero tokens.
- **Fires before tier assignment** — so `signals` always carries `'knowledge_lookup'` on the returned `Classification`, regardless of the final tier. The T7 `keeperChatAction` reads `reply.decision.classification?.signals` to gate the synthesis path.

### Tests

**`packages/router/test/classifier-knowledge-lookup.test.ts`** (21 tests):
- 13 positive cases: all known knowledge-lookup phrasings emit the signal.
- 4 negative cases: smalltalk, drafting, planning, and empty strings do NOT emit it.
- 1 co-existence case: signal co-exists alongside `'drafting'` on the same classification.
- 2 invariant cases: tier stays T0; signal is an array member.

**`packages/keeper/test/synthesis-types.test.ts`** (13 tests):
- Union widening: `SynthesisCard` accepts as `KeeperCard`.
- Shape: all modal-needed fields present and typed correctly.
- `Citation` shape: source + memory variants; score 0..1; optional sourceId.
- a11y: `transcript` field required by `CardBase` is present.
- Index re-export: package module loads without error.

---

## Constraints verified

| Constraint | Status |
|---|---|
| No new model call for classification | ✅ Pure regex in the existing `classifyComplexity` function |
| `SynthesisCard` slots into existing `KeeperCard` union | ✅ Added as 9th union member |
| `Citation` carries all modal fields (§5.4) | ✅ label, kind, sourceId?, excerpt, score |
| `transcript` a11y field on SynthesisCard | ✅ Inherited from `CardBase` |
| Engine (T6) not built | ✅ Not touched |
| Keeper wiring / modal (T7-T8) not built | ✅ Not touched |

---

## Files changed

| File | Change |
|---|---|
| `packages/keeper/src/types.ts` | Added `Citation` + `SynthesisCard` interfaces; `SynthesisCard` added to `KeeperCard` union |
| `packages/keeper/src/index.ts` | Re-exported `Citation` and `SynthesisCard` |
| `packages/router/src/classifier.ts` | Added `KNOWLEDGE_LOOKUP` regex + signal push before tier assignment |
| `packages/keeper/test/synthesis-types.test.ts` | NEW — 13 compile-time + structural tests for the types |
| `packages/router/test/classifier-knowledge-lookup.test.ts` | NEW — 21 unit tests for the classifier signal |

---

## Test results

```
npx vitest run packages/router/test/classifier-knowledge-lookup.test.ts
  → 21 passed
npx vitest run packages/keeper/test/synthesis-types.test.ts
  → 13 passed
npm run typecheck
  → clean (all packages + apps)
npm run test
  → 2243 passed | 6 skipped (218 test files)
```

Pre-existing lint issue: `tests/rls/company-brain-foundation.test.ts` has 3 unused-variable errors committed before T5. T5 files are lint-clean (`eslint` on the 5 changed files returns 0 errors).

---

## Concern / flag for T7

The `knowledge_lookup` regex covers the spec's example phrasings well but is keyword-based. Short paraphrases like "how much do I charge?" or "tell me my rates" will **not** match. The spec acknowledges this (§risks: "KNOWLEDGE_LOOKUP regex misses paraphrases — acceptable at P5 launch, revisited with real usage data"). No action needed now; flag for post-launch iteration.
