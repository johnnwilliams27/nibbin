-- Spec 2 M-B: record the plain-language explanation alongside the grant for
-- audit completeness. Mirrors the WriteScopeUpgradeRequest.plainLanguageReason
-- contract enforced by the engine. NOT NULL — a grant without a reason is a
-- silent one and we never grant silently.
alter table public.nibbin_write_grants
  add column plain_language_reason text not null default '';

-- Remove the default after backfill — future inserts must supply it.
-- (No rows exist yet in v0 so this is a no-op backfill.)
alter table public.nibbin_write_grants
  alter column plain_language_reason drop default;
