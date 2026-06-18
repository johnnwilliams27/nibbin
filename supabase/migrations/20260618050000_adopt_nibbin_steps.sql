-- Composer Slice 2a: adopt_nibbin v2 — carry a composed spec's steps[] +
-- persona_policy into agent_specs at adoption time (design §2.5).
--
-- A custom (synthesized) Nibbin adopts with p_template_key = NULL and a
-- non-empty p_steps; a shop-template adoption keeps p_steps = '[]' /
-- p_persona_policy = '{}' and behaves exactly as before. The agent_specs.steps
-- and agent_specs.persona_policy columns already exist (migration
-- 20260618040000_agent_spec_steps.sql); this migration only teaches adopt_nibbin
-- to populate them.
--
-- Everything else is reproduced BYTE-FOR-BYTE from
-- 20260611120000_m4_runtime_shop_scan.sql: the per-account advisory lock, the
-- §6.4 tier cap, the egg creation, the audit insert, and the grant/revoke. The
-- two new params are appended at the END of the signature with defaults, so
-- this is additive (the old 16-arg call site keeps working until adopt.ts moves
-- to the 18-arg form).
--
-- App-side validation (validateComposedSpec — fail-closed — + the trigger-graph
-- cycle check) runs BEFORE this is called; only the service role can reach it.

-- Drop the old 16-arg signature; recreate with the two trailing params.
drop function if exists public.adopt_nibbin(
  uuid, uuid, text, integer, text, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, text, integer
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
  p_persona_policy jsonb default '{}'::jsonb
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
    required_connectors, triggers, curriculum, credit_profile, steps, persona_policy, validated_at
  ) values (
    p_account, p_template_key, p_version, p_display_name, p_tools_allowlist,
    p_required_connectors, p_triggers, p_curriculum, p_credit_profile,
    coalesce(p_steps, '[]'::jsonb), coalesce(p_persona_policy, '{}'::jsonb), now()
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
revoke execute on function public.adopt_nibbin(uuid, uuid, text, integer, text, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, text, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.adopt_nibbin(uuid, uuid, text, integer, text, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, text, integer, jsonb, jsonb) to service_role;
