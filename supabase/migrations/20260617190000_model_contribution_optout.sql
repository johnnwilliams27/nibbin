-- Model-improvement contribution (R49; T&C spec §7.1, decision D1-A).
-- Nibbin never trains on user CONTENT (R48) — so the old training_opt_in flag
-- ("opt IN to content training", default off, read nowhere) is moot and
-- contradicts the invariant. Replace it with the R49 control: contribute
-- anonymized, aggregate STRUCTURAL signals (capability/model performance) —
-- never content, never per-user. Opt-out, default ON. Adding the column with
-- default true backfills every existing account to "on" (the approved backfill).

alter table public.accounts
  add column if not exists model_contribution_enabled boolean not null default true;

create or replace function public.set_model_contribution(target_account uuid, enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  update public.accounts set model_contribution_enabled = enabled where id = target_account;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.model_contribution_set', target_account::text,
    jsonb_build_object('enabled', enabled));
end;
$$;
revoke execute on function public.set_model_contribution(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_model_contribution(uuid, boolean) to authenticated;

-- Retire the superseded content-training-opt-in flag + RPC (read nowhere).
drop function if exists public.set_training_opt_in(uuid, boolean);
alter table public.accounts drop column if exists training_opt_in;
