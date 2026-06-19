-- Write-to-long-term-memory (Planner `memory.write`): let an agent persist a
-- durable, DERIVED fact/preference/entity for future retrieval. Reuses the
-- #135 memory_entries table + RLS + match_memory RPC verbatim; the ONLY schema
-- change is an additive provenance-of-WRITE column so an agent-written row is
-- distinguishable from one the pipeline ingested after a decision.
--
-- Additive + backfilled-by-default: existing rows (and any write that omits the
-- column) default to 'ingested', preserving the #135 write path's behavior. The
-- agent write path stamps 'agent'. No data migration, no RLS change: writes stay
-- service-role only (authenticated still has insert/update/delete REVOKED from
-- the base migration), per-account RLS still gates reads, the LLM never controls
-- account_id/source/SQL — trusted code sets them.
alter table public.memory_entries
  add column if not exists source text not null default 'ingested'
    check (source in ('ingested', 'agent'));

-- A partial index so the source filter (audit / "what did the agent write")
-- stays cheap without bloating the common account-scoped read path.
create index if not exists memory_entries_agent_src_idx
  on public.memory_entries (account_id, source)
  where source = 'agent';

-- NOTE: no VIEW is added here. If a human-facing "agent-written memory" view is
-- later wanted, create it `with (security_invoker = true)` so it runs under the
-- querying member's RLS (never bypassing the per-account policy).
