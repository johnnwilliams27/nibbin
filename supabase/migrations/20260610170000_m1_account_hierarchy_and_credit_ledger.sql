-- M1: account hierarchy, subscriptions, credit ledger, audit log, staff world.
-- SPEC §6.1 (data model), §6.4 (tiers), docs/INVARIANTS.md (RLS via membership;
-- credit_ledger/audit_log append-only with derived balances; staff is a
-- separate world). Verified by tests/rls/rls.test.ts (attack suite).
--
-- Conventions: every account-scoped table has RLS enabled; client roles get
-- SELECT through membership policies only; all client writes go through
-- security-definer functions or the service role. anon gets nothing.
--
-- Note vs. the §6.1 sketch: auth_identities is intentionally not created —
-- Supabase's auth.identities already records provider/provider_uid per user
-- (Decision Log entry added in SPEC §9).

-- ── helpers ─────────────────────────────────────────────────────────────────

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ── core tables ─────────────────────────────────────────────────────────────

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text,
  locale text,
  tz text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  unique (account_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id, account_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts (id) on delete cascade,
  tier text not null check (tier in ('hatchling', 'grove', 'canopy')),
  stripe_customer_id text,
  status text not null,
  period_end timestamptz,
  created_at timestamptz not null default now()
);

-- Append-only. Balances are derived (credit_balances view), never stored.
-- Sign-by-reason and reference requirements mirror packages/shared/src/credits.ts —
-- the database is the last line of defense, the TS module is the API-layer authority.
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  delta integer not null check (delta <> 0),
  weighted_units integer not null generated always as (abs(delta)) stored,
  reason text not null check (reason in ('run', 'topup', 'grant', 'refund', 'clawback')),
  run_id text check (run_id is null or btrim(run_id) <> ''),  -- FK to runs(id) lands at M4
  source_id text check (source_id is null or btrim(source_id) <> ''),
  created_by_user uuid references public.users (id),
  created_at timestamptz not null default now(),
  constraint credit_ledger_sign_by_reason check (
    (reason in ('run', 'clawback') and delta < 0)
    or (reason in ('topup', 'grant', 'refund') and delta > 0)
  ),
  constraint credit_ledger_run_ref check (reason not in ('run', 'refund') or run_id is not null),
  constraint credit_ledger_grant_period check (reason <> 'grant' or source_id is not null)
);
create index credit_ledger_account_idx on public.credit_ledger (account_id, created_at);
create index credit_ledger_run_idx on public.credit_ledger (run_id) where run_id is not null;
-- webhook replays cannot double-grant
create unique index credit_ledger_one_grant_per_period
  on public.credit_ledger (account_id, source_id) where reason = 'grant';

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts (id) on delete restrict,
  actor text not null check (actor in ('user', 'nibbin', 'system', 'staff')),
  actor_id text not null,
  action text not null,
  subject text,
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index audit_log_account_idx on public.audit_log (account_id, at);

-- ── staff world (separate; admin.nibbin.com only — §6.10) ───────────────────

create table public.staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('superadmin', 'support', 'engineer')),
  mfa_enforced boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_users (id),
  account_id uuid not null references public.accounts (id),
  reason text not null check (btrim(reason) <> ''),
  scope text not null default 'read' check (scope in ('read', 'act')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- ── append-only enforcement (trigger layer — binds every role, incl. service) ─

create function private.raise_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger credit_ledger_append_only
  before update or delete on public.credit_ledger
  for each row execute function private.raise_append_only();
create trigger credit_ledger_append_only_truncate
  before truncate on public.credit_ledger
  for each statement execute function private.raise_append_only();

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.raise_append_only();
create trigger audit_log_append_only_truncate
  before truncate on public.audit_log
  for each statement execute function private.raise_append_only();

-- ── membership helper (security definer breaks the memberships↔policy recursion) ─

create function private.is_account_member(target_account uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.account_id = target_account
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;
revoke execute on function private.is_account_member(uuid) from public, anon;
grant execute on function private.is_account_member(uuid) to authenticated, service_role;

-- ── account bootstrap (the only way clients create accounts/memberships) ─────

create function public.create_account_with_owner(account_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_account uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if account_name is null or btrim(account_name) = '' then
    raise exception 'account name required';
  end if;
  insert into public.accounts (name) values (btrim(account_name)) returning id into new_account;
  insert into public.memberships (account_id, user_id, role) values (new_account, uid, 'owner');
  insert into public.audit_log (account_id, actor, actor_id, action, subject)
    values (new_account, 'user', uid::text, 'account.created', new_account::text);
  return new_account;
end;
$$;
revoke execute on function public.create_account_with_owner(text) from public, anon;
grant execute on function public.create_account_with_owner(text) to authenticated;

-- ── RLS: denial at the database layer regardless of application bugs ────────

alter table public.accounts enable row level security;
alter table public.users enable row level security;
alter table public.memberships enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.audit_log enable row level security;
alter table public.staff_users enable row level security;
alter table public.impersonation_sessions enable row level security;

create policy accounts_member_read on public.accounts
  for select to authenticated
  using ((select private.is_account_member(id)));

create policy users_self_read on public.users
  for select to authenticated using (id = (select auth.uid()));
create policy users_self_insert on public.users
  for insert to authenticated with check (id = (select auth.uid()));
create policy users_self_update on public.users
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy memberships_member_read on public.memberships
  for select to authenticated
  using ((select private.is_account_member(account_id)));

create policy subscriptions_member_read on public.subscriptions
  for select to authenticated
  using ((select private.is_account_member(account_id)));

create policy credit_ledger_member_read on public.credit_ledger
  for select to authenticated
  using ((select private.is_account_member(account_id)));

-- impersonation must always be visible in the account's audit log (INVARIANTS)
create policy audit_log_member_read on public.audit_log
  for select to authenticated
  using (account_id is not null and (select private.is_account_member(account_id)));

-- staff tables: no policies for client roles — and no privileges either (below).

-- ── privilege hardening (RLS + grants: belt and suspenders) ──────────────────

-- anon touches nothing in the product schema
revoke all on public.accounts, public.users, public.memberships, public.subscriptions,
  public.credit_ledger, public.audit_log, public.staff_users, public.impersonation_sessions
  from anon;

-- clients read through policies; they never write directly (bootstrap/service only)
revoke insert, update, delete, truncate, references, trigger
  on public.accounts, public.memberships, public.subscriptions,
     public.credit_ledger, public.audit_log
  from authenticated;
revoke update, delete, truncate, references, trigger on public.users from authenticated;
grant update (name, locale, tz) on public.users to authenticated;

-- staff world is invisible to product roles entirely (§6.10)
revoke all on public.staff_users, public.impersonation_sessions from authenticated;

-- ── derived balances (never stored) ──────────────────────────────────────────

create view public.credit_balances
with (security_invoker = true)
as
  select account_id, sum(delta) as balance
  from public.credit_ledger
  group by account_id;

revoke all on public.credit_balances from anon;
