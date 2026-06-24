# Task 7 Gate-Fix Report — Zip-bomb guard + Reaper terminal-fail

**Date:** 2026-06-23
**Branch:** feature/company-brain-docs-ingest
**Gate verdict addressed:** CHANGES-REQUIRED (2026-06-23-extraction-gaps-gate.md)

## Finding 1 — [CRITICAL] Zip-bomb DoS in Office parsing

**Change:** `apps/web/lib/brain/office-extract.ts`

- Added `makeBombSafeFilter(pathMatcher)` — a closure factory that wraps `unzipSync`'s `filter` option. The filter:
  - Accepts only entries matching the caller-supplied `pathMatcher` (slide*.xml for pptx; sharedStrings.xml + sheet*.xml for xlsx — media/binaries never selected).
  - Rejects any entry whose `originalSize` (declared uncompressed size, read from zip header BEFORE inflation) exceeds `ZIP_ENTRY_MAX_BYTES = 10 MB`. Throws immediately → no allocation.
  - Tracks cumulative `originalSize` across selected entries; throws if total exceeds `ZIP_TOTAL_MAX_BYTES = 50 MB`.
  - Throws if selected entry count exceeds `ZIP_MAX_ENTRY_COUNT = 512`.
  - All throws propagate through `extractPptxText`/`extractXlsxText` → caught by `extractDocument`'s outer try/catch → `extraction_state='failed'`, zero proposals (fail-closed preserved).
- `extractPptxText` now calls `unzipSync(buf, { filter: makeBombSafeFilter(slideRegex.test) })`.
- `extractXlsxText` now calls `unzipSync(buf, { filter: makeBombSafeFilter(xlsxPathMatcher) })`.
- Removed duplicate `sheetRegex` declaration from xlsx body (declared once above the unzip call).

**Covering tests:** `apps/web/lib/brain/office-extract.test.ts` — 6 new tests in 2 suites:
- `zip-bomb guard — extractPptxText`: per-entry cap throws; count cap throws; normal pptx still extracts.
- `zip-bomb guard — extractXlsxText`: per-entry cap throws; count cap throws; normal xlsx still extracts.
- All 26 tests PASS (20 original + 6 new).

## Finding 2 — [IMPORTANT] Reaper re-enqueue dead-end

**Change 1:** `supabase/migrations/20260623140000_extraction_reaper.sql`

- Replaced the two-branch (re-enqueue vs give-up) logic with a single terminal-fail path: any stale `status='processing'` job (started_at older than `p_stale_minutes`) is immediately set to `status='error'`, `error_message='extraction timed out'` AND `sources.extraction_state='failed'`.
- Removed `p_max_attempts` parameter from the function signature (was unreachable; now gone). Function is now `reap_stale_extractions(p_stale_minutes integer default 10)`.
- Updated grant/revoke to cover the new `(integer)` signature.
- Architecture rationale documented in comment: fire-and-forget, no re-driver, re-enqueue would strand sources forever.

**Change 2:** `apps/web/lib/brain/doc-extract.ts`

- Removed the racy read-then-write `attempts` increment from `updateJobStatus` (the two-query select+update block that required a mock chain and was flagged as a Minor race). The `attempts` column is retained as informational but no longer incremented by the worker.

**Change 3:** Cron route unchanged — `rpc('reap_stale_extractions', {})` still works (p_stale_minutes defaults to 10); only the removed p_max_attempts matters.

**Covering tests:** `tests/rls/extraction-reaper.rpc.test.ts` — updated 7 tests:
- Stale job with any attempts count → `error` + `extraction_state='failed'` (two tests covering low and high attempts).
- Fresh job untouched; done job untouched; count correct; anon/auth permission denied.
- (Note: test suite skips if no DB available — same as before.)

## Test Summary

```
npm run lint           → PASS (0 errors)
npm run typecheck      → PASS (2 pre-existing .next/types stale errors only)
office-extract suite   → 26/26 PASS (includes 6 new bomb-guard tests)
brain suite (full)     → 123/123 PASS
cron route suite       → 7/7 PASS
```

## Remaining Red
None. RLS reaper test requires a live DB (skipped in local/CI without one — same gating as before).

---

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
