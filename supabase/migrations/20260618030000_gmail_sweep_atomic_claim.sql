-- #112: make the one-time onboarding sweep idempotency guard atomic (TOCTOU).
--
-- Before: apps/web/app/api/sweep/gmail/onboarding/route.ts SELECTed gmail_sweep_log
-- for a prior complete/partial row, then ran the ~90-day inbox sweep and only
-- THEN wrote its row. Two concurrent dispatches (or replays of the static
-- per-(account,connection) HMAC) both pass the SELECT before either writes →
-- both run the full sweep and double-spend model budget. No DB-layer
-- serialization.
--
-- After: claim-before-work. A 'running' sentinel row, guarded by a partial
-- unique index on (connection_id), is inserted atomically; only the dispatch
-- that wins the insert runs the sweep, then UPDATEs the row to its final status.
-- A 'failed' row is NOT covered by the index, so a genuine retry can re-claim.

-- 1. Allow the 'running' sentinel status (constraint name verified against the DB).
--    IF EXISTS keeps the migration replay-safe on a fresh bootstrap whose base
--    migration might name the auto-generated CHECK differently.
alter table public.gmail_sweep_log drop constraint if exists gmail_sweep_log_status_check;
alter table public.gmail_sweep_log
  add constraint gmail_sweep_log_status_check
  check (status in ('running', 'complete', 'partial', 'failed'));

-- 2. At most one live claim per connection. Multiple 'failed' rows are allowed
--    (retries), so the uniqueness is partial over the live statuses only.
create unique index gmail_sweep_log_connection_active_idx
  on public.gmail_sweep_log (connection_id)
  where status in ('running', 'complete', 'partial');

-- 3. Atomic claim. Returns the new/reclaimed row id when the caller wins; NULL
--    when a live row already exists (caller skips → 'already_swept').
--
--    Deviation from "on conflict do nothing": a 'running' row left behind by a
--    crashed invocation (the sweep's hard ceiling is 60s) would otherwise sit in
--    the partial index forever and permanently block that connection's sweep. So
--    a 'running' row older than 15 min is reclaimed (well past any legitimate
--    in-flight sweep). complete/partial rows, and fresh 'running' rows, fall
--    through the DO UPDATE's WHERE → no row updated → RETURNING is empty → NULL.
--
--    SECURITY: service-role only (the table revokes authenticated/anon; this
--    function is security invoker and runs with the service-role caller's
--    privileges, which include bypassing RLS).
create or replace function public.claim_gmail_sweep(_account_id uuid, _connection_id uuid)
returns uuid
language sql
as $$
  insert into public.gmail_sweep_log (account_id, connection_id, status, messages_read)
  values (_account_id, _connection_id, 'running', 0)
  on conflict (connection_id) where status in ('running', 'complete', 'partial')
  do update set swept_at = now(), messages_read = 0, error_summary = null
    where gmail_sweep_log.status = 'running'
      and gmail_sweep_log.swept_at < now() - interval '15 minutes'
  returning id;
$$;

revoke all on function public.claim_gmail_sweep(uuid, uuid) from public;
grant execute on function public.claim_gmail_sweep(uuid, uuid) to service_role;
