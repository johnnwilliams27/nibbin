# Task 3 Report: RPC `delete_custom_section`

## Status: COMPLETE

## Files changed
- `supabase/migrations/20260623130000_memory_extensible_and_sources_library.sql` — appended `delete_custom_section` function + grant/revoke
- `tests/rls/section-meta-delete.rpc.test.ts` — new test file (5 tests)

## Test summary
5/5 passed:
- (a) member deletes custom section: `field_meta` row gone + `sections` key removed from `grove_memory`
- (b) default key (`voice`, `pricing`) raises `not a custom section`
- (c) non-member rejected (`not a member`)
- (d) `grove_memory.version` bumped + `grove_memory_history` row appended with `change_source='manual'`
- (b2) bare key without `c_` prefix also rejected

## Implementation notes
- SQL appended to the existing Task 1/2 migration file as specified
- Guard: `p_field_key !~ '^c_[a-z0-9_]{1,40}$'` → raises `not a custom section`
- Advisory lock: `pg_advisory_xact_lock(hashtext('grove_memory:'||target_account::text))`
- Deletes `field_meta` row, removes key from `sections` JSONB, bumps `version`, appends history
- Grants: `authenticated` only; revoked from `public`, `anon`, `service_role`

## Concerns
None — all four plan requirements satisfied and tested.
