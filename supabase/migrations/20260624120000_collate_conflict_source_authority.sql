-- C1/C2: source_authority — learned per-(account, source_kind) weight.
-- Tasks 2 and 3 RPCs (flag_field_conflict, resolve_field_flag) will be
-- appended to this file in their respective tasks.

-- Task 8: Thread the authority-suggested source through to field_flags so the
-- UI can highlight it without guessing.
alter table public.field_flags
  add column if not exists suggested_source_id uuid;

create table if not exists public.source_authority (
  account_id  uuid not null references public.accounts (id) on delete cascade,
  source_kind text not null check (source_kind in ('document','connector_artifact','observation','manual')),
  weight      numeric not null default 50 check (weight >= 0 and weight <= 100),
  updated_at  timestamptz not null default now(),
  primary key (account_id, source_kind)
);

-- RLS: member-read, no direct client writes (service_role / RPCs only)
alter table public.source_authority enable row level security;

drop policy if exists source_authority_member_read on public.source_authority;
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
--
-- Task 8: p_suggested_source_id (last param, default null) threads the
-- authority-computed suggestion into field_flags.suggested_source_id so the
-- Memory conflict UI can highlight the right source without guessing.
-- Drop the old 5-param overload so Postgres doesn't keep a phantom stub.
drop function if exists public.flag_field_conflict(uuid, text, uuid[], text, text);

