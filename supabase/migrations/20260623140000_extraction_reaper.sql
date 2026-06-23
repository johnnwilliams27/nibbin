-- Task 5: stuck-extraction reaper
--
-- Adds `attempts` column to source_extraction_jobs and `extraction_state` to
-- sources so the reaper can distinguish transient crashes (re-enqueue) from
-- repeated failures (give up).
--
-- NOTE: started_at was already added in migration 20260622150000_company_brain_p2_doc_ingest.sql.
-- This migration adds the missing columns + the reap function.
--
-- The worker stamps `started_at = now()` and `attempts = attempts + 1` when it
-- claims a job (sets status='processing'). The reaper fires every 15 min and
-- re-drives any processing job whose started_at is older than p_stale_minutes.
-- Once attempts >= p_max_attempts the job is permanently errored and its source
-- is marked extraction_state='failed'.

-- Add extraction_state to sources (used by doc-extract.ts worker throughout)
alter table public.sources
  add column if not exists extraction_state text not null default 'pending'
    check (extraction_state in ('pending','extracting','extracted','unsupported','failed'));

-- Add attempts counter to source_extraction_jobs
alter table public.source_extraction_jobs
  add column if not exists attempts integer not null default 0;

-- ── reap_stale_extractions ──────────────────────────────────────────────────
-- For each job that is:
--   status='processing' AND started_at IS NOT NULL
--   AND started_at < now() - make_interval(mins => p_stale_minutes)
--
-- If attempts < p_max_attempts  → re-enqueue: status='pending', clear started_at
-- If attempts >= p_max_attempts → give up:    status='error',   error_message='extraction timed out'
--                                              AND set its sources.extraction_state='failed'
--
-- Returns: count of rows reaped (in either direction).
create or replace function public.reap_stale_extractions(
  p_stale_minutes integer default 10,
  p_max_attempts  integer default 3
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_row   record;
begin
  for v_row in
    select id, source_id, attempts
      from public.source_extraction_jobs
     where status      = 'processing'
       and started_at  is not null
       and started_at  < now() - make_interval(mins => p_stale_minutes)
    for update
  loop
    if v_row.attempts < p_max_attempts then
      -- Re-enqueue: clear started_at so the worker can claim it fresh
      update public.source_extraction_jobs
         set status     = 'pending',
             started_at = null
       where id = v_row.id;
    else
      -- Give up: mark error + fail the source
      update public.source_extraction_jobs
         set status        = 'error',
             error_message = 'extraction timed out'
       where id = v_row.id;

      update public.sources
         set extraction_state = 'failed'
       where id = v_row.source_id;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Grant posture: mirror reap_stale_plan_runs (service_role only)
revoke execute on function public.reap_stale_extractions(integer, integer) from public;
revoke execute on function public.reap_stale_extractions(integer, integer) from anon;
revoke execute on function public.reap_stale_extractions(integer, integer) from authenticated;
grant  execute on function public.reap_stale_extractions(integer, integer) to   service_role;
