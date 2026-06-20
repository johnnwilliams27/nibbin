-- Tier-2 fleet learning instrumentation: add two structural telemetry events to
-- the product_events allowlist so the demand-gap and connector-blocker fleet
-- signals can accrue (aggregates built in a follow-up).
--   * capability_unfulfilled — the Composer wanted a capability it can't provide
--     (no registry mapping, or required connector not connected). Props:
--     { capability, reason }.
--   * connector_blocked — a run couldn't proceed because of a connector
--     (not_connected / auth_failed / velocity_cap). Props: { connector, reason }.
-- Structural-only (capability ids, connector names, reason codes) — never content.
--
-- Recreated byte-for-byte from the live emit_product_event (membership gate +
-- drip pattern preserved); the only change is the two new names in the IN-list.

create or replace function public.emit_product_event(p_account uuid, p_name text, p_props jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  uid uuid := (select auth.uid());
begin
  if p_name not in (
    'account_created', 'connector_linked', 'scan_completed', 'scan_empty', 'nibbin_adopted',
    'first_draft_approved', 'run_approved', 'run_edited', 'run_rejected', 'stage_promoted',
    'stage_demoted', 'study_started', 'study_completed', 'study_aborted', 'diagnosis_viewed',
    'plan_upgraded', 'topup_purchased', 'capability_unfulfilled', 'connector_blocked'
  ) and p_name !~ '^drip_[a-z0-9_]+_(sent|opened)$' then
    raise exception 'unknown product event %', p_name;
  end if;
  if uid is not null and (p_account is null or not (select private.is_account_member(p_account))) then
    raise exception 'cannot emit events for this account';
  end if;
  insert into public.product_events (account_id, user_id, name, props)
  values (p_account, uid, p_name, coalesce(p_props, '{}'::jsonb));
end;
$function$;
