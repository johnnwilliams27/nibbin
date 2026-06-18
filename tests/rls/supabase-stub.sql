-- CI/local stand-in for what a real Supabase project provides out of the box.
-- NEVER applied to a real Supabase database — the harness runs it only against
-- the throwaway Postgres (service container in CI, Docker locally) before the
-- in-repo migrations. Keep it to Supabase-equivalents: roles, auth schema,
-- auth.uid(), and the default privileges Supabase grants on public.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  -- Stand-in for Supabase's object owner: owns the schema but is NOT a superuser.
  -- The harness applies migrations as this role so the suite reflects the real
  -- production trust boundary (Supabase `postgres` owns tables, can't bypass an
  -- enabled trigger via DISABLE TRIGGER / session_replication_role) rather than
  -- the CI container's superuser. (red-team F4)
  if not exists (select from pg_roles where rolname = 'nibbin_owner') then
    create role nibbin_owner nologin nosuperuser;
  end if;
end
$$;

-- let the connecting (super)user assume the owner role to run migrations
grant nibbin_owner to current_user;
do $$ begin execute format('grant create on database %I to nibbin_owner', current_database()); end $$;
grant usage, create on schema public to nibbin_owner;

-- pgvector: real Supabase projects have the `vector` extension provisioned by a
-- privileged role before app migrations run. The CI/local image is
-- pgvector/pgvector (Postgres 17 + pgvector); enable it here as the superuser so
-- the agent-memory migration's `create extension if not exists vector` is a
-- verified no-op (nibbin_owner, the non-superuser migration role, cannot create
-- extensions — same trust boundary as production).
create extension if not exists vector;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique
);

-- Supabase's auth.uid(): the JWT subject of the current request.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- owner needs these now that the auth schema/table exist (FK + lookups)
grant usage on schema auth to nibbin_owner;
grant references on auth.users to nibbin_owner;

-- ── Vault stand-in (real projects: Supabase Vault, envelope encryption) ─────
-- Functional parity only — NO encryption here; this file never touches a real
-- database (see header). Mirrors the real trust boundary: only the object
-- owner (nibbin_owner ≈ Supabase postgres) can reach the vault schema, so
-- tokens are reachable solely through the private.* security-definer
-- functions the M3 migration defines (C9).
drop schema if exists vault cascade;
create schema vault;

create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid
language sql
as $$
  insert into vault.secrets (secret, name, description)
  values (new_secret, new_name, new_description)
  returning id
$$;

create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at
  from vault.secrets;

-- owner-only, like production: client roles (and service_role) get no direct path
grant usage on schema vault to nibbin_owner;
grant all on vault.secrets to nibbin_owner;
grant select on vault.decrypted_secrets to nibbin_owner;
grant execute on function vault.create_secret(text, text, text) to nibbin_owner;
revoke all on schema vault from public;

-- Supabase default privileges: new objects in public are granted to all three
-- roles; our migrations then explicitly REVOKE where the spec demands less.
-- Set FOR ROLE nibbin_owner because that is the role that creates the objects
-- (default privileges are keyed to the creating role).
alter default privileges for role nibbin_owner in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role nibbin_owner in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role nibbin_owner in schema public grant execute on functions to anon, authenticated, service_role;
