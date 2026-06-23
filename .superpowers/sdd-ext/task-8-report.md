# Task 8 Report: propose_memory_change arg-name regression guard

**STATUS: PASS**

## Test summary
Created `apps/web/lib/brain/doc-extract.argnames.test.ts` with two tests:
- **A1 (text path)**: drives `extractDocument()` through a text-native PDF and asserts `propose_memory_change` receives exactly the sorted 7-key list `['p_account','p_field_key','p_op','p_origin','p_rationale','p_source_id','p_value']`.
- **A2 (vision path)**: drives `extractFromImage()` directly and asserts the same arg invariant on the rpc spy.

Both tests PASSED — the implementation from Tasks 5–6 uses the correct arg names. No production code changes needed.

## typecheck
`npm run typecheck` exits with 2 pre-existing Next.js `.next/types` route-level TS2344 errors (`makeCreateActiveConnection` / `runScheduleTick` not assignable to `never` in generated types). These are unrelated to Task 8 and were present before this task's file was created (git status confirms only `doc-extract.argnames.test.ts` is new).

## Concerns
- None. The guard is in place. P6 merge adds `p_stakes`; the comment in the test file notes exactly where to update the assertion list to 8 keys at that point.
