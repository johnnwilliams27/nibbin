# Task 7: Full-Suite Green Report

**Date:** 2026-06-23  
**Branch:** feature/company-brain-docs-ingest  
**Wave:** 2 (Tasks 1-6: pptx/xlsx/svg extractors, append-only proposals, reaper, live-vision smoke)

## Commands Run

```
npm run lint
npm run typecheck
npx vitest run packages/router apps/web/lib/brain apps/web/app/api/cron tests/rls/extraction-reaper.rpc.test.ts
```

## Results

### lint
**PASS** — zero errors after fix (1 error fixed: unused `vi` import in `office-extract.test.ts`).

### typecheck
**PASS (with 2 known pre-existing errors)**

Known pre-existing errors confirmed via `git diff origin/main...HEAD`:
- `apps/web/.next/types/app/api/connect/google/callback/route.ts` — TS2344 stale `.next/types` — **zero diff** (file not touched by this branch)
- `apps/web/.next/types/app/api/cron/nibbin-schedule/route.ts` — TS2344 stale `.next/types` — **zero diff** (file not touched by this branch)

### Test Suites
| Suite | Files | Tests |
|-------|-------|-------|
| packages/router | 6 passed | 142 passed |
| apps/web/lib/brain | 5 passed | 117 passed |
| apps/web/app/api/cron | 5 passed | 53 passed |
| tests/rls/extraction-reaper.rpc.test.ts | 1 passed | 7 passed |
| **TOTAL** | **17 passed** | **319 passed** |

## Fix Applied

**Root cause:** Task 5 added an attempts-increment path inside `updateJobStatus` in `doc-extract.ts` that calls:
```
svc.from('source_extraction_jobs').select('attempts').eq().eq().limit(1).single()
```
The Supabase mocks in all three brain test files only had `update(...)` on the `source_extraction_jobs` table mock — no `select` method.

**Fix (minimal):** Added `select()` chain to the `source_extraction_jobs` mock in all three test files, plus `mockJobsSelect.mockResolvedValue({ data: { attempts: 0 }, error: null })` in each `beforeEach`. The fix is in test files only (no production code change).

**Files touched in fix:**
- `apps/web/lib/brain/office-extract.test.ts` — remove unused `vi` import
- `apps/web/lib/brain/doc-extract.test.ts` — add `select` chain to jobs mock + `mockJobsSelect` defaults
- `apps/web/lib/brain/doc-extract.argnames.test.ts` — same
- `apps/web/lib/brain/vision-extract.test.ts` — same

## Invariant Confirmations

| Check | Result |
|-------|--------|
| fflate in `apps/web/package.json` deps | CONFIRMED (`"fflate": "^0.8.3"` at line 32) |
| Reaper migration idempotent | CONFIRMED (`add column if not exists` for both columns; `create or replace function`) |
| All extraction proposals append-only | CONFIRMED (`p_op = 'append'` in doc-extract.ts and vision-extract.ts; no `'replace'` in production code) |
| Router back-compat | CONFIRMED (142/142 router tests pass) |
| No unsafe-formatstring (`console.error/warn(\`…\`, y)`) | CONFIRMED (grepped all touched files: doc-extract.ts, office-extract.ts, vision-extract.ts, reaper route, live-vision-smoke.ts — zero template-literal-with-second-arg matches) |
| Pre-existing `.next/types` errors | CONFIRMED pre-existing via empty `git diff origin/main...HEAD` for both files |

## Remaining Red
None. All items confirmed pre-existing or fixed.
