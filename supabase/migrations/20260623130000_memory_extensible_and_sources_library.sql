-- 20260623130000_memory_extensible_and_sources_library.sql
-- Extends Foundation's field_meta with section identity/order/visibility (custom
-- + renamed/hidden defaults), and sources with file metadata + extraction state
-- for the Sources file library. Purely additive; nullable or defaulted columns.

alter table public.field_meta
  add column label      text    check (label is null or char_length(label) <= 60),
  add column sort_order integer not null default 1000,
  add column is_custom  boolean not null default false,
  add column is_hidden  boolean not null default false;

alter table public.sources
  add column mime_type       text   check (mime_type is null or char_length(mime_type) <= 255),
  add column byte_size       bigint check (byte_size is null or byte_size >= 0),
  add column extraction_state text not null default 'pending'
    check (extraction_state in ('pending','extracting','extracted','unsupported','failed'));

create index sources_account_state_idx on public.sources (account_id, extraction_state);

-- ─────────────────────────────────────────────────────────────────────────────
-- Task 2: upsert_section_meta — create / rename / reorder / hide a section
-- ─────────────────────────────────────────────────────────────────────────────
create function public.upsert_section_meta(
  target_account uuid,
  p_field_key    text,
  p_label        text,
  p_sort_order   integer,
  p_is_custom    boolean,
  p_is_hidden    boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid            uuid    := (select auth.uid());
  existing_count integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if p_is_custom and p_field_key !~ '^c_[a-z0-9_]{1,40}$' then
    raise exception 'invalid custom field key';
  end if;
  if p_label is not null and char_length(p_label) > 60 then
    raise exception 'label too long';
  end if;

  perform pg_advisory_xact_lock(hashtext('grove_memory:' || target_account::text));

  -- enforce 40-section cap on NEW custom rows only
  if p_is_custom and not exists (
    select 1 from public.field_meta
     where account_id = target_account and field_key = p_field_key
  ) then
    select count(*) into existing_count from public.field_meta
      where account_id = target_account and is_custom and not is_hidden;
    if existing_count >= 40 then
      raise exception 'section limit reached (max 40)';
    end if;
  end if;

  insert into public.field_meta (account_id, field_key, label, sort_order, is_custom, is_hidden)
    values (target_account, p_field_key, p_label, coalesce(p_sort_order, 1000), p_is_custom, p_is_hidden)
  on conflict (account_id, field_key) do update
    set label      = excluded.label,
        sort_order = excluded.sort_order,
        is_hidden  = excluded.is_hidden;

  update public.grove_memory set version = version + 1, updated_at = now()
    where account_id = target_account;

  insert into public.grove_memory_history
    (account_id, field_key, old_value, new_value, version, change_source, changed_by)
  values (
    target_account,
    p_field_key,
    null,
    coalesce(p_label, p_field_key),
    coalesce(
      (select version from public.grove_memory where account_id = target_account),
      1
    ),
    'manual',
    uid
  );
end;
$$;

revoke execute on function public.upsert_section_meta(uuid, text, text, integer, boolean, boolean)
  from public, anon, service_role;
grant execute on function public.upsert_section_meta(uuid, text, text, integer, boolean, boolean)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Task 3: delete_custom_section — remove a custom section and its sections key
-- ─────────────────────────────────────────────────────────────────────────────
create function public.delete_custom_section(
  target_account uuid,
  p_field_key    text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  cur_version integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if p_field_key !~ '^c_[a-z0-9_]{1,40}$' then
    raise exception 'not a custom section';
  end if;

  perform pg_advisory_xact_lock(hashtext('grove_memory:' || target_account::text));

  delete from public.field_meta
    where account_id = target_account and field_key = p_field_key;

  update public.grove_memory
    set sections   = sections - p_field_key,
        version    = version + 1,
        updated_at = now()
    where account_id = target_account;

  select version into cur_version
    from public.grove_memory
    where account_id = target_account;

  insert into public.grove_memory_history
    (account_id, field_key, old_value, new_value, version, change_source, changed_by)
  values (
    target_account,
    p_field_key,
    p_field_key,   -- record the key that was deleted as old_value
    null,          -- no new value — section is gone
    coalesce(cur_version, 1),
    'manual',
    uid
  );
end;
$$;

revoke execute on function public.delete_custom_section(uuid, text)
  from public, anon, service_role;
grant execute on function public.delete_custom_section(uuid, text)
  to authenticated;
