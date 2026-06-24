-- source_chunks: one row per chunk produced at ingest time (P2).
-- P5 only reads; writes are P2's job. Embedding may be null (no VOYAGE_API_KEY).
create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  text text not null check (btrim(text) <> '' and char_length(text) <= 2400),
  token_count integer not null check (token_count > 0 and token_count <= 600),
  fts tsvector generated always as (to_tsvector('english', text)) stored,
  embedding public.vector(1024),
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);
create index source_chunks_account_idx on public.source_chunks (account_id);
create index source_chunks_fts_idx on public.source_chunks using gin (fts);
create index source_chunks_embedding_idx on public.source_chunks
  using hnsw (embedding public.vector_cosine_ops);

-- RLS: member-read, no authenticated writes (identical pattern to memory_entries).
alter table public.source_chunks enable row level security;
create policy "members read own account chunks"
  on public.source_chunks for select
  to authenticated
  using ((select private.is_account_member(account_id)));
-- Revoke all from anon (default-privileges grant select; we want anon to get
-- nothing, consistent with memory_entries).
revoke all on public.source_chunks from anon;
revoke insert, update, delete on public.source_chunks from authenticated;

-- match_sources: hybrid retrieval over source_chunks + sources join.
-- 60/25/10/5 weighting: semantic + FTS + recency + source_tier bonus.
-- Mirrors match_memory shape; service_role-only.
--
-- Uses a subquery to filter by score (avoids HAVING on a computed alias,
-- which is unsupported in some Postgres versions when the expression is not
-- a simple column reference).
create function public.match_sources(
  p_account   uuid,
  p_embedding text,     -- postgres vector literal '[x,y,...]' or null
  p_query     text,
  p_limit     integer  default 6,
  p_min_score numeric  default 0.25
) returns table (
  chunk_id     uuid,
  source_id    uuid,
  source_title text,
  source_tier  smallint,
  text         text,
  score        numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select chunk_id, source_id, source_title, source_tier, text, score
  from (
    select
      sc.id                                                    as chunk_id,
      s.id                                                     as source_id,
      s.title                                                  as source_title,
      s.source_tier                                            as source_tier,
      sc.text                                                  as text,
      round((
        (case
          when p_embedding is not null
               and btrim(p_embedding) <> ''
               and sc.embedding is not null
          then 0.60 * (1 - (sc.embedding operator(public.<=>) p_embedding::public.vector(1024)))
          else 0.0
        end)
        + (case
            when btrim(coalesce(p_query, '')) <> ''
            then 0.25 * least(ts_rank(sc.fts, plainto_tsquery('english', p_query)), 1.0)
            else 0.0
           end)
        + 0.10 * exp(- extract(epoch from now() - s.captured_at) / (30 * 86400.0))
        + 0.05 * (s.source_tier::numeric / 100.0)
      )::numeric, 4)                                          as score
    from public.source_chunks sc
    join public.sources s on s.id = sc.source_id
    where sc.account_id = p_account
  ) ranked
  where score >= p_min_score
  order by score desc
  limit greatest(coalesce(p_limit, 6), 1);
$$;

revoke execute on function public.match_sources(uuid, text, text, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.match_sources(uuid, text, text, integer, numeric)
  to service_role;
