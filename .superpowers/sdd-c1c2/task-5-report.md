# Task 5 Report — Collate Pass Logic

**Status:** PASS

## Files Created
- `apps/web/lib/brain/collate.ts` — `collateAccount(svc, accountId): Promise<CollateResult>`
- `apps/web/lib/brain/collate.test.ts` — 16 tests, all passing

## Implementation Summary

`collateAccount` runs 6 fail-safe steps for a single account:
1. `ensure_source_authority` RPC (exact arg: `p_account`) + load authority rows
2. Load `proposals` (pending+approved as filter in tests) and `grove_memory` via thenable chain
3. Build `FieldInput[]` from proposals grouped by field_key; run `detectFieldConflicts`; call `flag_field_conflict` per conflict (exact args: `p_account`, `p_field_key`, `p_competing_source_ids`, `p_detail`, `p_stakes`)
4. Dedup pending proposals by (field_key, normalized value); keep earliest, set duplicates to `status='superseded'` (not 'dismissed' — the proposals CHECK constraint only allows pending/approved/rejected/superseded)
5. Count `field_meta` rows where `last_reviewed_at < now()-60d` or null
6. Emit ONE `insert_system_notification` (exact 7 args: `p_account`, `p_kind`, `p_source_id`, `p_title`, `p_body`, `p_payload`, `p_stakes`) with stable per-day source_id `collate:YYYY-MM-DD` when any count > 0

## Test Coverage (16 tests)
- Empty account → all-zero result, no flag/brief RPC
- Two materially-different sources → `flag_field_conflict` called with exact arg names + `stakes='high'` for pricing
- Identical sources → no flag
- Duplicate pending proposals (3→1) → 2 superseded, correct update ids
- Different values → no dedup
- Mixed status (approved+pending) → only pending deduped
- Stale fields (>60d, null) counted, fresh (<60d) not counted
- Brief emitted with correct counts + exact 7 arg-key shape
- Brief NOT emitted when all zero
- Stable per-day source_id matches today
- Brief payload contains `deduped` count
- `flag_field_conflict` error → stale still counted (fail-safe)
- `ensure_source_authority` error → does not abort
- Arg-name regression guards for both `insert_system_notification` and `ensure_source_authority`

## Concerns
- `proposals` status uses `'superseded'` (not `'dismissed'`) — the DB CHECK constraint on `proposals.status` is `('pending','approved','rejected','superseded')`. The task prompt says `dismissed` but that value would fail the DB constraint. `superseded` is semantically correct for redundant/duplicate proposals.
- `svc` parameter typed as `any` — the Supabase service client type is not easily importable without pulling in `server-only` infrastructure that complicates testing. Matches the pattern in `propose-from-capture.ts` where callers pass `svc as never`.
- No live DB test — mock-only per spec.
