-- Add 'reach' kind to notifications — for non-beat messages (escalations, replies, news).
-- The floor adapter (terminal fallback) will use 'reach' for urgent in-app contact;
-- beats stay 'beat'. See packages/channels/src/adapters/floor.ts.

-- Drop and re-create the CHECK constraint to ADD 'reach' — preserving every
-- kind already allowed by the prior migration (20260618010000 drift/demotion
-- added 'nudge' + 'demotion'). Re-adding only the original 3 + 'reach' would
-- silently drop 'nudge'/'demotion' and break insert_system_notification, since
-- this migration applies AFTER the drift one.
alter table public.notifications
  drop constraint notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('beat', 'evolution', 'graduation', 'nudge', 'demotion', 'reach'));
