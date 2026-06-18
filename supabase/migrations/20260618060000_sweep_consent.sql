-- Sweep consent-gating: the Gmail onboarding sweep runs only on affirmative
-- opt-in. Default off: existing rows = no consent (safe).

-- Carries the connect-screen checkbox choice through the OAuth redirect.
alter table public.oauth_pending_authorizations
  add column sweep_consent boolean not null default false;

-- The authoritative consent record on the connection. null = no consent.
alter table public.connections
  add column sweep_consent_at timestamptz,
  add column sweep_consent_by uuid references public.users(id);
