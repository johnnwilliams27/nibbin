alter table public.nibbins
  add column action_level text not null default 'draft'
  check (action_level in ('observe', 'draft', 'send'));

-- Backfill: any Nibbin currently holding an active write grant keeps acting (send);
-- everyone else drafts. Preserves today's effective behavior.
update public.nibbins n
set action_level = 'send'
where exists (
  select 1 from public.nibbin_write_grants g
  where g.nibbin_id = n.id and g.revoked_at is null
);
