# Task 0 Report — stakes column + RPC extension

**Branch:** `feature/company-brain-attention-queue`
**Date:** 2026-06-23
**Status:** COMPLETE — all tests green, committed.

---

## What was built

### Migration: `supabase/migrations/20260623100000_attention_queue_stakes.sql`

Three operations:

**0a — `notifications.stakes` column**
```sql
alter table public.notifications
  add column stakes text not null default 'normal'
  check (stakes in ('normal', 'high'));
```
All existing rows receive `stakes = 'normal'` via DEFAULT. No backfill needed.

**0b — `insert_system_notification` (6-arg → 7-arg)**
- Dropped the old 6-arg overload explicitly (PostgreSQL identifies functions by name + arg list, so the 7-arg is a different overload, not a replacement).
- Created 7-arg `create or replace function` with `p_stakes text default 'normal'` appended.
- Body validates stakes in `('normal','high')`, raises on invalid values, passes `stakes` into the INSERT.
- Grants: `service_role` only (matching Foundation).

**0c — `propose_memory_change` (7-arg → 8-arg)**
- Dropped the 7-arg Foundation version (which used plain `create function`, not `create or replace`, so explicit drop was required).
- Created 8-arg `create or replace function` with `p_stakes text default 'normal'` appended after `p_origin`.
- Forwarded `p_stakes` to `insert_system_notification(...)` call.
- Preserved ALL existing behavior: quarantine guard, proposal INSERT, notification call, return value.
- Grants: `service_role` only (matching Foundation). Revoke from `public, anon, authenticated`.

---

## TDD result

Test file: `tests/rls/attention-queue-stakes.test.ts`

| Test | Pre-migration | Post-migration |
|------|--------------|----------------|
| 1a: `insert_system_notification` no `p_stakes` → stakes='normal' | FAIL (column missing) | PASS |
| 1b: `insert_system_notification` `p_stakes='high'` → stakes='high' | FAIL (7-arg fn missing) | PASS |
| 1c: invalid stakes value raises | FAIL (fn missing) | PASS |
| 1d: `propose_memory_change` `p_stakes='high'` propagates | FAIL (8-arg fn missing) | PASS |
| 1e: `propose_memory_change` without `p_stakes` (7-arg, backward-compat) → stakes='normal' | FAIL (8-arg fn missing) | PASS |
| 1f: authenticated client cannot insert `notifications` directly | FAIL (suite setup error) | PASS |

**Total: 6/6 passing**

Regression suites run after migration:
- `company-brain-foundation.test.ts`: 15/15 passing
- `system-notification.test.ts`: 3/3 passing

---

## Key decisions

1. **`drop function` before create**: PostgreSQL function identity includes argument list. The Foundation's 6-arg `insert_system_notification` and 7-arg `propose_memory_change` are distinct overloads from the new 7-arg and 8-arg versions. Explicit `drop function if exists` was required to retire the old signatures cleanly.

2. **Kept `returns void` on `insert_system_notification`**: The plan notation `returns uuid ...` was illustrative. Changing return type from `void` to `uuid` via `create or replace` would require a DROP first. Since no callers (including the new `propose_memory_change`) inspect the return value, `void` was retained to minimize diff.

3. **`p_stakes` DEFAULT on both functions**: Satisfies the critical constraint — existing callers (doc-ingestion, capture, existing Foundation tests) call `propose_memory_change` with 7 positional args and are unaffected. PostgREST named-arg resolution also works correctly.

4. **Stakes validation in function body**: Added explicit `raise exception` for invalid stakes values (in addition to relying on the column CHECK constraint) to produce a clear error message rather than a generic constraint violation.

---

## Concerns / notes for reviewer

- None critical. The P2 sibling chunk that adds non-empty/append-overflow guard to `propose_memory_change` will need to reconcile against the 8-arg signature when it merges — the plan notes this is handled at merge time.
- The `on conflict (account_id, kind, source_id) do nothing` dedup invariant is preserved: stakes are set on first emission and not re-escalated (per plan).
