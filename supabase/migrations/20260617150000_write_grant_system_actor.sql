-- The write-grant audit trigger hardcoded actor='user' for every grant, so an
-- auto-grant created during a Senior promotion (no human actor, granted_by null)
-- was mislabeled as a user action and logged actor_id='service'. Attribute a
-- null granted_by as actor='system' (an existing audit_log.actor enum value) so
-- the trail honestly distinguishes system-initiated grants from human ones. A
-- human-initiated grant (granted_by set) still logs actor='user' with the id.
-- granted_by itself stays nullable: a null genuinely means "no granting human".

create or replace function private.log_write_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    new.account_id,
    case when new.granted_by is null then 'system' else 'user' end,
    coalesce(new.granted_by::text, 'service'),
    'nibbin.write_granted', new.nibbin_id::text,
    jsonb_build_object('capability', new.capability, 'connection_id', new.connection_id)
  );
  return new;
end;
$$;
