-- Planner Slice 3a: plan_runs — the resumable, ephemeral run state for the
-- supervised bounded-ReAct Planner (mode C). SPEC §3 (resumable run state),
-- design 2026-06-18-planner-slice3a-design.md.
--
-- A plan run is EPHEMERAL: it is NOT an agent_specs/nibbins row — no roster
-- entry, no recurring trigger, no tier-cap slot. Only the RUN is persisted
-- here, for resume + audit. The transcript (ordered tool-picks + observations),
-- the scratchpad, the current status, the pending request, and the final
-- artifact live in this one row.
--
-- Conventions follow M4 (20260611120000): RLS on every account-scoped table,
-- client roles get SELECT through membership only, ALL writes go through
-- security-definer RPCs (service-role only). Clients cannot insert/update here
-- at all. audit_log rows on create + on terminal status.

create table public.plan_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  -- the user who started the run (for audit); nullable for system-initiated runs
  created_by uuid references public.users (id),
  goal text not null check (btrim(goal) <> ''),
  -- the validated PlanSpec snapshot the loop is provisioned to (fixed at preview)
  plan jsonb not null,
  -- ordered tool-picks + observations (the audit ledger for the run)
  transcript jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  -- run-scoped working memory (scratchpad.write/read)
  scratchpad jsonb not null default '{}'::jsonb check (jsonb_typeof(scratchpad) = 'object'),
  status text not null default 'running' check (
    status in ('running', 'needs_input', 'done', 'failed', 'killed')
  ),
  -- present exactly while needs_input: {requestId, kind, question, context}
  pending jsonb,
  -- the structured result returned by `done`
  artifact jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index plan_runs_account_idx on public.plan_runs (account_id, created_at);

-- ── RPCs (service-role only; the app-layer harness validated fail-closed) ────

-- Create a plan run with a freshly-validated PlanSpec snapshot.
create function public.plan_run_create(
  p_account uuid,
  p_user uuid,
  p_goal text,
  p_plan jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.plan_runs (account_id, created_by, goal, plan, status)
  values (p_account, p_user, p_goal, p_plan, 'running')
  returning id into v_id;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    p_account, 'user', coalesce(p_user::text, 'service'),
    'plan_run.created', v_id::text,
    jsonb_build_object('goal', p_goal)
  );
  return v_id;
end;
$$;

grant execute on function public.plan_run_create(uuid, uuid, text, jsonb) to service_role;

-- Save the run's transcript / scratchpad / status / pending / artifact. Audits
-- a terminal transition (done/failed/killed) for the trust ledger.
create function public.plan_run_save(
  p_run uuid,
  p_transcript jsonb,
  p_scratchpad jsonb,
  p_status text,
  p_pending jsonb,
  p_artifact jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  if p_status not in ('running', 'needs_input', 'done', 'failed', 'killed') then
    raise exception 'invalid plan_run status %', p_status;
  end if;

  update public.plan_runs
     set transcript = coalesce(p_transcript, transcript),
         scratchpad = coalesce(p_scratchpad, scratchpad),
         status     = p_status,
         pending    = p_pending,
         artifact   = coalesce(p_artifact, artifact),
         updated_at = now()
   where id = p_run
   returning account_id into v_account;

  if v_account is null then
    raise exception 'unknown plan run %', p_run;
  end if;

  if p_status in ('done', 'failed', 'killed') then
    insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (
      v_account, 'system', 'planner', 'plan_run.' || p_status, p_run::text,
      jsonb_build_object('status', p_status)
    );
  end if;
end;
$$;

grant execute on function public.plan_run_save(uuid, jsonb, jsonb, text, jsonb, jsonb) to service_role;

-- Atomic compare-and-set for the pause→resume transition (FIX 2 — the approval
-- double-execute TOCTOU). Flip the row from 'needs_input' to 'running' ONLY
-- when it is still needs_input AND the pending request matches p_request_id.
-- Returns true to the single caller that won the transition; false to any
-- concurrent resume (which must NOT execute the held draft). Account-scoped:
-- a foreign account_id can never win the CAS.
create function public.plan_run_resolve(
  p_run uuid,
  p_account uuid,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.plan_runs
     set status     = 'running',
         pending     = null,
         updated_at  = now()
   where id = p_run
     and account_id = p_account
     and status = 'needs_input'
     and pending ->> 'requestId' = p_request_id;

  get diagnostics v_rows = row_count;
  -- exactly one row flipped → this caller won the CAS.
  return v_rows = 1;
end;
$$;

grant execute on function public.plan_run_resolve(uuid, uuid, text) to service_role;

-- ── RLS: account members read their own; all writes service-role only ────────

alter table public.plan_runs enable row level security;

create policy plan_runs_member_read on public.plan_runs
  for select to authenticated
  using ((select private.is_account_member(account_id)));

-- belt + suspenders: anon gets nothing; authenticated cannot write (RPCs only)
revoke all on public.plan_runs from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.plan_runs
  from authenticated;
