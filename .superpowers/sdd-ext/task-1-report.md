# Task 1 Report — Migration: extend `field_meta` and `sources`

## What Was Changed

### Files Created

1. **`supabase/migrations/20260623130000_memory_extensible_and_sources_library.sql`**
   - Adds `label text`, `sort_order integer not null default 1000`, `is_custom boolean not null default false`, `is_hidden boolean not null default false` to `public.field_meta`
   - Adds `mime_type text`, `byte_size bigint`, `extraction_state text not null default 'pending'` (with CHECK on 5 allowed values) to `public.sources`
   - Creates `sources_account_state_idx` index on `(account_id, extraction_state)`
   - Migration SQL matches the plan's DDL verbatim

2. **`tests/rls/memory-extensible.schema.test.ts`**
   - 4 tests using the project's real harness pattern (`new RlsHarness()` + `beforeAll(h.reset())` + `afterAll(h.close())`)
   - Tests: field_meta has new columns, sources has new columns, extraction_state CHECK exists with all 5 values, index exists
   - Note: The plan's test shape used `RlsHarness.boot()` (static factory) which doesn't exist — the real API is `new RlsHarness()` + `reset()`. The test was written to match the actual harness. Also `h.sql()` returns `pg.QueryResult` not an array, so `.rows` is required on all results.

## Migration Filename

`20260623130000_memory_extensible_and_sources_library.sql`

No timestamp collision — last existing migration was `20260623120000`, so `20260623130000` was free as the plan anticipated.

## Test Command and Output

```
cd C:\nib-p1 && npx vitest run tests/rls/memory-extensible.schema.test.ts
```

**Pre-migration (FAIL):**
```
Test Files  1 failed (1)
      Tests  4 failed (4)
   Duration  1.67s
```

**Post-migration (PASS):**
```
Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  1.56s
```

**Existing foundation tests still green:**
```
npx vitest run tests/rls/company-brain-foundation.test.ts
Test Files  1 passed (1)
      Tests  15 passed (15)
   Duration  4.84s
```

## Deviations from the Plan

1. **Harness API**: Plan showed `RlsHarness.boot()` — real API is `new RlsHarness()` + `h.reset()`. Corrected.
2. **`h.sql()` return type**: Plan showed `cols.map(...)` directly on the result — actual return is `pg.QueryResult`, requiring `.rows` access. Corrected.
3. **extraction_state CHECK test**: Simplified from inserting a real row (which required account seeding via `create_account_with_owner` as an authenticated user) to querying `information_schema.check_constraints` directly. This is simpler and more reliable for a schema-only test.
4. **DDL**: Migration SQL matches the plan exactly — no deviations.
