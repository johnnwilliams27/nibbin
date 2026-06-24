-- C1/C2: source_authority — learned per-(account, source_kind) weight.
-- Tasks 2 and 3 RPCs (flag_field_conflict, resolve_field_flag) will be
-- appended to this file in their respective tasks.

create table public.source_authority (
  account_id  uuid not null references public.accounts (id) on delete cascade,
  source_kind text not null check (source_kind in ('document','connector_artifact','observation','manual')),
  weight      numeric not null default 50 check (weight >= 0 and weight <= 100),
  updated_at  timestamptz not null default now(),
  primary key (account_id, source_kind)
);

-- RLS: member-read, no direct client writes (service_role / RPCs only)
alter table public.source_authority enable row level security;

create policy source_authority_member_read on public.source_authority
  for select to authenticated
  using ((select private.is_account_member(account_id)));

revoke all on public.source_authority from anon;
revoke insert, update, delete, truncate, references, trigger on public.source_authority from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Task 2: ensure_source_authority + flag_field_conflict RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- Seed the 4 source-kind weights for an account (idempotent via DO NOTHING).
-- Called by Task 3's resolve_field_flag to guarantee rows exist before learning.
create or replace function public.ensure_source_authority(
  p_account uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.source_authority (account_id, source_kind, weight)
  values
    (p_account, 'document',           70),
    (p_account, 'manual',             65),
    (p_account, 'connector_artifact', 50),
    (p_account, 'observation',        40)
  on conflict (account_id, source_kind) do nothing;
end; $$;
revoke execute on function public.ensure_source_authority(uuid) from public, anon, authenticated;
grant  execute on function public.ensure_source_authority(uuid) to service_role;

-- Surface a field conflict as a persistent flag + notification.
-- Idempotent: if an open needs_review flag already exists for (account, field_key),
-- update it in place (the unique index field_flags_one_open_idx enforces at most
-- one open flag per field). Returns the flag id.
create or replace function public.flag_field_conflict(
  p_account              uuid,
  p_field_key            text,
  p_competing_source_ids uuid[],
  p_detail               text,
  p_stakes               text default 'normal'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_stakes not in ('normal', 'high') then
    raise exception 'stakes must be normal or high, got %', p_stakes;
  end if;

  -- Upsert: update if an open flag exists, else insert.
  update public.field_flags
  set competing_source_ids = p_competing_source_ids,
      detail               = p_detail,
      detected_at          = now()
  where account_id = p_account
    and field_key  = p_field_key
    and status     = 'needs_review'
  returning id into v_id;

  if v_id is null then
    insert into public.field_flags (account_id, field_key, competing_source_ids, detail)
    values (p_account, p_field_key, p_competing_source_ids, p_detail)
    returning id into v_id;
  end if;

  perform public.insert_system_notification(
    p_account,
    'review_item',
    v_id::text,
    'A conflict needs your review',
    p_detail,
    jsonb_build_object('field_flag_id', v_id, 'field_key', p_field_key, 'kind', 'conflict'),
    p_stakes
  );

  return v_id;
end; $$;
revoke execute on function public.flag_field_conflict(uuid, text, uuid[], text, text) from public, anon, authenticated;
grant  execute on function public.flag_field_conflict(uuid, text, uuid[], text, text) to service_role;
