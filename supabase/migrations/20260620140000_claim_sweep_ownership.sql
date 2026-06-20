-- #133 (security): make claim_gmail_sweep ownership authoritative in the RPC.
--
-- Previously, the RPC accepted _account_id and _connection_id from the caller
-- and inserted them into gmail_sweep_log with no DB-level ownership check.
-- App-side validation was the only guard. A compromised or mis-wired caller
-- could sweep a connection that doesn't belong to it.
--
-- Fix: require that the supplied (_connection_id, _account_id) pair exists in
-- public.connections with status = 'active' before allowing the claim to proceed.
-- If not, raise an exception that surfaces as a clean error to the caller.
--
-- All other behaviour is preserved:
--   - Same signature: claim_gmail_sweep(_account_id uuid, _connection_id uuid)
--   - Same return type: uuid (null = skip / already swept)
--   - SECURITY DEFINER + search_path = public (unchanged)
--   - service_role-only grant (unchanged)
--   - Existing derived_written_at provenance check preserved
--   - Existing on-conflict / HMAC / stale-reclaim logic preserved

create or replace function public.claim_gmail_sweep(_account_id uuid, _connection_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _stale_id      uuid;
  _stale_derived timestamptz;
  _new_id        uuid;
begin
  -- ── Ownership guard (new in this migration) ─────────────────────────────────
  -- Verify that the connection belongs to the supplied account and is active.
  -- This check runs in the DB, not the app, so it cannot be bypassed by
  -- a caller that constructs its own RPC invocation.
  if not exists (
    select 1
      from public.connections
     where id         = _connection_id
       and account_id = _account_id
       and status     = 'active'
  ) then
    raise exception 'claim_gmail_sweep: connection % does not belong to account % or is not active',
      _connection_id, _account_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── Provenance check (unchanged from 20260619240000_sweep_provenance) ───────
  -- Check for a stale 'running' row (>15 min old) that already wrote derived data.
  -- If found, finalize it to 'complete' and return NULL so the caller skips.
  select id, derived_written_at
    into _stale_id, _stale_derived
    from public.gmail_sweep_log
   where connection_id = _connection_id
     and status = 'running'
     and swept_at < now() - interval '15 minutes'
   limit 1;

  if _stale_id is not null and _stale_derived is not null then
    -- Derived notes already written; just close the row without re-running.
    update public.gmail_sweep_log
       set status = 'complete',
           swept_at = now()
     where id = _stale_id;
    return null; -- caller sees already_swept; no re-run, no re-spend
  end if;

  -- ── Standard atomic claim (unchanged) ────────────────────────────────────────
  -- Insert or reclaim a stale 'running' row that has NOT written derived data.
  -- complete/partial rows and fresh 'running' rows are untouched
  -- (no row updated → RETURNING is empty → NULL).
  insert into public.gmail_sweep_log (account_id, connection_id, status, messages_read)
  values (_account_id, _connection_id, 'running', 0)
  on conflict (connection_id) where status in ('running', 'complete', 'partial')
  do update set swept_at = now(), messages_read = 0, error_summary = null,
                derived_written_at = null
    where gmail_sweep_log.status = 'running'
      and gmail_sweep_log.swept_at < now() - interval '15 minutes'
      and gmail_sweep_log.derived_written_at is null
  returning id into _new_id;

  return _new_id;
end;
$$;

revoke all on function public.claim_gmail_sweep(uuid, uuid) from public;
grant execute on function public.claim_gmail_sweep(uuid, uuid) to service_role;
