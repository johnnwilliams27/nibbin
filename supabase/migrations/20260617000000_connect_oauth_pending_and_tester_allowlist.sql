-- Connect foundation: short-lived OAuth state + tester gate. Both service-role
-- only (RLS on, no policies, explicit revoke) — mirrors connections' write model.

create table public.oauth_pending_authorizations (
  state text primary key,                       -- issued OAuth state (lookup key at callback)
  provider text not null check (btrim(provider) <> ''),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  nonce text not null,
  code_verifier text,                           -- PKCE S256 verifier (present for Google)
  scopes text[] not null default '{}',          -- exact scopes requested
  return_to text,                               -- post-callback redirect path
  resume_template text,                         -- shop templateKey to auto-adopt after connect
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,              -- ~10 min TTL
  consumed_at timestamptz                        -- single-use
);
alter table public.oauth_pending_authorizations enable row level security;
revoke all on public.oauth_pending_authorizations from authenticated, anon;

create index oauth_pending_expires_idx on public.oauth_pending_authorizations (expires_at);

create table public.tester_allowlist (
  email text not null,
  provider text not null,
  added_at timestamptz not null default now(),
  primary key (email, provider)
);
alter table public.tester_allowlist enable row level security;
revoke all on public.tester_allowlist from authenticated, anon;
