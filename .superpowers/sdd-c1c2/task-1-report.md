# Task 1 Report — source_authority table + seed + RLS

**STATUS:** DONE

## Files produced
- `supabase/migrations/20260624120000_collate_conflict_source_authority.sql` — creates `public.source_authority` with primary key `(account_id, source_kind)`, weight CHECK (0..100), source_kind CHECK (document/connector_artifact/observation/manual), RLS enabled, member-read policy, revoke writes from anon + authenticated. Tasks 2/3 RPCs will be appended here.
- `tests/rls/source-authority.schema.test.ts` — 8 tests: table exists, columns present, weight CHECK, source_kind CHECK, RLS enabled, member can read own rows, authenticated cannot insert directly, cross-account isolation.

## Test summary
8/8 passed. Existing company-brain-foundation tests (15/15) unaffected.

## Concerns
None. The `ensure_source_authority` seed helper (upsert 4 default rows) is specified for Task 2 per the plan — it is deliberately omitted here.
