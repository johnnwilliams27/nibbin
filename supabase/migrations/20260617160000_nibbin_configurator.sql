-- Nibbin configurator: let an account member rename + restyle their own nibbins.
-- Appearance lives as flat columns on public.nibbins (species/palette/accessory/marking),
-- which are the buildCreature() inputs. authenticated has SELECT-only on nibbins (all
-- writes go through security-definer RPCs), so this adds the one missing write path.
--
-- Scope: only a 'specialist' nibbin the caller's account owns is editable; the
-- canonical Grovekeeper (kind = 'keeper') and any future kind are immutable. Stage
-- and seed are never touched here — stage is earned (nibbin_promote/_demote), seed
-- is the visual-variation salt.
--
-- create-or-replace so this migration is idempotent if re-applied (e.g. after a
-- version renumber against a DB where an earlier numbering already ran).

create or replace function public.update_nibbin_appearance(
  p_nibbin uuid,
  p_name text,
  p_species text,
  p_palette text,
  p_accessory text,
  p_marking text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_account uuid;
  v_kind text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  -- Authenticate FIRST. This RPC is for logged-in account members only; the sole
  -- caller uses the user's RLS session, so there is no service/system path. A null
  -- uid is always misuse — reject before reading or locking any row.
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- Resolve the nibbin's account WITHOUT a row lock, so the per-account advisory
  -- lock is taken before any row lock (run_begin takes them in that order; the
  -- reverse order deadlocks against it).
  select n.account_id, n.kind into v_account, v_kind
    from public.nibbins n where n.id = p_nibbin;
  if not found or not (select private.is_account_member(v_account)) then
    raise exception 'unknown nibbin %', p_nibbin;  -- do not disclose cross-account existence
  end if;

  -- Only specialist nibbins are editable; the Grovekeeper (kind='keeper') and any
  -- future kind are immutable by this gate.
  if v_kind <> 'specialist' then
    raise exception 'nibbin % is not editable', p_nibbin;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nibbin:account:' || v_account::text, 0));

  -- validate against the creatures engine's accepted inputs
  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'name must be 1-40 characters';
  end if;
  if p_species not in ('Sprout','Wisp','Shellback','Longear','Puff','Glim') then
    raise exception 'invalid species %', p_species;  -- Keeper is reserved
  end if;
  if p_palette !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'palette must be a 6-digit hex color';
  end if;
  if p_accessory not in ('none','glasses','bow','pencil','broom','quill','coin') then
    raise exception 'invalid accessory %', p_accessory;
  end if;
  if p_marking not in ('none','spots','stripe','star') then
    raise exception 'invalid marking %', p_marking;
  end if;

  update public.nibbins
     set name = v_name,
         species = p_species,
         palette = p_palette,
         accessory = p_accessory,
         marking = p_marking
   where id = p_nibbin;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (v_account, 'user', uid::text,
    'nibbin.appearance_updated', p_nibbin::text,
    jsonb_build_object('name', v_name, 'species', p_species, 'palette', p_palette,
      'accessory', p_accessory, 'marking', p_marking));

  return p_nibbin;
end;
$$;
revoke execute on function public.update_nibbin_appearance(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.update_nibbin_appearance(uuid, text, text, text, text, text) to authenticated;
