-- Rename the top action level Send → Act (stored value + display).
--
-- The ladder is unchanged: Observe / Draft / Act. 'send' was email-flavored;
-- 'act' is verb-parallel with observe/draft and generalizes past email
-- (book, pay, post). This is a pure rename — no behavior change, no escalation:
-- every row that was 'send' becomes 'act', and the gate keeps executing only at
-- the top level. The CHECK constraint is swapped to the new value set.
--
-- Ordering matters: drop the old CHECK before rewriting rows (the old check
-- forbids 'act'), then re-add the check on the new value set.

alter table public.nibbins
  drop constraint if exists nibbins_action_level_check;

update public.nibbins
  set action_level = 'act'
  where action_level = 'send';

alter table public.nibbins
  add constraint nibbins_action_level_check
  check (action_level in ('observe', 'draft', 'act'));
