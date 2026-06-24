# Task 5: Stuck-Extraction Reaper — Implementation Report

## Status: COMPLETE

## Files Changed

### New
- `supabase/migrations/20260623140000_extraction_reaper.sql` — adds `extraction_state` to `sources`, `attempts` to `source_extraction_jobs`, and the `reap_stale_extractions` security-definer RPC (service_role only)
- `apps/web/app/api/cron/source-extraction-reaper/route.ts` — cron GET route mirroring plan-run-reaper exactly
- `apps/web/app/api/cron/source-extraction-reaper/route.test.ts` — 7 route unit tests (mocked)
- `tests/rls/extraction-reaper.rpc.test.ts` — 7 RLS/DB integration tests

### Modified
- `apps/web/lib/brain/doc-extract.ts` — `updateJobStatus()` now sets `attempts = attempts + 1` (via read-then-write, safe because service_role is the only writer) when transitioning to `processing`
- `apps/web/vercel.json` — added `source-extraction-reaper` cron on `*/15 * * * *` (same schedule as `plan-run-reaper`)

## Cron Registration
Found `apps/web/vercel.json` — registered entry added:
```json
{ "path": "/api/cron/source-extraction-reaper", "schedule": "*/15 * * * *" }
```
No OPS note needed — registration is complete.

## Schema Note
`extraction_state` was not present in any prior migration despite being used throughout `doc-extract.ts`. This migration adds it (not just `attempts`) so the full extraction pipeline works correctly.

## Test Results
- Route tests: 7/7 passed
- RLS tests: 7/7 passed (DB available at postgres://localhost:54329)
- P2 regression: 26/26 still passing
- `npm run typecheck`: only the 2 known stale `.next/types` errors (no new errors)

## Grant Posture
Mirrors `reap_stale_plan_runs`: `revoke from public, anon, authenticated; grant to service_role`.
