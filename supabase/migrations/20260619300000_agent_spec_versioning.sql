-- Agent Versioning Slice 1 (SPEC §18.2 / R52): "Edit/tune → new spec version
-- (snapshots stay immutable) + migrate the running Nibbin … never silently
-- mutating." This migration adds spec-lineage + a retune RPC.
--
-- Invariants:
--   * agent_specs rows are immutable snapshots. A re-tune NEVER updates an
--     existing spec; it inserts a NEW row and re-points nibbins.spec_id to it.
--     The old spec row remains as history (authenticated stays revoked from
--     insert/update/delete on agent_specs).
--   * Minting the new spec + migrating the Nibbin happen atomically in one RPC.
--   * retune_nibbin is service_role-only — exactly like adopt_nibbin. App-side
--     validation (validateComposedSpec — fail-closed — + trigger-graph cycle
--     check) runs in the server action BEFORE this is called; restricting the
--     grant to service_role prevents a JWT caller from minting an unvalidated
--     spec.

-- 1. Lineage pointer: the spec this version was derived from (null for originals).
--    `on delete set null` for the same M7 account-deletion-cascade reason as
--    source_plan_run_id (a bare FK would abort the cascade txn); the durable
--    spec survives, only the dangling lineage pointer is dropped.
alter table public.agent_specs
  add column if not exists previous_spec_id uuid references public.agent_specs(id) on delete set null;

-- 2. retune_nibbin: mint a new immutable spec version for an existing Nibbin and
--    migrate the Nibbin to it. Returns the new spec id.
--
--    source_plan_run_id is set NULL on the new row: a manual re-tune is not from
--    a plan run, and copying a non-null provenance would violate
--    agent_specs_source_plan_run_uniq. Lineage is carried by previous_spec_id.
create or replace function public.retune_nibbin(
  p_account uuid,
  p_actor_user uuid,
  p_nibbin uuid,
  p_display_name text,
  p_steps jsonb,
  p_persona_policy jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur public.agent_specs%rowtype;
  v_new uuid;
begin
  perform private.lock_account(p_account);

  -- Resolve the Nibbin's current spec, scoped to the account (defense in depth:
  -- the service-role caller has already authed the user, but this rejects a
  -- nibbin/account mismatch).
  select s.* into v_cur
  from public.nibbins n
  join public.agent_specs s on s.id = n.spec_id
  where n.id = p_nibbin and n.account_id = p_account;
  if not found then
    raise exception 'nibbin % not found for account %', p_nibbin, p_account
      using errcode = 'no_data_found';
  end if;

  insert into public.agent_specs (
    account_id, template_key, version, display_name, tools_allowlist,
    required_connectors, triggers, curriculum, credit_profile, steps, persona_policy,
    source_plan_run_id, previous_spec_id, validated_at
  ) values (
    p_account,
    v_cur.template_key,
    v_cur.version + 1,
    coalesce(nullif(btrim(p_display_name), ''), v_cur.display_name),
    v_cur.tools_allowlist,
    v_cur.required_connectors,
    v_cur.triggers,
    v_cur.curriculum,
    v_cur.credit_profile,
    coalesce(p_steps, v_cur.steps),
    coalesce(p_persona_policy, v_cur.persona_policy),
    null,        -- manual re-tune: no plan-run provenance (avoids the uniq index); lineage below
    v_cur.id,    -- previous_spec_id
    now()
  ) returning id into v_new;

  update public.nibbins set spec_id = v_new where id = p_nibbin;

  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (
    p_account, 'user', coalesce(p_actor_user::text, 'service'), 'nibbin.retuned', p_nibbin::text,
    jsonb_build_object('previous_spec_id', v_cur.id, 'new_spec_id', v_new, 'version', v_cur.version + 1)
  );

  return v_new;
end;
$$;

revoke execute on function public.retune_nibbin(uuid, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.retune_nibbin(uuid, uuid, uuid, text, jsonb, jsonb) to service_role;
