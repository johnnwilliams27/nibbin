-- Company Brain Foundation (F1): evidence/Sources store, typed claim->evidence
-- link, per-field provenance/staleness, append-only curated history, and the
-- conflict-flag seam. Side tables around grove_memory (the value store stays
-- the free-text JSONB it is). Conventions follow M1/M7: RLS member-read, zero
-- direct client writes, bounded sizes.

-- 1.1 sources — the evidence / Repository store
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind text not null check (kind in ('document','connector_artifact','observation','manual')),
  title text not null check (char_length(title) <= 300),
  storage_path text check (storage_path is null or char_length(storage_path) <= 1024),
  origin jsonb not null default '{}'::jsonb check (jsonb_typeof(origin)='object' and pg_column_size(origin) <= 16384),
  source_tier smallint not null default 50 check (source_tier between 0 and 100),
  captured_at timestamptz not null default now(),
  redaction_status text not null default 'clean' check (redaction_status in ('clean','redacted','quarantined')),
  created_at timestamptz not null default now()
);
create index sources_account_captured_idx on public.sources (account_id, captured_at desc);
create index sources_account_kind_idx on public.sources (account_id, kind);

-- 1.2 field_evidence — typed claim->evidence link (many-to-many)
create table public.field_evidence (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  field_key text not null check (char_length(field_key) <= 64),
  source_id uuid not null references public.sources (id) on delete cascade,
  relationship text not null default 'supports' check (relationship in ('supports','contradicts','superseded')),
  created_at timestamptz not null default now(),
  unique (account_id, field_key, source_id)
);
create index field_evidence_field_idx on public.field_evidence (account_id, field_key);

-- 1.3 field_meta — per-field staleness anchor (one row per field)
create table public.field_meta (
  account_id uuid not null references public.accounts (id) on delete cascade,
  field_key text not null check (char_length(field_key) <= 64),
  last_reviewed_at timestamptz,
  primary key (account_id, field_key)
);

-- 1.4 grove_memory_history — append-only per-field trail
create table public.grove_memory_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  field_key text not null check (char_length(field_key) <= 64),
  old_value text,
  new_value text,
  version integer not null,
  change_source text not null check (change_source in ('manual','proposal','sweep','conflict')),
  proposal_id uuid,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index gmh_account_field_idx on public.grove_memory_history (account_id, field_key, changed_at desc);
create trigger grove_memory_history_append_only
  before update or delete on public.grove_memory_history
  for each row execute function private.raise_append_only();

-- 1.5 field_flags — persistent conflict state (C2 populates)
create table public.field_flags (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  field_key text not null check (char_length(field_key) <= 64),
  status text not null default 'needs_review' check (status in ('needs_review','resolved','dismissed')),
  competing_source_ids uuid[] not null default '{}',
  detail text check (detail is null or char_length(detail) <= 1000),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create unique index field_flags_one_open_idx on public.field_flags (account_id, field_key) where (status = 'needs_review');

-- RLS: member-read, no direct client writes (service role / RPCs only)
do $$
declare t text;
begin
  foreach t in array array['sources','field_evidence','field_meta','grove_memory_history','field_flags'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %1$s_member_read on public.%1$s for select to authenticated using ((select private.is_account_member(account_id)))$p$, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
  end loop;
end $$;
