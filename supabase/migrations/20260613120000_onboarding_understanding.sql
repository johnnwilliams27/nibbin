-- Onboarding redesign Phase 1: the static three-question step set collapses to
-- a single 'understand' phase (model-driven, server-owned loop in
-- packages/keeper + apps/web). Adds the desktop handoff table.

-- 1. Backfill legacy rows BEFORE tightening the constraint.
update public.grove_state
  set onboarding_step = 'understand'
  where onboarding_step in ('q_craft', 'q_time', 'q_channels');

-- 2. Replace the step CHECK constraint.
alter table public.grove_state drop constraint grove_state_onboarding_step_check;
alter table public.grove_state add constraint grove_state_onboarding_step_check
  check (onboarding_step in ('ask_user_name', 'ask_keeper_name', 'understand', 'done'));

-- 3. Replace save_grove_state with the new forward-only step order.
create or replace function public.save_grove_state(
  target_account uuid,
  new_step text,
  new_keeper_name text,
  new_answers jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  step_order constant text[] := array['ask_user_name', 'ask_keeper_name', 'understand', 'done'];
  current_step text;
  current_name text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if array_position(step_order, new_step) is null then
    raise exception 'unknown onboarding step';
  end if;

  perform pg_advisory_xact_lock(hashtext('grove_state:' || target_account::text));

  select onboarding_step, keeper_name into current_step, current_name
    from public.grove_state where account_id = target_account;

  if current_step is not null then
    if array_position(step_order, new_step) < array_position(step_order, current_step) then
      raise exception 'onboarding only moves forward';
    end if;
    if current_name is not null and new_keeper_name is distinct from current_name then
      raise exception 'the Grovekeeper keeps the name it was given';
    end if;
  end if;

  insert into public.grove_state as g (account_id, onboarding_step, keeper_name, answers)
  values (target_account, new_step, nullif(btrim(coalesce(new_keeper_name, '')), ''), coalesce(new_answers, '{}'::jsonb))
  on conflict (account_id) do update
    set onboarding_step = excluded.onboarding_step,
        keeper_name = excluded.keeper_name,
        answers = excluded.answers,
        updated_at = now();

  if new_step = 'done' and (current_step is null or current_step <> 'done') then
    insert into public.audit_log (account_id, actor, actor_id, action, subject)
    values (target_account, 'user', uid::text, 'grove.onboarding_completed', target_account::text);
  end if;
end;
$$;

revoke execute on function public.save_grove_state(uuid, text, text, jsonb) from public, anon, service_role;
grant execute on function public.save_grove_state(uuid, text, text, jsonb) to authenticated;

-- 4. The desktop handoff: one row per account, written by web at completion,
--    read by the desktop shell over the same RLS surface.
create table public.onboarding_handoff (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  profile jsonb not null check (pg_column_size(profile) <= 16384),
  recommendations jsonb not null check (pg_column_size(recommendations) <= 16384),
  source text not null check (source in ('model', 'static_fallback', 'default_floor')),
  status text not null default 'pending_handoff' check (status in ('pending_handoff', 'claimed')),
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.onboarding_handoff enable row level security;

create policy onboarding_handoff_member_read on public.onboarding_handoff
  for select to authenticated
  using ((select private.is_account_member(account_id)));

revoke all on public.onboarding_handoff from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.onboarding_handoff from authenticated;

-- Single client write path (mirrors save_grove_state). Desktop only reads;
-- claiming the handoff (status flip) is a separate small update path.
create function public.save_onboarding_handoff(
  target_account uuid,
  new_profile jsonb,
  new_recommendations jsonb,
  new_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if new_source not in ('model', 'static_fallback', 'default_floor') then
    raise exception 'unknown handoff source';
  end if;

  insert into public.onboarding_handoff as h (account_id, profile, recommendations, source)
  values (target_account, coalesce(new_profile, '{}'::jsonb), coalesce(new_recommendations, '{}'::jsonb), new_source)
  on conflict (account_id) do update
    set profile = excluded.profile,
        recommendations = excluded.recommendations,
        source = excluded.source,
        updated_at = now();
end;
$$;

revoke execute on function public.save_onboarding_handoff(uuid, jsonb, jsonb, text) from public, anon, service_role;
grant execute on function public.save_onboarding_handoff(uuid, jsonb, jsonb, text) to authenticated;
