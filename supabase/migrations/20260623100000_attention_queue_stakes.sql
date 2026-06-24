-- P6 Task 0: Add stakes column to notifications + extend RPC signatures.
-- All changes are additive and backward-compatible (new params have defaults).

-- 0a. Add stakes column (DEFAULT 'normal' covers all existing rows).
alter table public.notifications
  add column stakes text not null default 'normal'
  check (stakes in ('normal', 'high'));

-- 0b. Replace insert_system_notification with 7-arg signature.
-- PostgreSQL function identity includes arg list, so we must explicitly
-- drop the old 6-arg overload before creating the 7-arg replacement.
-- Cascade drops the grant on the old signature; we re-grant the new one.
drop function if exists public.insert_system_notification(uuid, text, text, text, text, jsonb);

create or replace function public.insert_system_notification(
  p_account   uuid,
  p_kind      text,
  p_source_id text,
  p_title     text,
  p_body      text,
  p_payload   jsonb  default '{}'::jsonb,
  p_stakes    text   default 'normal'
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('nudge', 'demotion', 'review_item') then
    raise exception 'insert_system_notification only authors nudge/demotion/review_item, got %', p_kind;
  end if;
  if p_stakes not in ('normal', 'high') then
    raise exception 'stakes must be normal or high, got %', p_stakes;
  end if;
  insert into public.notifications (account_id, kind, source_id, title, body, payload, stakes)
    values (p_account, p_kind, p_source_id, p_title, p_body, p_payload, p_stakes)
    on conflict (account_id, kind, source_id) do nothing;
end; $$;
revoke execute on function public.insert_system_notification(uuid, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant  execute on function public.insert_system_notification(uuid, text, text, text, text, jsonb, text) to service_role;

-- 0c. Replace propose_memory_change with 8-arg signature.
-- Foundation used plain `create function` (not create or replace), so we
-- must drop the 7-arg version before creating the 8-arg replacement.
drop function if exists public.propose_memory_change(uuid, text, text, text, text, uuid, text);

create or replace function public.propose_memory_change(
  p_account   uuid,
  p_field_key text,
  p_op        text,
  p_value     text,
  p_rationale text,
  p_source_id uuid,
  p_origin    text,
  p_stakes    text   default 'normal'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if p_source_id is not null and exists (
    select 1 from public.sources s where s.id = p_source_id and s.redaction_status = 'quarantined'
  ) then
    raise exception 'cannot propose from a quarantined source';
  end if;
  insert into public.proposals (account_id, field_key, op, proposed_value, rationale, source_id, origin)
    values (p_account, p_field_key, coalesce(p_op, 'replace'), p_value, p_rationale, p_source_id, p_origin)
    returning id into new_id;
  perform public.insert_system_notification(
    p_account, 'review_item', new_id::text,
    'A suggested update to your memory', coalesce(p_rationale, 'Review a proposed change to ' || p_field_key),
    jsonb_build_object('proposal_id', new_id, 'field_key', p_field_key),
    p_stakes);
  return new_id;
end; $$;
revoke execute on function public.propose_memory_change(uuid, text, text, text, text, uuid, text, text) from public, anon, authenticated;
grant  execute on function public.propose_memory_change(uuid, text, text, text, text, uuid, text, text) to service_role;
