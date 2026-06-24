# Task 3 Report — `resolve_field_flag` RPC

**Status:** COMPLETE

## What was implemented

Appended `resolve_field_flag(p_flag_id uuid, p_chosen_source_id uuid, p_chosen_value text) returns void` to `supabase/migrations/20260624120000_collate_conflict_source_authority.sql`.

The RPC (security definer, search_path='', authenticated only):
1. Locks the flag row `for update`; raises if not found.
2. Verifies `auth.uid()` is not null and `private.is_account_member(v_flag.account_id)`; raises `'conflict already resolved'` if flag is not `needs_review`.
3. Takes `pg_advisory_xact_lock(hashtext('grove_memory:'||account_id))`.
4. Writes `p_chosen_value` using the same dispatch as `decide_memory_proposal`'s approve branch: `notes` → `grove_memory.notes`; `hard_rules` → `grove_memory.hard_rules` (jsonb array); else → `sections[field_key]`. Includes append-overflow guard (6000 chars), version bump, `grove_memory_history` insert with `change_source='conflict'`, `field_meta` upsert, and `field_evidence` insert (on conflict do nothing).
5. Updates `field_flags.status='resolved'`, `resolved_at=now()`, `resolution=chosen_source_id::text`.
6. Inserts `audit_log` row with `action='memory.ratified'`, `meta` containing `field_flag_id`, `chosen_source_id`, `decision='conflict_resolved'`.
7. Calls `ensure_source_authority(account_id)` then bumps chosen source's kind weight by +5 (capped 100); loops over competing_source_ids, skips chosen source and de-dupes by kind, lowers each other kind by -5 (floored 0).
8. Marks the related `review_item` notification `read_at=now()`.

Grants: `revoke from public, anon, service_role`; `grant execute to authenticated`.

## Test file

`tests/rls/resolve-field-flag.rpc.test.ts` — 13 tests, all pass.

## Test summary

- 13 tests pass, 0 fail — full TDD cycle (FAIL→PASS).
- Covers: sections/notes/hard_rules dispatch; version bump; history change_source='conflict'; flag→resolved; audit_log; chosen kind +5 cap; competing kind -5 floor; non-member rejected; already-resolved rejected; weight boundary (cap=100, floor=0).
- Sibling suite (3 files, 29 tests total) all green.
- `npm run typecheck` exits 0.

## Concerns

None. All guards match the plan spec exactly.
