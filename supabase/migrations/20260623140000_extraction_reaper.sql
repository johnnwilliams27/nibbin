-- Task 5: stuck-extraction reaper
--
-- Adds `attempts` column to source_extraction_jobs and `extraction_state` to
-- sources so the reaper can mark stale jobs terminal.
--
-- NOTE: started_at was already added in migration 20260622150000_company_brain_p2_doc_ingest.sql.
-- This migration adds the missing columns + the reap function.
--
-- Architecture note: extractDocument is fire-and-forget (called only from the
-- upload route); there is no poller that re-claims status='pending' jobs.
-- Therefore the reaper DIRECTLY marks stale processing jobs as status='error'
-- and sets extraction_state='failed' — re-enqueue would strand the source
-- in pending limbo forever.  The attempts column is retained as an informational
-- counter (stamped by the worker at claim time) but is NOT used for control flow.

-- Add extraction_state to sources (used by doc-extract.ts worker throughout)
alter table public.sources
  add column if not exists extraction_state text not null default 'pending'
    check (extraction_state in ('pending','extracting','extracted','unsupported','failed'));

-- Add attempts counter to source_extraction_jobs (informational only)
alter table public.source_extraction_jobs
  add column if not exists attempts integer not null default 0;

-- ── reap_stale_extractions ──────────────────────────────────────────────────
-- For each job that is:
--   status='processing' AND started_at IS NOT NULL
--   AND started_at < now() - make_interval(mins => p_stale_minutes)
--
-- → Terminally fail: status='error', error_message='extraction timed out'
--   AND set its sources.extraction_state='failed'.
--
-- There is no re-enqueue path: extractDocument has no re-driver, so bouncing
-- a job to 'pending' would strand it indefinitely.
--
-- Returns: count of rows reaped.
create or replace function public.reap_stale_extractions(
  p_stale_minutes integer default 10
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
    select id, source_id
      from public.source_extraction_jobs
     where status      = 'processing'
       and started_at  is not null
       and started_at  < now() - make_interval(mins => p_stale_minutes)
    for update
  loop
    -- Terminally fail: no re-enqueue because there is no re-driver
    update public.source_extraction_jobs
       set status        = 'error',
           error_message = 'extraction timed out'
     where id = v_row.id;

    update public.sources
       set extraction_state = 'failed'
     where id = v_row.source_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Grant posture: mirror reap_stale_plan_runs (service_role only)
revoke execute on function public.reap_stale_extractions(integer) from public;
revoke execute on function public.reap_stale_extractions(integer) from anon;
revoke execute on function public.reap_stale_extractions(integer) from authenticated;
grant  execute on function public.reap_stale_extractions(integer) to   service_role;
