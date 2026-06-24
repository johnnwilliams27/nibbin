# Task 2 Report — flag_field_conflict + ensure_source_authority

**STATUS: DONE**
**Commit:** d4ebb988
**Tests:** 8/8 passed (flag-field-conflict.rpc.test.ts) — fresh flag inserts + notification; second call for same open key updates not duplicates; high stakes accepted; invalid stakes rejected; anon + authenticated callers denied; ensure_source_authority seeds 4 rows with correct weights and is idempotent.

**Concerns:**
- `insert_system_notification` uses `ON CONFLICT (account_id, kind, source_id) DO NOTHING` — the second `flag_field_conflict` call on the same flag id won't fire a second notification (silently skipped). This is intentional (idempotent) but means the updated detail won't be reflected in the notification body. Acceptable for v1 per plan design.
- The `flag_field_conflict` notification `source_id` column is the flag id (cast to text), matching the pattern used by `propose_memory_change`. The Task 3 resolve RPC needs to mark `read_at` on this notification using that same source_id pattern.
