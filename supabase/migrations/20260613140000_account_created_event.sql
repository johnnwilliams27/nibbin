-- M7 §6.12 / TTFAD: emit `account_created` at account creation — the TTFAD start
-- anchor (stop is `first_draft_approved`, already emitted in decide_run path).
-- Most of the activation funnel already emits (scan_completed, nibbin_adopted,
-- run_*/first_draft_approved); account_created was the missing first event.
--
-- Emitted inside bootstrap_account's create branch: at that point the caller is
-- the new account's owner, so emit_product_event's membership check passes. The
-- early-return-existing branch never emits, so it fires exactly once per account.

create or replace function public.bootstrap_account(account_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  existing uuid;
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select m.account_id into existing
    from public.memberships m
    where m.user_id = uid and m.role = 'owner' and m.status = 'active'
    order by m.created_at, m.account_id
    limit 1;
  if existing is not null then
    return existing;
  end if;
  new_id := public.create_account_with_owner(account_name);
  perform public.emit_product_event(new_id, 'account_created', '{}'::jsonb);
  return new_id;
end;
$$;
