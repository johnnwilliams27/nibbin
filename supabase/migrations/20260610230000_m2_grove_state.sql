-- M2: grove state — the Grovekeeper's per-account memory (SPEC §4.1 steps 2–3,
-- §4.2). One row per account: the Keeper's given name (naming is mandatory —
-- the strongest ownership mechanic), onboarding progress, and the three
-- seeding answers (they rank the connector scan and Agent Shop at M4).
--
-- Conventions follow M1: RLS member read, zero direct client writes, all
-- client mutation through one security-definer function that re-checks
-- membership. The onboarding state machine itself lives in packages/keeper;
-- the database enforces only the invariants that must survive a hostile
-- client: membership scoping, bounded sizes, forward-only steps, and
-- name-before-done.

create table public.grove_state (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  keeper_name text check (
    keeper_name is null
    or (btrim(keeper_name) <> '' and char_length(keeper_name) <= 40)
  ),
  onboarding_step text not null default 'ask_user_name' check (
    onboarding_step in ('ask_user_name', 'ask_keeper_name', 'q_craft', 'q_time', 'q_channels', 'done')
  ),
  answers jsonb not null default '{}'::jsonb check (pg_column_size(answers) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Naming is mandatory: past the naming step, a keeper name must exist.
  constraint grove_state_named_after_naming check (
    onboarding_step in ('ask_user_name', 'ask_keeper_name') or keeper_name is not null
  )
);

alter table public.grove_state enable row level security;

create policy grove_state_member_read on public.grove_state
  for select to authenticated
  using ((select private.is_account_member(account_id)));

-- anon touches nothing; clients never write directly (RPC below or service role)
revoke all on public.grove_state from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.grove_state from authenticated;

-- ── the single client write path ─────────────────────────────────────────────
-- Steps only move forward (a hostile client may skip ahead through its OWN
-- onboarding — that costs nobody anything — but can never un-name the Keeper
-- or reset a finished grove into a re-hatch).

create function public.save_grove_state(
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
  step_order constant text[] :=
    array['ask_user_name', 'ask_keeper_name', 'q_craft', 'q_time', 'q_channels', 'done'];
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

  -- serialize concurrent saves per account
  perform pg_advisory_xact_lock(hashtext('grove_state:' || target_account::text));

  select onboarding_step, keeper_name into current_step, current_name
    from public.grove_state where account_id = target_account;

  if current_step is not null then
    if array_position(step_order, new_step) < array_position(step_order, current_step) then
      raise exception 'onboarding only moves forward';
    end if;
    if current_name is not null
       and new_keeper_name is distinct from current_name then
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

  -- completion is a real account event — visible in the audit trail
  if new_step = 'done' and (current_step is null or current_step <> 'done') then
    insert into public.audit_log (account_id, actor, actor_id, action, subject)
    values (target_account, 'user', uid::text, 'grove.onboarding_completed', target_account::text);
  end if;
end;
$$;

revoke execute on function public.save_grove_state(uuid, text, text, jsonb) from public, anon, service_role;
grant execute on function public.save_grove_state(uuid, text, text, jsonb) to authenticated;
