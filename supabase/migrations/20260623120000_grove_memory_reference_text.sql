-- Task 1: add the reference_text column to grove_memory.
--
-- This is a purely additive, nullable change. No existing columns, policies,
-- or RPCs are touched. The Reference catch-all (Sources tab) writes through
-- the `save_reference` RPC added in Task 2 (same migration file by plan; kept
-- here in this file per Task 1's scope). The curated-field path
-- (save_grove_memory) is unchanged — spec §15.
--
-- Size cap matches `notes` (8000 chars) and the `sections` total cap (32KB).
-- The CHECK is written as IS NULL OR … so that NULL satisfies it (nullable).

alter table public.grove_memory
  add column reference_text text
    check (reference_text is null or char_length(reference_text) <= 8000);

-- ── Task 2: save_reference RPC ───────────────────────────────────────────────
-- Single client write path for the Reference catch-all field (Sources tab).
-- Mirrors save_grove_memory exactly: security definer, set search_path='',
-- auth.uid() + is_account_member re-check, advisory lock, upsert with version
-- bump. Grant/revoke posture is identical: authenticated only, revoke from
-- public/anon/service_role.

create function public.save_reference(
  target_account uuid,
  new_reference_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if new_reference_text is not null and char_length(new_reference_text) > 8000 then
    raise exception 'reference_text too long';
  end if;

  perform pg_advisory_xact_lock(hashtext('grove_memory:' || target_account::text));

  insert into public.grove_memory (account_id, sections, hard_rules, reference_text)
    values (target_account, '{}'::jsonb, '[]'::jsonb, new_reference_text)
  on conflict (account_id) do update
    set reference_text = excluded.reference_text,
        version        = public.grove_memory.version + 1,
        updated_at     = now();
end;
$$;

revoke execute on function public.save_reference(uuid, text) from public, anon, service_role;
grant execute on function public.save_reference(uuid, text) to authenticated;
