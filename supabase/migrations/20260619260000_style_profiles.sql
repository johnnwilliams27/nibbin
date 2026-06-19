-- Style/Taste Profile (SPEC §4A Slice 1): per-account voice profile derived
-- from edit signals. Derived-not-raw only — tone attributes, sign-offs, taboos;
-- NEVER raw draft/edit sentences. RLS: member read, no client writes.
-- Service-role upsert (extraction pipeline), authenticated reset + note edit.
create table public.style_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts (id) on delete cascade,
  -- Tone profile: formality (0=very casual..1=very formal), sentiment
  -- (-1=blunt..1=warm), pace (0=terse..1=verbose), signature_sign_offs[],
  -- removals/taboos[]. All optional — null until first extraction round.
  tone_profile jsonb,
  -- Placeholder for Field Study cues (Slice 2). Empty this slice.
  field_study_cues jsonb not null default '{}',
  -- User-controlled freeform voice note (bounded to 1000 chars in the RPC).
  user_notes text check (user_notes is null or char_length(user_notes) <= 1000),
  -- Extraction provenance: edits_analyzed, confidence (0..1), last_updated ISO,
  -- derived_from (which edit ids seeded the latest extraction round).
  stats jsonb not null default '{"edits_analyzed": 0, "confidence": 0, "last_updated": null, "derived_from": []}',
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index style_profiles_account_idx on public.style_profiles (account_id);

alter table public.style_profiles enable row level security;

-- Members of the account can READ their style profile; no client writes.
create policy style_profile_member_read on public.style_profiles
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke insert, update, delete, truncate, references, trigger
  on public.style_profiles from authenticated;
revoke all on public.style_profiles from anon;

-- ---------------------------------------------------------------------------
-- upsert_style_profile: called by the extraction pipeline (service-role).
-- Members cannot call this directly. Increments version + updates updated_at.
-- ---------------------------------------------------------------------------
create function public.upsert_style_profile(
  p_account uuid,
  p_tone_profile jsonb,
  p_stats jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.style_profiles (account_id, tone_profile, stats)
  values (p_account, p_tone_profile, p_stats)
  on conflict (account_id) do update
    set tone_profile = excluded.tone_profile,
        stats        = excluded.stats,
        version      = public.style_profiles.version + 1,
        updated_at   = now();
end;
$$;

-- Grant to service_role only (pipeline-internal).
revoke execute on function public.upsert_style_profile(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_style_profile(uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- update_style_notes: user-initiated freeform note (settings page).
-- Member-gated: only active members of the account may call this.
-- ---------------------------------------------------------------------------
create function public.update_style_notes(
  p_account uuid,
  p_notes text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_account_member(p_account)) then
    raise exception 'not a member';
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'notes too long';
  end if;
  -- Ensure a profile row exists (may not yet if no edits have been made).
  insert into public.style_profiles (account_id, user_notes)
  values (p_account, p_notes)
  on conflict (account_id) do update
    set user_notes = excluded.user_notes,
        updated_at = now();
end;
$$;

revoke execute on function public.update_style_notes(uuid, text) from public, anon;
grant execute on function public.update_style_notes(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reset_style_profile: user-initiated full reset (settings page).
-- Member-gated. Deletes the row; the pipeline will re-derive from scratch.
-- ---------------------------------------------------------------------------
create function public.reset_style_profile(
  p_account uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_account_member(p_account)) then
    raise exception 'not a member';
  end if;
  delete from public.style_profiles where account_id = p_account;
end;
$$;

revoke execute on function public.reset_style_profile(uuid) from public, anon;
grant execute on function public.reset_style_profile(uuid) to authenticated;
