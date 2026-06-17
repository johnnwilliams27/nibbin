-- The OAuth nonce was dead scaffolding: it was generated and stored on the
-- pending row but never emitted on the authorization URL or verified (no
-- openid scope / id_token is consumed; anti-replay is state + PKCE). The
-- application no longer writes it. Drop the NOT NULL constraint so new inserts
-- that omit nonce succeed; this is backward-compatible (old code that still
-- supplies a value also works), so it is safe to apply before the code deploys.
-- The column itself can be dropped in a later cleanup once all deploys omit it.
alter table public.oauth_pending_authorizations
  alter column nonce drop not null;
