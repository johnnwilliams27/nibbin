-- Crystallization Slice 4: provenance — record the originating plan_run on a
-- crystallized (C-plan → B-spec) Nibbin (design §6).
--
-- A crystallized custom Nibbin adopts with p_template_key = NULL, a non-empty
-- p_steps, and the source plan_run id (p_source_plan_run_id). A
-- shop-template / Composer adoption passes p_source_plan_run_id = NULL and
-- behaves exactly as before.
--
-- Two additive changes:
--   1. agent_specs.source_plan_run_id uuid null (FK to plan_runs) — lineage.
--   2. adopt_nibbin v3: a 19th trailing param p_source_plan_run_id uuid default
--      null, inserted into the new column.
--
-- Everything else is reproduced BYTE-FOR-BYTE from
-- 20260618050000_adopt_nibbin_steps.sql (v2): the per-account advisory lock, the
-- §6.4 tier cap, the egg creation, the audit insert, and the grant/revoke. The
-- new param is appended at the END of the signature with a default, so this is
-- additive (the 18-arg call site keeps working until adopt.ts moves to 19-arg).
--
-- App-side validation (validateComposedSpec — fail-closed — + the trigger-graph
-- cycle check + the crystallizability gate) runs BEFORE this is called; only the
-- service role can reach it.

-- 1. Provenance column (nullable, additive; FK to plan_runs).
alter table public.agent_specs
  add column if not exists source_plan_run_id uuid references public.plan_runs(id);

-- 2. Drop the v2 (18-arg) signature; recreate with the trailing provenance param.
drop function if exists public.adopt_nibbin(
  uuid, uuid, text, integer, text, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, text, integer, jsonb, jsonb
);

create function public.adopt_nibbin(
  p_account uuid,
  p_actor_user uuid,
  p_template_key text,
  p_version integer,
  p_display_name text,
  p_tools_allowlist text[],
  p_required_connectors text[],
  p_triggers jsonb,
  p_curriculum jsonb,
  p_credit_profile jsonb,
  p_name text,
  p_species text,
  p_palette text,
  p_accessory text,
  p_marking text,
  p_seed integer,
  p_steps jsonb default '[]'::jsonb,
  p_persona_policy jsonb default '{}'::jsonb,
  p_source_plan_run_id uuid default null
)
returns table (nibbin_id uuid, spec_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_max integer;
  v_count integer;
  v_spec uuid;
  v_nibbin uuid;
begin
  perform private.lock_account(p_account);

  -- §6.4 tier caps: hatchling 2, grove 5, canopy unlimited. No subscription
  -- row means the free tier.
  select tier into v_tier from public.subscriptions where account_id = p_account;
  v_max := case coalesce(v_tier, 'hatchling')
    when 'hatchling' then 2
    when 'grove' then 5
    else null
  end;
  if v_max is not null then
    -- sleeping Nibbins (downgrade — they sleep, never deleted) don't occupy a
    -- slot; waking one re-enters through this same cap check.
    select count(*) into v_count
      from public.nibbins
      where account_id = p_account and kind = 'specialist' and status <> 'sleeping';
    if v_count >= v_max then
      raise exception 'nibbin limit reached for tier %', coalesce(v_tier, 'hatchling')
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.agent_specs (
    account_id, template_key, version, display_name, tools_allowlist,
    required_connectors, triggers, curriculum, credit_profile, steps, persona_policy,
    source_plan_run_id, validated_at
  ) values (
    p_account, p_template_key, p_version, p_display_name, p_tools_allowlist,
    p_required_connectors, p_triggers, p_curriculum, p_credit_profile,
    coalesce(p_steps, '[]'::jsonb), coalesce(p_persona_policy, '{}'::jsonb),
    p_source_plan_run_id, now()
  ) returning id into v_spec;

  insert into public.nibbins (
    account_id, kind, spec_id, name, species, stage, palette, accessory, marking, seed
  ) values (
    p_account, 'specialist', v_spec, btrim(p_name), p_species, 'egg',
    p_palette, p_accessory, p_marking, p_seed
  ) returning id into v_nibbin;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    p_account, 'user', coalesce(p_actor_user::text, 'service'), 'nibbin.adopted', v_nibbin::text,
    jsonb_build_object('template_key', p_template_key, 'version', p_version, 'species', p_species)
  );

  return query select v_nibbin, v_spec;
end;
$$;
revoke execute on function public.adopt_nibbin(uuid, uuid, text, integer, text, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, text, integer, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.adopt_nibbin(uuid, uuid, text, integer, text, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, text, integer, jsonb, jsonb, uuid) to service_role;
