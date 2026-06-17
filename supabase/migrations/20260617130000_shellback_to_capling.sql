-- Species rename: Shellback → Capling (the mushroom). Identifier swap only; the
-- engine's art for this species is restyled separately. Migrate any persisted
-- rows, swap the nibbins.species CHECK, and update the configurator RPC's
-- validation list to match the engine's USER_SPECIES.

alter table public.nibbins drop constraint nibbins_species_check;

update public.nibbins set species = 'Capling' where species = 'Shellback';

alter table public.nibbins
  add constraint nibbins_species_check
  check (species in ('Sprout','Wisp','Capling','Longear','Puff','Glim','Keeper'));

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
  select n.account_id, n.kind into v_account, v_kind
    from public.nibbins n where n.id = p_nibbin for update;
  if not found or (uid is not null and not (select private.is_account_member(v_account))) then
    raise exception 'unknown nibbin %', p_nibbin;
  end if;
  if uid is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not authenticated';
  end if;

  if v_kind <> 'specialist' then
    raise exception 'nibbin % is not editable', p_nibbin;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nibbin:account:' || v_account::text, 0));

  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'name must be 1-40 characters';
  end if;
  if p_species not in ('Sprout','Wisp','Capling','Longear','Puff','Glim') then
    raise exception 'invalid species %', p_species;
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
  values (v_account, 'user', coalesce(uid::text, 'runtime'),
    'nibbin.appearance_updated', p_nibbin::text,
    jsonb_build_object('name', v_name, 'species', p_species, 'palette', p_palette,
      'accessory', p_accessory, 'marking', p_marking));

  return p_nibbin;
end;
$$;
grant execute on function public.update_nibbin_appearance(uuid, text, text, text, text, text) to authenticated, service_role;
