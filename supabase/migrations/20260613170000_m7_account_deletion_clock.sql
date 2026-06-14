-- M7 / issue #29 (deletion clock — stage 1): the reversible front half of
-- account deletion.
--
-- A request starts a 30-day clock (SPEC §6.11: "account data deleted ≤30 days
-- after verified deletion") and immediately severs access — every live
-- connection is revoked, which empties the vault and purges the scans derived
-- from it. During the grace window the owner can cancel; nothing irreversible
-- has happened yet.
--
-- The irreversible T+30 purge — anonymizing the append-only ledgers via a
-- sanctioned carve-out and hard-deleting all personal data, then mailing a
-- completion receipt — lands in stage 2. This migration deliberately touches
-- nothing immutable.

alter table public.accounts
  add column deletion_requested_at timestamptz,
  add column deletion_requested_by uuid references public.users (id),
  add column purge_after timestamptz;

-- Owner-initiated deletion request. Sets the clock and tears down access now.
-- Idempotent: if a request is already pending, returns the existing date
-- without resetting the clock (a second click can't extend the grace window).
create function public.request_account_deletion(p_account uuid)
returns timestamptz   -- purge_after, for the receipt / UI
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  is_owner boolean;
  due timestamptz;
  conn record;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select exists (
    select 1 from public.memberships m
    where m.account_id = p_account and m.user_id = uid
      and m.role = 'owner' and m.status = 'active'
  ) into is_owner;
  if not is_owner then
    raise exception 'only an account owner can delete the account';
  end if;

  select a.purge_after into due from public.accounts a where a.id = p_account;
  if due is not null then
    return due;  -- already pending; don't reset the clock
  end if;

  due := now() + interval '30 days';
  update public.accounts
    set deletion_requested_at = now(), deletion_requested_by = uid, purge_after = due
    where id = p_account;

  -- Sever access immediately: revoke every live connection. connection_revoke
  -- empties the vault, flips status, and (since #29 stage-0) purges the scans
  -- mined from each connection — so no data keeps flowing during the grace
  -- window. Callable here because this definer fn runs as the owner role.
  for conn in
    select id from public.connections where account_id = p_account and status <> 'revoked'
  loop
    perform public.connection_revoke(conn.id, uid);
  end loop;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (p_account, 'user', uid::text, 'account.deletion_requested', p_account::text,
            jsonb_build_object('purge_after', due));
  return due;
end;
$$;

revoke execute on function public.request_account_deletion(uuid) from public, anon, service_role;
grant execute on function public.request_account_deletion(uuid) to authenticated;

-- Owner cancel, only while a request is pending. Clears the clock. Revoked
-- connections stay revoked — we never silently restore access that was torn
-- down; the owner reconnects deliberately.
create function public.cancel_account_deletion(p_account uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  is_owner boolean;
  cleared int;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select exists (
    select 1 from public.memberships m
    where m.account_id = p_account and m.user_id = uid
      and m.role = 'owner' and m.status = 'active'
  ) into is_owner;
  if not is_owner then
    raise exception 'only an account owner can cancel deletion';
  end if;

  update public.accounts
    set deletion_requested_at = null, deletion_requested_by = null, purge_after = null
    where id = p_account and purge_after is not null;
  get diagnostics cleared = row_count;
  if cleared > 0 then
    insert into public.audit_log (account_id, actor, actor_id, action, subject)
      values (p_account, 'user', uid::text, 'account.deletion_cancelled', p_account::text);
  end if;
end;
$$;

revoke execute on function public.cancel_account_deletion(uuid) from public, anon, service_role;
grant execute on function public.cancel_account_deletion(uuid) to authenticated;
