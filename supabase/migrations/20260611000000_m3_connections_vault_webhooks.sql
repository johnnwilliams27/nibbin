-- M3: connections, vault token storage, webhook idempotency.
-- SPEC §6.1 (connections sketch), §6.5 (OAuth/webhooks), C8/C9 (read-only
-- default scopes; tokens in vault only, never app DB; revocation cascades).
-- Verified by packages/connectors/test/db.integration.test.ts.
--
-- Conventions follow the M1 migration: RLS on every account-scoped table,
-- client roles get SELECT through membership policies only, all client writes
-- go through security-definer functions or the service role, anon gets nothing.

-- ── connections (§6.1) ───────────────────────────────────────────────────────
-- token_ref is a uuid pointing into vault.secrets — the column physically
-- cannot hold token material (C9). webhook_state carries cursors/channel ids
-- only; the check below rejects token-shaped keys so a future bug can't park
-- credentials there.

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider text not null check (btrim(provider) <> ''),
  method text not null check (method in ('A', 'H', 'G')),
  -- granted scopes as recorded at consent time; Day One connects are read-only
  -- (C8) — enforced where scopes are *requested* (packages/connectors oauth
  -- engine + registry), recorded here for display and audit.
  scopes text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'active', 'paused', 'error', 'revoked')),
  token_ref uuid,
  webhook_state jsonb not null default '{}'::jsonb
    check (not (webhook_state ?| array[
      'access_token', 'refresh_token', 'token', 'client_secret', 'api_key', 'password'
    ])),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint connections_revoked_consistent
    check ((status = 'revoked') = (revoked_at is not null)),
  -- a revoked connection must not retain a vault reference (revoke cascades)
  constraint connections_revoked_has_no_token check (status <> 'revoked' or token_ref is null)
);
create index connections_account_idx on public.connections (account_id, provider);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (btrim(provider) <> ''),
  provider_event_id text not null check (btrim(provider_event_id) <> ''),
  connection_id uuid references public.connections (id) on delete cascade,
  received_at timestamptz not null default now(),
  -- exactly-once: replays land on this constraint (SPEC §6.9)
  unique (provider, provider_event_id)
);
create index webhook_events_received_idx on public.webhook_events (received_at);

-- ── connection lifecycle is always audited ───────────────────────────────────

create function private.log_connection_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    new.account_id, 'system', coalesce(new.created_by::text, 'service'),
    'connection.created', new.id::text,
    jsonb_build_object('provider', new.provider, 'method', new.method, 'scopes', new.scopes)
  );
  return new;
end;
$$;

create trigger connections_audit_insert
  after insert on public.connections
  for each row execute function private.log_connection_created();

-- ── vault token storage (C9) ─────────────────────────────────────────────────
-- Tokens live in vault.secrets (envelope encryption, Supabase Vault) and are
-- reachable ONLY through these security-definer functions, which only the
-- service role may execute (PostgREST exposes the public schema, so they live
-- there with execute revoked from client roles — same pattern as
-- create_account_with_owner). authenticated/anon get nothing; staff tooling
-- has no code path that calls token_read, and no DB role short of the owner
-- can query vault.decrypted_secrets directly. The app DB stores token_ref
-- uuids, never token material.

create function public.connection_token_store(p_connection uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_ref uuid;
  new_ref uuid;
  conn_status text;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'token payload required';
  end if;
  select token_ref, status into old_ref, conn_status
    from public.connections where id = p_connection for update;
  if not found then
    raise exception 'unknown connection %', p_connection;
  end if;
  if conn_status = 'revoked' then
    raise exception 'connection % is revoked', p_connection;
  end if;
  -- delete+create rather than update_secret: stable across Vault versions,
  -- and rotation must never leave the old ciphertext live (refresh rotation).
  if old_ref is not null then
    delete from vault.secrets where id = old_ref;
  end if;
  new_ref := vault.create_secret(p_token, 'connection:' || p_connection::text || ':' || gen_random_uuid()::text,
    'OAuth token payload for connections.id=' || p_connection::text);
  update public.connections set token_ref = new_ref where id = p_connection;
  insert into public.audit_log (account_id, actor, actor_id, action, subject)
    select account_id, 'system', 'service', 'connection.token_stored', p_connection::text
    from public.connections where id = p_connection;
  return new_ref;
end;
$$;

create function public.connection_token_read(p_connection uuid)
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  ref uuid;
  conn_status text;
  payload text;
begin
  select token_ref, status into ref, conn_status
    from public.connections where id = p_connection;
  if not found then
    raise exception 'unknown connection %', p_connection;
  end if;
  if conn_status = 'revoked' or ref is null then
    raise exception 'connection % has no live token', p_connection;
  end if;
  select decrypted_secret into payload from vault.decrypted_secrets where id = ref;
  if payload is null then
    raise exception 'vault secret missing for connection %', p_connection;
  end if;
  return payload;
end;
$$;

-- One-click revoke, cascading (C9): vault secret destroyed in the same
-- transaction, status flipped, audited. Dependent-Nibbin pause ("pause
-- politely") is wired at M4 when nibbins/runs exist — the runtime reads
-- connections.status and must treat anything but 'active' as unusable.
create function public.connection_revoke(p_connection uuid, p_actor_user uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref uuid;
  changed int;
begin
  select token_ref into ref from public.connections where id = p_connection for update;
  if not found then
    raise exception 'unknown connection %', p_connection;
  end if;
  if ref is not null then
    delete from vault.secrets where id = ref;
  end if;
  update public.connections
    set token_ref = null, status = 'revoked', revoked_at = now()
    where id = p_connection and status <> 'revoked';
  get diagnostics changed = row_count;
  if changed > 0 then
    insert into public.audit_log (account_id, actor, actor_id, action, subject)
      select account_id,
             case when p_actor_user is null then 'system' else 'user' end,
             coalesce(p_actor_user::text, 'service'),
             'connection.revoked', p_connection::text
      from public.connections where id = p_connection;
  end if;
end;
$$;

-- service role only — clients and (especially) staff surfaces never touch
-- token plaintext. Default privileges granted execute broadly; claw it back.
revoke execute on function public.connection_token_store(uuid, text) from public, anon, authenticated;
revoke execute on function public.connection_token_read(uuid) from public, anon, authenticated;
revoke execute on function public.connection_revoke(uuid, uuid) from public, anon, authenticated;
grant execute on function public.connection_token_store(uuid, text) to service_role;
grant execute on function public.connection_token_read(uuid) to service_role;
grant execute on function public.connection_revoke(uuid, uuid) to service_role;

-- ── RLS: denial at the database layer regardless of application bugs ─────────

alter table public.connections enable row level security;
alter table public.webhook_events enable row level security;

create policy connections_member_read on public.connections
  for select to authenticated
  using ((select private.is_account_member(account_id)));

-- webhook_events is server plumbing: no client policies at all.

-- ── privilege hardening (RLS + grants: belt and suspenders) ──────────────────

revoke all on public.connections, public.webhook_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.connections from authenticated;
revoke all on public.webhook_events from authenticated;
