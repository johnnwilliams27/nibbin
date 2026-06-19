-- Unify quiet-hours on notification_settings (the dispatcher's source of truth).
-- 1) set_notification_prefs becomes email-only (drip companion-email toggle).
-- 2) set_notification_settings.digest_mode becomes optional (preserve on update).
-- 3) drop the duplicated quiet-hours columns from drip_arcs.

-- (1) email-only prefs — signature changes, so drop the old 4-arg function first.
drop function if exists public.set_notification_prefs(uuid, boolean, smallint, smallint);
create or replace function public.set_notification_prefs(
  target_account uuid,
  email_enabled boolean
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
  update public.drip_arcs
     set email_enabled = set_notification_prefs.email_enabled
   where account_id = target_account;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.notification_prefs_set', target_account::text,
          jsonb_build_object('email_enabled', email_enabled));
end;
$$;
revoke execute on function public.set_notification_prefs(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_notification_prefs(uuid, boolean) to authenticated;

-- (2) make digest_mode optional on set_notification_settings (preserve existing
-- value when null). Copied verbatim from 20260618110000_reach_me_channel_rpcs.sql
-- with three changes only:
--   - signature: digest_mode text default null
--   - validation: only when digest_mode is not null
--   - upsert: insert uses coalesce(digest_mode,'smart'); on-conflict preserves
--     existing digest_mode when param is null
-- quiet_start/quiet_end + auth + audit kept exactly as the original.
create or replace function public.set_notification_settings(
  target_account uuid,
  quiet_start smallint,
  quiet_end smallint,
  digest_mode text default null
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
  if digest_mode is not null and digest_mode not in ('off','smart','daily') then
    raise exception 'invalid digest mode %', digest_mode;
  end if;
  insert into public.notification_settings (account_id, quiet_start, quiet_end, digest_mode)
  values (target_account, set_notification_settings.quiet_start, set_notification_settings.quiet_end,
          coalesce(set_notification_settings.digest_mode, 'smart'))
  on conflict (account_id) do update
    set quiet_start = set_notification_settings.quiet_start,
        quiet_end = set_notification_settings.quiet_end,
        digest_mode = coalesce(set_notification_settings.digest_mode, public.notification_settings.digest_mode),
        updated_at = now();
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.notification_settings_set', target_account::text,
    jsonb_build_object('quiet_start', set_notification_settings.quiet_start, 'quiet_end', set_notification_settings.quiet_end, 'digest_mode', set_notification_settings.digest_mode));
end;
$$;
revoke execute on function public.set_notification_settings(uuid, smallint, smallint, text) from public, anon, service_role;
grant execute on function public.set_notification_settings(uuid, smallint, smallint, text) to authenticated;

-- (3) retire the duplicated columns — drip worker now reads notification_settings
alter table public.drip_arcs drop column if exists quiet_start;
alter table public.drip_arcs drop column if exists quiet_end;
