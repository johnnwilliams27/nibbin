-- Reach-Me channels — mutation RPCs. Member-facing functions mirror
-- set_notification_prefs (20260617200000): auth.uid guard, is_account_member
-- guard, audit_log insert, revoke-from-all + grant-to-authenticated. The
-- verify function is service-role-only (the inbound webhook consumes the nonce
-- under the service role; the external sender is never authenticated).

-- request_channel_link: issue a single-use, short-TTL nonce the app shows the
-- user to complete linking (e.g. Telegram `/start <nonce>`). No channel row is
-- created yet — the external_id is unknown until the callback verifies the nonce.
create or replace function public.request_channel_link(
  target_account uuid,
  channel text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_nonce text := encode(gen_random_bytes(18), 'hex');
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if channel not in ('push','email','sms','telegram','whatsapp') then
    raise exception 'unknown channel %', channel;
  end if;
  insert into public.channel_verifications (account_id, channel, nonce, expires_at)
  values (target_account, channel, v_nonce, now() + interval '30 minutes');
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'channel.link_requested', target_account::text,
    jsonb_build_object('channel', channel));
  return v_nonce;
end;
$$;
revoke execute on function public.request_channel_link(uuid, text) from public, anon, service_role;
grant execute on function public.request_channel_link(uuid, text) to authenticated;

-- set_channel_prefs: upsert per-channel enable/priority/urgency.
create or replace function public.set_channel_prefs(
  target_account uuid,
  channel text,
  enabled boolean,
  priority smallint,
  urgency_threshold text
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
  if channel not in ('push','email','sms','telegram','whatsapp') then
    raise exception 'unknown channel %', channel;
  end if;
  if priority < 0 or priority > 1000 then
    raise exception 'priority must be between 0 and 1000';
  end if;
  if urgency_threshold not in ('all','normal','high','urgent') then
    raise exception 'invalid urgency threshold %', urgency_threshold;
  end if;
  insert into public.channel_prefs (account_id, channel, enabled, priority, urgency_threshold)
  values (target_account, set_channel_prefs.channel, set_channel_prefs.enabled,
          set_channel_prefs.priority, set_channel_prefs.urgency_threshold)
  on conflict (account_id, channel) do update
    set enabled = set_channel_prefs.enabled,
        priority = set_channel_prefs.priority,
        urgency_threshold = set_channel_prefs.urgency_threshold,
        updated_at = now();
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'channel.prefs_set', target_account::text,
    jsonb_build_object('channel', channel, 'enabled', enabled, 'priority', priority,
                       'urgency_threshold', urgency_threshold));
end;
$$;
revoke execute on function public.set_channel_prefs(uuid, text, boolean, smallint, text) from public, anon, service_role;
grant execute on function public.set_channel_prefs(uuid, text, boolean, smallint, text) to authenticated;

-- set_notification_settings: upsert account-level quiet hours + digest mode.
create or replace function public.set_notification_settings(
  target_account uuid,
  quiet_start smallint,
  quiet_end smallint,
  digest_mode text
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
  if digest_mode not in ('off','smart','daily') then
    raise exception 'invalid digest mode %', digest_mode;
  end if;
  insert into public.notification_settings (account_id, quiet_start, quiet_end, digest_mode)
  values (target_account, set_notification_settings.quiet_start, set_notification_settings.quiet_end,
          set_notification_settings.digest_mode)
  on conflict (account_id) do update
    set quiet_start = set_notification_settings.quiet_start,
        quiet_end = set_notification_settings.quiet_end,
        digest_mode = set_notification_settings.digest_mode,
        updated_at = now();
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.notification_settings_set', target_account::text,
    jsonb_build_object('quiet_start', quiet_start, 'quiet_end', quiet_end, 'digest_mode', digest_mode));
end;
$$;
revoke execute on function public.set_notification_settings(uuid, smallint, smallint, text) from public, anon, service_role;
grant execute on function public.set_notification_settings(uuid, smallint, smallint, text) to authenticated;

-- revoke_channel: flip a member's channel to revoked (cascade-safe; future
-- inbound from this external_id will no longer resolve to the account).
create or replace function public.revoke_channel(
  target_account uuid,
  channel_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  changed int;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  update public.notification_channels
     set status = 'revoked', revoked_at = now()
   where id = channel_id and account_id = target_account and status <> 'revoked';
  get diagnostics changed = row_count;
  if changed > 0 then
    insert into public.audit_log (account_id, actor, actor_id, action, subject)
    values (target_account, 'user', uid::text, 'channel.revoked', channel_id::text);
  end if;
end;
$$;
revoke execute on function public.revoke_channel(uuid, uuid) from public, anon, service_role;
grant execute on function public.revoke_channel(uuid, uuid) to authenticated;

-- verify_channel_binding: SERVICE-ROLE ONLY. The inbound webhook calls this
-- with the nonce echoed back by the provider + the now-known external_id.
-- Consumes the nonce (single-use, unexpired), upserts the verified channel row,
-- seeds default prefs, returns the channel id. Returns null if the nonce is
-- unknown/consumed/expired (the caller flags + ignores — no info-leaking reply).
create or replace function public.verify_channel_binding(
  p_nonce text,
  p_external_id text,
  p_external_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_channel_id uuid;
begin
  select * into v from public.channel_verifications
   where nonce = p_nonce and status = 'issued' and expires_at > now()
   for update;
  if not found then
    return null;
  end if;
  update public.channel_verifications
     set status = 'consumed', consumed_at = now()
   where id = v.id;
  insert into public.notification_channels (account_id, channel, external_id, external_label, status, verified_at)
  values (v.account_id, v.channel, p_external_id, p_external_label, 'verified', now())
  on conflict (account_id, channel, external_id) where status <> 'revoked'
  do update set status = 'verified', verified_at = now(),
               external_label = coalesce(excluded.external_label, public.notification_channels.external_label)
  returning id into v_channel_id;
  insert into public.channel_prefs (account_id, channel)
  values (v.account_id, v.channel)
  on conflict (account_id, channel) do nothing;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (v.account_id, 'system', 'service', 'channel.verified', v_channel_id::text,
    jsonb_build_object('channel', v.channel));
  return v_channel_id;
end;
$$;
revoke execute on function public.verify_channel_binding(text, text, text) from public, anon, authenticated;
grant execute on function public.verify_channel_binding(text, text, text) to service_role;
