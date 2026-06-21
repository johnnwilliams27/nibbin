alter table public.nibbins
  add column action_level text not null default 'draft'
  check (action_level in ('observe', 'draft', 'send'));

-- Backfill: preserve each Nibbin's PRE-CHANGE effective autonomy.
-- Only holders of a *send-class* grant (email.send / calendar.event-create — the
-- capabilities that actually acted) become 'send'. An email.draft-only grant meant
-- "auto-create a Gmail draft, never send", so those stay 'draft' (the default) —
-- collapsing email.draft→email.send must NOT silently escalate a drafter to a sender.
update public.nibbins n
set action_level = 'send'
where exists (
  select 1 from public.nibbin_write_grants g
  where g.nibbin_id = n.id and g.revoked_at is null
    and g.capability in ('email.send', 'calendar.event-create')
);