create or replace function public.flag_field_conflict(
  p_account              uuid,
  p_field_key            text,
  p_competing_source_ids uuid[],
  p_detail               text,
  p_stakes               text    default 'normal',
  p_suggested_source_id  uuid    default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_stakes not in ('normal', 'high') then
    raise exception 'stakes must be normal or high, got %', p_stakes;
  end if;

  -- Upsert: update if an open flag exists, else insert.
  update public.field_flags
  set competing_source_ids  = p_competing_source_ids,
      detail                = p_detail,
      suggested_source_id   = p_suggested_source_id,
      detected_at           = now()
  where account_id = p_account
    and field_key  = p_field_key
    and status     = 'needs_review'
  returning id into v_id;

  if v_id is null then
    insert into public.field_flags (account_id, field_key, competing_source_ids, detail, suggested_source_id)
    values (p_account, p_field_key, p_competing_source_ids, p_detail, p_suggested_source_id)
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
revoke execute on function public.flag_field_conflict(uuid, text, uuid[], text, text, uuid) from public, anon, authenticated;
grant  execute on function public.flag_field_conflict(uuid, text, uuid[], text, text, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Task 3: resolve_field_flag RPC (member-only)
-- The user's conflict pick IS the approval: writes the chosen value into the
-- curated field, marks the flag resolved, logs the audit trail, and metabolizes
-- the choice into learned source-authority weights.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.resolve_field_flag(
  p_flag_id          uuid,
  p_chosen_source_id uuid,
  p_chosen_value     text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid           uuid := (select auth.uid());
  v_flag        public.field_flags%rowtype;
  cur_sections  jsonb;
  cur_rules     jsonb;
  cur_notes     text;
  new_version   integer;
  old_val       text;
  new_val       text;
  v_chosen_kind text;
  v_comp_id     uuid;
  v_comp_kind   text;
  v_seen_kinds  text[] := '{}';
begin
  -- 1. Auth check
  if uid is null then raise exception 'not authenticated'; end if;

  -- Load the flag with a row-level lock so concurrent resolves are serialized
  select * into v_flag from public.field_flags where id = p_flag_id for update;
  if not found then raise exception 'flag not found'; end if;

  -- Member check
  if not (select private.is_account_member(v_flag.account_id)) then
    raise exception 'not a member of this account';
  end if;

  -- Status guard
  if v_flag.status <> 'needs_review' then
    raise exception 'conflict already resolved';
  end if;

  -- Validate the chosen source is one of this conflict's competing sources.
  -- Guards both authorization (can't ratify an arbitrary/foreign source) and the
  -- NOT-NULL field_evidence(source_id) FK insert below — a bad/null id would
  -- otherwise abort the whole transaction mid-write.
  if p_chosen_source_id is null
     or not (p_chosen_source_id = any(v_flag.competing_source_ids)) then
    raise exception 'chosen source is not among this conflict''s competing sources';
  end if;

  -- 3. Advisory lock so we don't race with save_grove_memory / decide_memory_proposal
  perform pg_advisory_xact_lock(hashtext('grove_memory:' || v_flag.account_id::text));

  -- 4. Write p_chosen_value to the curated field using the same dispatch as
  --    decide_memory_proposal's approve branch (replace semantics — user picked).
  --    Ensure the grove_memory row exists first.
  insert into public.grove_memory (account_id, sections, hard_rules, notes)
    values (v_flag.account_id, '{}'::jsonb, '[]'::jsonb, null)
    on conflict (account_id) do nothing;

  select sections, hard_rules, notes
    into cur_sections, cur_rules, cur_notes
    from public.grove_memory
    where account_id = v_flag.account_id;

  if v_flag.field_key = 'notes' then
    old_val := cur_notes;
    new_val := p_chosen_value;  -- replace semantics
    -- append-overflow guard (matches decide_memory_proposal)
    if char_length(new_val) > 6000 then
      raise exception 'value would exceed field size limit (% chars)', char_length(new_val);
    end if;
    update public.grove_memory
      set notes = new_val, version = version + 1, updated_at = now()
      where account_id = v_flag.account_id
      returning version into new_version;

  elsif v_flag.field_key = 'hard_rules' then
    old_val := array_to_string(
      array(select jsonb_array_elements_text(coalesce(cur_rules, '[]'::jsonb))),
      E'\n'
    );
    new_val := p_chosen_value;  -- replace semantics
    if char_length(new_val) > 6000 then
      raise exception 'value would exceed field size limit (% chars)', char_length(new_val);
    end if;
    update public.grove_memory
      set hard_rules = to_jsonb(string_to_array(new_val, E'\n')),
          version    = version + 1,
          updated_at = now()
      where account_id = v_flag.account_id
      returning version into new_version;

  else
    old_val := cur_sections ->> v_flag.field_key;
    new_val := p_chosen_value;  -- replace semantics
    if char_length(new_val) > 6000 then
      raise exception 'value would exceed field size limit (% chars)', char_length(new_val);
    end if;
    update public.grove_memory
      set sections   = jsonb_set(coalesce(sections, '{}'::jsonb),
                                 array[v_flag.field_key], to_jsonb(new_val), true),
          version    = version + 1,
          updated_at = now()
      where account_id = v_flag.account_id
      returning version into new_version;
  end if;

  -- Append-only history with change_source='conflict'
  insert into public.grove_memory_history
    (account_id, field_key, old_value, new_value, version, change_source, changed_by)
    values (v_flag.account_id, v_flag.field_key, old_val, new_val, new_version, 'conflict', uid);

  -- Stamp field_meta staleness anchor
  insert into public.field_meta (account_id, field_key, last_reviewed_at)
    values (v_flag.account_id, v_flag.field_key, now())
    on conflict (account_id, field_key) do update set last_reviewed_at = now();

  -- Record the chosen source as supporting evidence
  insert into public.field_evidence (account_id, field_key, source_id, relationship)
    values (v_flag.account_id, v_flag.field_key, p_chosen_source_id, 'supports')
    on conflict (account_id, field_key, source_id) do nothing;

  -- 5. Mark the flag resolved
  update public.field_flags
    set status      = 'resolved',
        resolved_at = now(),
        resolution  = p_chosen_source_id::text
    where id = p_flag_id;

  -- 6. Audit log (Trust Ledger)
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (
      v_flag.account_id,
      'user',
      uid::text,
      'memory.ratified',
      v_flag.field_key,
      jsonb_build_object(
        'field_flag_id',    p_flag_id,
        'chosen_source_id', p_chosen_source_id,
        'decision',         'conflict_resolved'
      )
    );

  -- 7. Learn: seed authority rows then nudge weights
  perform public.ensure_source_authority(v_flag.account_id);

  -- Look up the chosen source's kind and bump its weight
  select kind into v_chosen_kind
    from public.sources
    where id = p_chosen_source_id;

  if v_chosen_kind is not null then
    update public.source_authority
      set weight     = least(100, weight + 5),
          updated_at = now()
      where account_id = v_flag.account_id
        and source_kind = v_chosen_kind;

    v_seen_kinds := array_append(v_seen_kinds, v_chosen_kind);
  end if;

  -- Lower each competing source's kind weight (skip chosen kind; de-dupe kinds)
  foreach v_comp_id in array coalesce(v_flag.competing_source_ids, '{}')
  loop
    -- Skip the chosen source itself
    if v_comp_id = p_chosen_source_id then
      continue;
    end if;

    select kind into v_comp_kind
      from public.sources
      where id = v_comp_id;

    -- Skip if we can't find the source or the kind was already processed
    if v_comp_kind is null then
      continue;
    end if;
    if v_comp_kind = any(v_seen_kinds) then
      continue;
    end if;

    update public.source_authority
      set weight     = greatest(0, weight - 5),
          updated_at = now()
      where account_id = v_flag.account_id
        and source_kind = v_comp_kind;

    v_seen_kinds := array_append(v_seen_kinds, v_comp_kind);
  end loop;

  -- 8. Mark the associated review_item notification as read
  update public.notifications
    set read_at = now()
    where account_id = v_flag.account_id
      and kind      = 'review_item'
      and source_id = p_flag_id::text
      and read_at is null;

end; $$;

-- Grant: authenticated members only; revoke from everything else
revoke execute on function public.resolve_field_flag(uuid, uuid, text) from public, anon, service_role;
grant  execute on function public.resolve_field_flag(uuid, uuid, text) to authenticated;
