-- P4 Nango connector lane: store Nango's connection identifiers on the connections row.
-- For [N] providers these are non-null; for [H]/[G]/[A] rows both columns are null.
--
-- We also extend the method check constraint to accept 'N' (Nango-managed OAuth).
-- The original constraint was: check (method in ('A', 'H', 'G'))

-- 1. Extend the method check constraint to accept 'N'.
alter table public.connections
  drop constraint if exists connections_method_check;

alter table public.connections
  add constraint connections_method_check
    check (method in ('A', 'H', 'G', 'N'));

-- 2. Add the two nullable Nango identifier columns.
alter table public.connections
  add column if not exists nango_connection_id text,
  add column if not exists nango_provider_config_key text;

comment on column public.connections.nango_connection_id is
  'Nango opaque connection identifier — non-null for method=N connectors only.';

comment on column public.connections.nango_provider_config_key is
  'Nango integration key (e.g. ''google-mail'') — non-null for method=N connectors only.';
