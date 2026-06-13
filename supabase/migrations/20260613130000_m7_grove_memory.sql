-- M7: Grove Memory (SPEC §4.8) — the per-account "business brain" shared by every
-- agent: structured sections (facts, pricing, policies, faq, voice), hard rules
-- enforced as draft-time constraints, and freeform notes. Populated initially by
-- the Keeper interview / Day-One scan, then user-curated, and injected into every
-- agent draft by the router (apps/web/lib/llm/drafting.ts).
--
-- Conventions follow M1/M2: RLS member read, zero direct client writes, all
-- mutation through one security-definer RPC that re-checks membership; bounded
-- sizes; a version counter bumped on every save (a full history table is a
-- later iteration — "min" keeps the counter + updated_at).

create table public.grove_memory (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  -- soft sections: a json object like { facts, pricing, policies, faq, voice },
  -- each value a string. Extensible — add sections, don't restructure (SPEC §9).
  sections jsonb not null default '{}'::jsonb check (
    jsonb_typeof(sections) = 'object' and pg_column_size(sections) <= 32768
  ),
  -- hard rules: a json array of short imperative strings, enforced as draft
  -- constraints (not suggestions).
  hard_rules jsonb not null default '[]'::jsonb check (
    jsonb_typeof(hard_rules) = 'array' and pg_column_size(hard_rules) <= 8192
  ),
  notes text check (notes is null or char_length(notes) <= 8000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.grove_memory enable row level security;

create policy grove_memory_member_read on public.grove_memory
  for select to authenticated
  using ((select private.is_account_member(account_id)));

-- anon touches nothing; clients never write directly (RPC below or service role).
revoke all on public.grove_memory from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.grove_memory from authenticated;

-- ── the single client write path ─────────────────────────────────────────────
-- Upsert with a membership re-check and a per-account advisory lock; the version
-- counter bumps on every save so a future history table has a monotonic anchor.
create function public.save_grove_memory(
  target_account uuid,
  new_sections jsonb,
  new_hard_rules jsonb,
  new_notes text
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
  if new_sections is null or jsonb_typeof(new_sections) <> 'object' or pg_column_size(new_sections) > 32768 then
    raise exception 'sections must be a json object under 32KB';
  end if;
  if new_hard_rules is null or jsonb_typeof(new_hard_rules) <> 'array' or pg_column_size(new_hard_rules) > 8192 then
    raise exception 'hard_rules must be a json array under 8KB';
  end if;
  if new_notes is not null and char_length(new_notes) > 8000 then
    raise exception 'notes too long';
  end if;

  perform pg_advisory_xact_lock(hashtext('grove_memory:' || target_account::text));

  insert into public.grove_memory (account_id, sections, hard_rules, notes)
    values (target_account, new_sections, new_hard_rules, new_notes)
  on conflict (account_id) do update
    set sections = excluded.sections,
        hard_rules = excluded.hard_rules,
        notes = excluded.notes,
        version = public.grove_memory.version + 1,
        updated_at = now();
end;
$$;

revoke execute on function public.save_grove_memory(uuid, jsonb, jsonb, text) from public, anon, service_role;
grant execute on function public.save_grove_memory(uuid, jsonb, jsonb, text) to authenticated;
