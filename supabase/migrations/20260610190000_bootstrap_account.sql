-- Idempotent, race-safe first-sign-in account bootstrap (red-team PR #8 P2).
--
-- The app called create_account_with_owner from two concurrently-reachable
-- entry points (callback + /app) after a check-then-create read, so a first
-- sign-in could create two accounts. This function moves the check+create into
-- one transaction guarded by a per-user advisory lock: concurrent callers
-- serialize, and all but the first see the account the winner created. The
-- self-scoped, ordered SELECT also removes the app's reliance on RLS to pick
-- "my" owner row (which, in a future shared account, could resolve to someone
-- else's owner membership).

create function public.bootstrap_account(account_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  existing uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  -- serialize concurrent bootstraps for this user within the transaction
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select m.account_id into existing
    from public.memberships m
    where m.user_id = uid and m.role = 'owner' and m.status = 'active'
    order by m.created_at, m.account_id
    limit 1;
  if existing is not null then
    return existing;
  end if;
  return public.create_account_with_owner(account_name);
end;
$$;
revoke execute on function public.bootstrap_account(text) from public, anon, service_role;
grant execute on function public.bootstrap_account(text) to authenticated;
