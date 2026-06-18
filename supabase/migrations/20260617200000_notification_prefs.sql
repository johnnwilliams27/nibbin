-- Notification preferences (T&C spec §7.4): let members control the companion
-- email arc — drip_arcs.email_enabled + quiet hours. drip_arcs allows no direct
-- client writes (RLS), so mutation goes through this security-definer RPC.
-- UPDATE-only by design: the drip worker owns row creation
-- (insert ... on conflict do nothing, keyed to onboarding; started_at anchors
-- the 14-day arc), so creating a row here would mis-anchor the arc. Pre-arc
-- accounts have nothing to update yet — the panel shows the schema defaults.

create or replace function public.set_notification_prefs(
  target_account uuid,
  email_enabled boolean,
  quiet_start smallint,
  quiet_end smallint
)
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
  if quiet_start < 0 or quiet_start > 23 or quiet_end < 0 or quiet_end > 23 then
    raise exception 'quiet hours must be between 0 and 23';
  end if;
  update public.drip_arcs
     set email_enabled = set_notification_prefs.email_enabled,
         quiet_start = set_notification_prefs.quiet_start,
         quiet_end = set_notification_prefs.quiet_end
   where account_id = target_account;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.notification_prefs_set', target_account::text,
    jsonb_build_object('email_enabled', email_enabled, 'quiet_start', quiet_start, 'quiet_end', quiet_end));
end;
$$;
revoke execute on function public.set_notification_prefs(uuid, boolean, smallint, smallint) from public, anon, service_role;
grant execute on function public.set_notification_prefs(uuid, boolean, smallint, smallint) to authenticated;
