-- Desktop auth bridge (§6.1): one-time, PKCE-protected codes that hand a
-- Supabase session from the web sign-in page to the desktop Observer without
-- ever putting tokens in a URL. The native app opens nibbin.com/auth/desktop
-- with its PKCE code_challenge + state; the page authenticates (email+password),
-- mints a code here, and deep-links nibbin://auth?code=...; the desktop exchanges
-- the code for the stored session by proving the code_verifier.
--
-- Only the service role (the /api/auth/desktop/* route handlers) touches this
-- table — RLS is enabled with NO policies, so authenticated/anon get nothing.

create table public.desktop_auth_codes (
  code_hash text primary key,              -- sha256(hex) of the one-time code
  challenge text not null,                 -- PKCE code_challenge (S256, base64url)
  session jsonb not null,                  -- the Supabase session handed back to the desktop
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,         -- short TTL (~2 min); single-use
  used boolean not null default false
);

create index desktop_auth_codes_expires_idx on public.desktop_auth_codes (expires_at);

alter table public.desktop_auth_codes enable row level security;

-- No policies on purpose: the service role bypasses RLS; everyone else is denied.
revoke all on public.desktop_auth_codes from anon, authenticated;
