-- Admin-issued Founding-Grove invites stamp the waitlist row, so the staff view
-- can show who's already been invited and avoid accidental double-invites.
alter table public.waitlist add column if not exists invited_at timestamptz;
