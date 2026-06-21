-- Task 4: native-draft mirror — store Gmail draft id on the draft row
--
-- The `native_draft_ref` is persisted in `run_steps.payload->>'nativeDraftRef'`
-- (JSONB key, no schema change required — payload is already untyped JSONB).
-- This migration is intentionally a no-op schema change; it documents that
-- `run_steps.payload` is the canonical location for the draft ref for draft-level
-- steps (kind='draft'), not `side_effects` (which only tracks send-level
-- idempotency rows). The runner writes nativeDraftRef into the payload at draft
-- time; the dismiss path and send-with-ref path both read it back from there.
--
-- A commented-out `side_effects` column is preserved here to document why we
-- chose run_steps instead: side_effects rows are only created on execute
-- (send-level) actions, NOT on draft actions. A draft step at Draft action level
-- never creates a side_effects row, so native_draft_ref cannot be stored there.
-- The migration file is kept for audit completeness.

-- No DDL change: run_steps.payload (jsonb) already carries nativeDraftRef.
-- This comment is the complete change for this migration.
select 1; -- no-op, keeps migration in applied state
