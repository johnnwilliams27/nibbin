-- Agent + user memory (§12A): derived-not-raw facts/preferences/entities,
-- embedded (Voyage voyage-3, 1024-dim) for semantic retrieval. RLS per-account;
-- writes service-role only; never crosses users.
create extension if not exists vector;

create table public.memory_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  scope text not null check (scope in ('agent', 'user')),
  nibbin_id uuid references public.nibbins (id) on delete cascade,
  user_id uuid references public.users (id) on delete cascade,
  kind text not null check (kind in ('fact', 'preference', 'entity')),
  text text not null check (btrim(text) <> '' and char_length(text) <= 400),
  provenance text not null check (provenance in ('observed', 'user-stated', 'inferred')),
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  source_run_id uuid references public.runs (id) on delete set null,
  fts tsvector generated always as (to_tsvector('english', text)) stored,
  embedding vector(1024),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  -- scope integrity: agent rows carry a nibbin, user rows carry a user.
  constraint memory_scope_owner check (
    (scope = 'agent' and nibbin_id is not null) or
    (scope = 'user'  and user_id is not null)
  )
);

-- Dedupe anchor: one entry per (account, scope, owner, kind, normalized text).
create unique index memory_entries_dedupe on public.memory_entries
  (account_id, scope, coalesce(nibbin_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, lower(text));
create index memory_entries_account_idx on public.memory_entries (account_id, scope);
create index memory_entries_fts_idx on public.memory_entries using gin (fts);
create index memory_entries_embedding_idx on public.memory_entries
  using hnsw (embedding vector_cosine_ops);

alter table public.memory_entries enable row level security;
create policy memory_member_read on public.memory_entries
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke insert, update, delete, truncate, references, trigger
  on public.memory_entries from authenticated;
revoke all on public.memory_entries from anon;

-- Hybrid retrieval (semantic + full-text + recency), service-role only. Scoped
-- to ONE account; returns agent memory for p_nibbin ∪ the account's user memory.
-- p_embedding is TEXT (a Postgres vector literal '[...]', or null): supabase-js
-- cannot reliably pass a JS number[] to a `vector` RPC param, so the client
-- formats the query vector as a literal and we cast it here. Null/empty (no
-- Voyage key) → the semantic term is 0 and ranking falls back to FTS + recency.
create function public.match_memory(
  p_account uuid,
  p_nibbin uuid,
  p_embedding text,
  p_query text,
  p_limit integer default 8,
  p_min_confidence numeric default 0.3
) returns table (id uuid, scope text, kind text, text text, provenance text, confidence numeric, score numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.scope, m.kind, m.text, m.provenance, m.confidence,
         ( 0.60 * case when p_embedding is not null and btrim(p_embedding) <> '' and m.embedding is not null
                       then 1 - (m.embedding operator(public.<=>) p_embedding::public.vector(1024)) else 0 end
         + 0.25 * case when btrim(coalesce(p_query, '')) <> ''
                       then least(ts_rank(m.fts, plainto_tsquery('english', p_query)), 1.0) else 0 end
         + 0.15 * exp(- extract(epoch from now() - m.last_seen_at) / (30 * 86400.0))
         )::numeric as score
    from public.memory_entries m
   where m.account_id = p_account
     and (m.scope = 'user' or (m.scope = 'agent' and m.nibbin_id = p_nibbin))
     and m.confidence >= p_min_confidence
     and (m.expires_at is null or m.expires_at > now())
   order by score desc
   limit greatest(coalesce(p_limit, 8), 1);
$$;
revoke execute on function public.match_memory(uuid, uuid, text, text, integer, numeric) from public, anon, authenticated;
grant execute on function public.match_memory(uuid, uuid, text, text, integer, numeric) to service_role;
