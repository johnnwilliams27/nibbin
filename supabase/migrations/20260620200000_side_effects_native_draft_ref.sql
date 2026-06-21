-- Task 4: native-draft mirror + delete-sync
-- Adds native_draft_ref to side_effects so the executor can store the Gmail
-- draft id created at Draft action level. Null on non-nativeDraft capabilities
-- (e.g. calendar.event-create) and on send-level executions that send directly.
alter table public.side_effects
  add column native_draft_ref text null;
