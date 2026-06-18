-- Drift nudge (R2) + dignified demotion (CE5) notification surfaces.
-- Adds two notification kinds and a service_role-only insert path (the web
-- server's drift/demotion leaves; clients still cannot insert — see m5 RLS).
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('beat', 'evolution', 'graduation', 'nudge', 'demotion'));

-- Controlled insert for system-authored leaves (drift nudge, demotion echo).
-- security definer + service_role-only: the trusted runtime path inserts; the
-- ON CONFLICT dedupes by (account_id, kind, source_id) so retries never stack.
create or replace function public.insert_system_notification(
  p_account uuid,
  p_kind text,
  p_source_id text,
  p_title text,
  p_body text,
  p_payload jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('nudge', 'demotion') then
    raise exception 'insert_system_notification only authors nudge/demotion, got %', p_kind;
  end if;
  insert into public.notifications (account_id, kind, source_id, title, body, payload)
  values (p_account, p_kind, p_source_id, p_title, p_body, p_payload)
  on conflict (account_id, kind, source_id) do nothing;
end;
$$;
revoke execute on function public.insert_system_notification(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.insert_system_notification(uuid, text, text, text, text, jsonb) to service_role;
