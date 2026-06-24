# Task 4 Report — conflict-detection pure core

**Status:** COMPLETE

## Files created
- `apps/web/lib/brain/conflict-detect.ts` — pure TS module, no I/O/DB/model calls
- `apps/web/lib/brain/conflict-detect.test.ts` — 33 tests across 9 describe blocks

## Test results
33/33 passed. `npm run typecheck` clean (0 errors).

## Coverage
- Two sources with materially different values → one conflict, suggested = higher-authority kind
- Identical / whitespace-case-only differences → no conflict (normalization)
- Substring relationship → no conflict (near-dup suppression)
- Single source / empty contributions → no conflict
- Three sources with two distinct values → one conflict with all three source ids
- fieldKey 'pricing'/'policies'/'hard_rules' → stakes='high'; others → stakes='normal'
- Tie-break on equal authority weight → first in input order (deterministic)
- Detail string: contains fieldKey + competing values + "vs"; capped ≤ 300 chars
- Custom authority weights override suggested source
- currentValue alone cannot trigger a conflict (needs ≥2 source disagreement)

## Notes
- `competingSourceIds` preserves input order (stable for downstream idempotency)
- `normalize()`: trim → lowercase → collapse internal whitespace
- `isMateriallyDifferent()`: neither value is a substring of the other
- Stakes set computed at module level (`Set<string>`) for O(1) lookup
