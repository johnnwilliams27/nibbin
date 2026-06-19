-- §7.3 Channel-Initiated Work: per-binding work session.
-- One row per (channel, external_id) = the single in-flight conversational
-- state: a proposed plan awaiting Start, or a running plan awaiting an
-- approval tap / a typed answer from the user.
--
-- Service-role writes only (via security-definer RPCs below). No client
-- access whatsoever — RLS enabled + full revoke on anon/authenticated.
-- Mirrors grant/RLS style from 20260618140000_channel_budgets.sql and
-- 20260618060000_plan_runs.sql.

create table public.channel_work_session (
  account_id   uuid        not null references public.accounts (id) on delete cascade,
  channel      text        not null,
  external_id  text        not null,
  kind         text        not null check (kind in ('proposed', 'awaiting')),
  plan         jsonb,
  plan_run_id  uuid,
  request_id   text,
  request_kind text        check (request_kind is null or request_kind in ('approval', 'auth', 'decision', 'value')),
  updated_at   timestamptz not null default now(),
  primary key (channel, external_id)
);

alter table public.channel_work_session enable row level security;

-- Service-role-definer writes only. Clients (anon + authenticated) get no access.
revoke all on public.channel_work_session from anon, authenticated;

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- Upsert the work session for a (channel, external_id) binding.
create or replace function public.channel_work_session_set(
  p_account      uuid,
  p_channel      text,
  p_external_id  text,
  p_kind         text,
  p_plan         jsonb,
  p_run          uuid,
  p_request_id   text,
  p_request_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channel_work_session (
    account_id, channel, external_id,
    kind, plan, plan_run_id,
    request_id, request_kind, updated_at
  )
  values (
    p_account, p_channel, p_external_id,
    p_kind, p_plan, p_run,
    p_request_id, p_request_kind, now()
  )
  on conflict (channel, external_id) do update
    set account_id   = excluded.account_id,
        kind         = excluded.kind,
        plan         = excluded.plan,
        plan_run_id  = excluded.plan_run_id,
        request_id   = excluded.request_id,
        request_kind = excluded.request_kind,
        updated_at   = now();
end;
$$;

revoke execute on function public.channel_work_session_set(uuid, text, text, text, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.channel_work_session_set(uuid, text, text, text, jsonb, uuid, text, text) to service_role;

-- Delete the work session for a (channel, external_id) binding.
create or replace function public.channel_work_session_clear(
  p_channel     text,
  p_external_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.channel_work_session
   where channel = p_channel
     and external_id = p_external_id;
end;
$$;

revoke execute on function public.channel_work_session_clear(text, text) from public, anon, authenticated;
grant execute on function public.channel_work_session_clear(text, text) to service_role;
