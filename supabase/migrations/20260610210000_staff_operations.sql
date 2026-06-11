-- Staff operations for the admin console (§6.10). These run as the SERVICE ROLE
-- only — the admin server, which bypasses RLS because staff legitimately need
-- cross-account access. The functions add atomicity (ledger + audit in one
-- transaction) and centralize the "every staff action is audited, append-only,
-- never an edit" invariant. The admin app verifies staff identity + RBAC before
-- calling; these are the DB-layer backstop.

-- Resolve a signed-in auth user to their staff role, or null if not staff.
-- (Staff are identified by email in staff_users — entirely separate from the
-- product users table; a person may share an email across both worlds.)
create function public.staff_role_for_email(p_email text)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select role from public.staff_users where lower(email) = lower(p_email) limit 1;
$$;
revoke execute on function public.staff_role_for_email(text) from public, anon, authenticated;
grant execute on function public.staff_role_for_email(text) to service_role;

-- Atomic credit adjustment: one append-only ledger entry + one audit row, or
-- neither. Positive delta = grant, negative = clawback. A human reason is
-- mandatory and lands in the audit meta (the ledger reason is the enum).
create function public.staff_adjust_credits(
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
begin
  if p_delta = 0 then
    raise exception 'adjustment delta must be non-zero';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required';
  end if;
  select email into staff_email from public.staff_users where id = p_staff_id;
  if staff_email is null then
    raise exception 'unknown staff actor';
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

-- Start a governed impersonation session. Default read-only; 'act' scope
-- requires a superadmin. The existing after-insert trigger writes the
-- account-visible audit row, so a session can't exist unaudited.
create function public.staff_start_impersonation(
  p_account_id uuid,
  p_staff_id uuid,
  p_reason text,
  p_scope text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sess uuid;
  staff_role text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required';
  end if;
  if p_scope not in ('read', 'act') then
    raise exception 'scope must be read or act';
  end if;
  select role into staff_role from public.staff_users where id = p_staff_id;
  if staff_role is null then
    raise exception 'unknown staff actor';
  end if;
  if p_scope = 'act' and staff_role <> 'superadmin' then
    raise exception 'act scope requires superadmin';
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id) then
    raise exception 'unknown account';
  end if;

  insert into public.impersonation_sessions (staff_id, account_id, reason, scope)
    values (p_staff_id, p_account_id, btrim(p_reason), p_scope)
    returning id into sess;
  return sess;
end;
$$;
revoke execute on function public.staff_start_impersonation(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.staff_start_impersonation(uuid, uuid, text, text) to service_role;
