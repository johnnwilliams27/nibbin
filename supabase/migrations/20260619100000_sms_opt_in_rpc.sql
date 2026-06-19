-- SMS START re-subscribe RPC (TCPA). Reactivates every revoked sms binding for
-- the given phone number and writes an audit_log row. SERVICE-ROLE ONLY — called
-- by the inbound SMS webhook after a verified START keyword; the sender is never
-- authenticated. account_id on audit_log may be null when no revoked binding
-- exists (the audit_log.account_id FK allows null — see m1 migration). We write
-- a row regardless so the re-subscribe attempt is unconditionally recorded.
-- Mirrors public.sms_opt_out exactly: same audit_log column list, same
-- blank-guard, same grant/revoke style. verified_at is kept unchanged; only
-- revoked_at is cleared.

create or replace function public.sms_opt_in(p_external_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if btrim(p_external_id) = '' then
    raise exception 'p_external_id must not be blank';
  end if;

  -- Reactivate every revoked sms binding for this number, one at a time so we
  -- can write a per-account audit row (TCPA record-keeping).
  for v_row in
    select id, account_id
      from public.notification_channels
     where channel = 'sms'
       and external_id = p_external_id
       and status = 'revoked'
  loop
    update public.notification_channels
       set status = 'verified', revoked_at = null
     where id = v_row.id;

    insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (v_row.account_id, 'system', 'sms_webhook',
            'channel.sms_opt_in', v_row.id::text,
            jsonb_build_object('external_id', p_external_id, 'channel', 'sms'));
  end loop;

  -- If no revoked binding existed, still record the re-subscribe attempt
  -- (account_id null).
  if not found then
    insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (null, 'system', 'sms_webhook',
            'channel.sms_opt_in', null,
            jsonb_build_object('external_id', p_external_id, 'channel', 'sms', 'no_binding', true));
  end if;
end;
$$;

-- Restrict to service_role only — no user or anon should invoke this directly.
revoke execute on function public.sms_opt_in(text) from public, anon, authenticated;
grant execute on function public.sms_opt_in(text) to service_role;
