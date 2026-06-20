-- Add processed_at to webhook_events for two-phase idempotency (#28).
--
-- Previously recordOnce marked an event "seen" on first arrival. If the
-- handler threw after recordOnce, the event was effectively dropped on
-- redelivery (at-most-once). The fix: add a processed_at column that the
-- handler stamps after successful processing. A seen-but-unprocessed event
-- (processed_at IS NULL) can be retried; a processed event is a true duplicate.

alter table public.webhook_events
  add column if not exists processed_at timestamptz;

comment on column public.webhook_events.processed_at is
  'Stamped by the handler after successful processing. NULL = seen but not yet processed (safe to retry on redelivery). Non-null = fully processed (genuine duplicate — drop).';
