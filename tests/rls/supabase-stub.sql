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

-- Supabase default privileges: new objects in public are granted to all three
-- roles; our migrations then explicitly REVOKE where the spec demands less.
-- Set FOR ROLE nibbin_owner because that is the role that creates the objects
-- (default privileges are keyed to the creating role).
alter default privileges for role nibbin_owner in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role nibbin_owner in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role nibbin_owner in schema public grant execute on functions to anon, authenticated, service_role;
