-- P2: Document Ingestion — Foundation Minors + queue table + bucket bootstrap
--
-- Closes two deferred Foundation Minors:
--   1. proposals_value_nonempty CHECK — blank/whitespace proposed_value rejected at DB level
--   2. propose_memory_change blank guard — RPC raises 'blank' before insert
--   3. decide_memory_proposal append-overflow guard — raises 'exceed' when append > 6000 chars
--
-- Adds source_extraction_jobs queue table (avoids Vercel 60s timeout for long extractions)
--
-- NOTE: The `brain-sources` Storage bucket is a Supabase-managed resource and cannot be
-- created via Postgres DDL. Run the bootstrap script against each environment before the
-- upload route goes live:
--
--   npx tsx scripts/bootstrap-brain-sources-bucket.ts
--
-- The script reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env and calls
-- supabase.storage.createBucket('brain-sources', { public: false, fileSizeLimit: 20971520 }).

-- 1. proposals_value_nonempty CHECK (additive — no existing rows have blank values)
alter table public.proposals
  add constraint proposals_value_nonempty
  check (char_length(trim(proposed_value)) > 0);

-- 2. propose_memory_change: add blank-value guard (create or replace — preserves all behavior + grants)
create or replace function public.propose_memory_change(
  p_account uuid, p_field_key text, p_op text, p_value text, p_rationale text, p_source_id uuid, p_origin text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  -- Foundation Minor: blank proposed_value guard
  if trim(p_value) = '' then
    raise exception 'proposed_value must not be blank';
  end if;

  if p_source_id is not null and exists (
    select 1 from public.sources s where s.id = p_source_id and s.redaction_status = 'quarantined'
  ) then
    raise exception 'cannot propose from a quarantined source';
  end if;
  insert into public.proposals (account_id, field_key, op, proposed_value, rationale, source_id, origin)
    values (p_account, p_field_key, coalesce(p_op,'replace'), p_value, p_rationale, p_source_id, p_origin)
    returning id into new_id;
  perform public.insert_system_notification(
    p_account, 'review_item', new_id::text,
    'A suggested update to your memory', coalesce(p_rationale, 'Review a proposed change to ' || p_field_key),
    jsonb_build_object('proposal_id', new_id, 'field_key', p_field_key));
  return new_id;
end; $$;
revoke execute on function public.propose_memory_change(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.propose_memory_change(uuid, text, text, text, text, uuid, text) to service_role;

-- 3. decide_memory_proposal: add append-overflow guard on all three field branches
-- (create or replace — preserves all behavior + grants)
create or replace function public.decide_memory_proposal(p_proposal_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  p public.proposals%rowtype;
  cur_sections jsonb; cur_rules jsonb; cur_notes text; new_version integer;
  old_val text; new_val text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'decision must be approved or rejected'; end if;
  select * into p from public.proposals where id = p_proposal_id for update;
  if not found then raise exception 'proposal not found'; end if;
  if not (select private.is_account_member(p.account_id)) then raise exception 'not a member of this account'; end if;
  if p.status <> 'pending' then raise exception 'proposal already decided'; end if;

  perform pg_advisory_xact_lock(hashtext('grove_memory:' || p.account_id::text));

  if p_decision = 'approved' then
    insert into public.grove_memory (account_id, sections, hard_rules, notes) values (p.account_id, '{}'::jsonb, '[]'::jsonb, null)
      on conflict (account_id) do nothing;
    select sections, hard_rules, notes into cur_sections, cur_rules, cur_notes from public.grove_memory where account_id = p.account_id;

    if p.field_key = 'notes' then
      old_val := cur_notes;
      if p.op = 'append' then
        new_val := case when old_val is not null then old_val || E'\n' || p.proposed_value else p.proposed_value end;
        -- Foundation Minor: append-overflow guard
        if char_length(new_val) > 6000 then
          raise exception 'append would exceed field size limit (% chars); reject or replace instead',
            char_length(new_val);
        end if;
      else
        new_val := p.proposed_value;
      end if;
      update public.grove_memory set notes = new_val, version = version + 1, updated_at = now()
        where account_id = p.account_id returning version into new_version;

    elsif p.field_key = 'hard_rules' then
      old_val := array_to_string(array(select jsonb_array_elements_text(coalesce(cur_rules,'[]'::jsonb))), E'\n');
      if p.op = 'append' then
        new_val := case when nullif(old_val,'') is not null then old_val || E'\n' || p.proposed_value else p.proposed_value end;
        -- Foundation Minor: append-overflow guard
        if char_length(new_val) > 6000 then
          raise exception 'append would exceed field size limit (% chars); reject or replace instead',
            char_length(new_val);
        end if;
      else
        new_val := p.proposed_value;
      end if;
      update public.grove_memory
        set hard_rules = to_jsonb(string_to_array(new_val, E'\n')), version = version + 1, updated_at = now()
        where account_id = p.account_id returning version into new_version;

    else
      old_val := cur_sections->>p.field_key;
      if p.op = 'append' then
        new_val := case when old_val is not null then old_val || E'\n' || p.proposed_value else p.proposed_value end;
        -- Foundation Minor: append-overflow guard
        if char_length(new_val) > 6000 then
          raise exception 'append would exceed field size limit (% chars); reject or replace instead',
            char_length(new_val);
        end if;
      else
        new_val := p.proposed_value;
      end if;
      update public.grove_memory
        set sections = jsonb_set(coalesce(sections,'{}'::jsonb), array[p.field_key], to_jsonb(new_val), true),
            version = version + 1, updated_at = now()
        where account_id = p.account_id returning version into new_version;
    end if;

    insert into public.grove_memory_history (account_id, field_key, old_value, new_value, version, change_source, proposal_id, changed_by)
      values (p.account_id, p.field_key, old_val, new_val, new_version,
              case when p.origin='conflict' then 'conflict' else 'proposal' end, p.id, uid);
    insert into public.field_meta (account_id, field_key, last_reviewed_at) values (p.account_id, p.field_key, now())
      on conflict (account_id, field_key) do update set last_reviewed_at = now();
    if p.source_id is not null then
      insert into public.field_evidence (account_id, field_key, source_id, relationship)
        values (p.account_id, p.field_key, p.source_id, 'supports')
        on conflict (account_id, field_key, source_id) do nothing;
    end if;
  end if;

  -- log the ratification (Trust Ledger substrate) for BOTH approve and reject
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (p.account_id, 'user', uid::text, 'memory.ratified', p.field_key,
            jsonb_build_object('proposal_id', p.id, 'decision', p_decision, 'source_id', p.source_id, 'origin', p.origin));

  update public.proposals set status = p_decision, decided_at = now(), decided_by = uid where id = p.id and status = 'pending';
  update public.notifications set read_at = now()
    where account_id = p.account_id and kind = 'review_item' and source_id = p.id::text and read_at is null;
end; $$;
revoke execute on function public.decide_memory_proposal(uuid, text) from public, anon, service_role;
grant execute on function public.decide_memory_proposal(uuid, text) to authenticated;

-- 4. source_extraction_jobs — queue table for async document extraction
create table public.source_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','processing','done','error')),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  enqueued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index sej_account_status_idx on public.source_extraction_jobs (account_id, status, enqueued_at);
create index sej_source_idx on public.source_extraction_jobs (source_id);

-- RLS: member-read, no direct client writes (service role only)
alter table public.source_extraction_jobs enable row level security;
create policy source_extraction_jobs_member_read on public.source_extraction_jobs
  for select to authenticated
  using ((select private.is_account_member(account_id)));
revoke all on public.source_extraction_jobs from anon;
revoke insert, update, delete, truncate, references, trigger on public.source_extraction_jobs from authenticated;
