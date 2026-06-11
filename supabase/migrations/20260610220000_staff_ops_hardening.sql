-- Hardening for the admin console after the PR #9 adversarial review.
-- service_role-only, like the rest of the staff ops.

-- P0: exact, case-folded, wildcard-free staff identity lookup. The app must use
-- this instead of a PostgREST .ilike() on the attacker-controlled login email
-- (where % and _ are live wildcards — '%' matched every staff row and returned
-- superadmin). Returns at most one row.
create function public.staff_identity_for_email(p_email text)
returns table (id uuid, role text)
language sql
security definer
set search_path = ''
stable
as $$
  select s.id, s.role
  from public.staff_users s
  where lower(s.email) = lower(btrim(p_email))
  limit 1;
$$;
revoke execute on function public.staff_identity_for_email(text) from public, anon, authenticated;
grant execute on function public.staff_identity_for_email(text) to service_role;

-- P1: credit adjustment must enforce RBAC at the DB layer too (its sibling
-- staff_start_impersonation already does). An engineer must not be able to mint
-- credits even if the app-layer check is bypassed. Also cap the reason length.
create or replace function public.staff_adjust_credits(
  p_account_id uuid,
  p_delta integer,
  p_reason text,
  p_staff_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  adj uuid := gen_random_uuid();
  staff_email text;
  staff_role text;
begin
  if p_delta = 0 then
    raise exception 'adjustment delta must be non-zero';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required';
  end if;
  if length(p_reason) > 500 then
    raise exception 'reason is too long (max 500 chars)';
  end if;
  select email, role into staff_email, staff_role from public.staff_users where id = p_staff_id;
  if staff_email is null then
    raise exception 'unknown staff actor';
  end if;
  if staff_role not in ('support', 'superadmin') then
    raise exception 'role % may not adjust credits', staff_role;
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id) then
    raise exception 'unknown account';
  end if;

  insert into public.credit_ledger (account_id, delta, reason, source_id)
    values (
      p_account_id,
      p_delta,
      case when p_delta > 0 then 'grant' else 'clawback' end,
      'staff_adj:' || adj::text
    );

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (
      p_account_id, 'staff', staff_email, 'credit.adjusted', p_account_id::text,
      jsonb_build_object('delta', p_delta, 'reason', p_reason, 'adjustment_id', adj)
    );
  return adj;
end;
$$;
revoke execute on function public.staff_adjust_credits(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.staff_adjust_credits(uuid, integer, text, uuid) to service_role;

-- Read-access auditing: "everything audited" (§6.10) includes staff VIEWING a
-- customer account — the core insider-threat control. Lightweight append-only
-- record of who looked at / searched what.
create function public.staff_log_access(
  p_staff_id uuid,
  p_action text,
  p_account_id uuid,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  staff_email text;
begin
  if p_action not in ('account.viewed', 'account.searched') then
    raise exception 'unsupported access action %', p_action;
  end if;
  select email into staff_email from public.staff_users where id = p_staff_id;
  if staff_email is null then
    raise exception 'unknown staff actor';
  end if;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (p_account_id, 'staff', staff_email, p_action, coalesce(p_account_id::text, ''), coalesce(p_meta, '{}'::jsonb));
end;
$$;
revoke execute on function public.staff_log_access(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.staff_log_access(uuid, text, uuid, jsonb) to service_role;
