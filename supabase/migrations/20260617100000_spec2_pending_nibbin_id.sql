-- Spec 2 M-A: write-scope upgrade needs to remember which Nibbin triggered
-- the OAuth round-trip so the callback can insert the right write grant row.
-- null = first read-only connect (Spec 1 path); non-null = Spec 2 upgrade.
alter table public.oauth_pending_authorizations
  add column nibbin_id uuid references public.nibbins (id) on delete cascade;
