-- L1 idempotency: provenance marker for the derived-memory write phase.
--
-- Problem (from connections-p3-followups gate, finding L1 residual):
-- A hard process-kill between the grove_memory/grove_state writes and the
-- finalize UPDATE leaves the gmail_sweep_log row stuck in 'running'. The
-- 15-minute stale-reclaim in claim_gmail_sweep sees the row and re-resets it
-- to a fresh 'running' claim — causing a full re-run of the ~12-month sweep
-- and re-spending model budget, even though the derived notes were already
-- written.
--
-- Fix: gmailOnboardingSweep sets derived_written_at (via UPDATE on the claim
-- row) immediately after the grove writes succeed, before returning. The
-- updated claim_gmail_sweep detects this marker on a stale 'running' row and
-- auto-finalizes it to 'complete' (returning NULL = skip) instead of re-claiming.

alter table public.gmail_sweep_log
  add column if not exists derived_written_at timestamptz;

-- Replace claim_gmail_sweep to handle the provenance marker.
-- When a stale 'running' row has derived_written_at IS NOT NULL, auto-finalize
-- it to 'complete' (idempotent no-op for the caller) instead of re-claiming.
-- All other behaviour is unchanged.
create or replace function public.claim_gmail_sweep(_account_id uuid, _connection_id uuid)
returns uuid
language plpgsql
as $$
declare
  _stale_id      uuid;
  _stale_derived timestamptz;
  _new_id        uuid;
begin
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

  -- Standard atomic claim: insert or reclaim a stale 'running' row that has NOT
  -- written derived data (derived_written_at IS NULL). complete/partial rows and
  -- fresh 'running' rows are untouched (no row updated → RETURNING is empty → NULL).
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
