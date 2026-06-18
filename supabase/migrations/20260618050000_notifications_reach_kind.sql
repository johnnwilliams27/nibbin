-- Add 'reach' kind to notifications — for non-beat messages (escalations, replies, news).
-- The floor adapter (terminal fallback) will use 'reach' for urgent in-app contact;
-- beats stay 'beat'. See packages/channels/src/adapters/floor.ts.

-- Drop and re-create the CHECK constraint to include 'reach'.
alter table public.notifications
  drop constraint notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (kind in ('beat', 'evolution', 'graduation', 'reach'));
