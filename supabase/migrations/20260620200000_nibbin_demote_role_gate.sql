-- #47a: gate nibbin_demote to account owners and admins.
--
-- Prior to this migration, nibbin_demote was callable by any account member
-- (role='member'), allowing intra-account griefing: a member could demote
-- Nibbins belonging to other members' workflows without authorization.
--
-- Fix: replace the is_account_member() check with a role check that requires
-- the caller to hold 'owner' or 'admin' on the account. Service-role callers
-- (automated system paths) are unaffected.
--
-- Preserved: SECURITY DEFINER, SET search_path='', signature, return type,
-- the stage-transition logic, and the audit_log insert.

create or replace function public.nibbin_demote(p_nibbin uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  v_account uuid;
  v_stage   text;
  v_next    text;
begin
  select n.account_id, n.stage into v_account, v_stage
    from public.nibbins n where n.id = p_nibbin for update;

  if not found then
    raise exception 'unknown nibbin %', p_nibbin;
  end if;

  -- Authenticated callers must hold owner or admin on the account (#47a).
  -- Service-role callers (uid IS NULL, role='service_role') bypass this gate,
  -- consistent with every other security-definer RPC in this codebase.
  if uid is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not authenticated';
  end if;
  if uid is not null then
    if not exists (
      select 1 from public.memberships m
      where m.account_id = v_account
        and m.user_id    = uid
        and m.status     = 'active'
        and m.role in ('owner', 'admin')
    ) then
      raise exception 'permission denied — demoting a Nibbin requires owner or admin role';
    end if;
  end if;

  v_next := case v_stage
    when 'grad'   then 'senior'
    when 'senior' then 'student'
    else null
  end;
  if v_next is null then
    raise exception 'nibbin % is already drafting everything', p_nibbin;
  end if;

  -- Reset the climb: the next stage must be re-earned from scratch (§4.7).
  update public.nibbins set stage = v_next, stage_changed_at = now() where id = p_nibbin;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    v_account,
    coalesce(case when uid is null then 'system' end, 'user'),
    coalesce(uid::text, 'runtime'),
    'nibbin.stage_demoted',
    p_nibbin::text,
    jsonb_build_object('from', v_stage, 'to', v_next)
  );

  return v_next;
end;
$$;

-- Grant unchanged: authenticated users can call it, but the function body now
-- enforces the owner/admin role gate for non-service-role callers.
revoke execute on function public.nibbin_demote(uuid) from public, anon;
grant execute on function public.nibbin_demote(uuid) to authenticated, service_role;
