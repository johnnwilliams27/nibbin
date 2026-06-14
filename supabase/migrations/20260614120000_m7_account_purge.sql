-- M7 / issue #29 (stage 2): the irreversible purge.
--
-- The carve-out that severs a deleted account from its two permanent ledgers,
-- then erases the directly-personal data. ANONYMIZE-IN-PLACE: the account row is
-- KEPT as a scrubbed anchor so the immutable financial/audit ledgers stay
-- referentially valid; operational records (runs, ledgers, …) age out on their
-- own §6.11 retention clocks.
--
-- Why the account row can't be deleted: credit_ledger.run_id → runs,
-- runs.nibbin_id → nibbins, and nibbins.spec_id → agent_specs are ALL
-- ON DELETE RESTRICT, and the ledger's run/grant rows can't be nulled (CHECK
-- constraints). The immutable ledger therefore pins runs → nibbins →
-- agent_specs as a permanent, anonymized spine. Deleting the account is
-- structurally impossible without dropping the tamper-evidence guarantees — so
-- we don't; we scrub the anchor and erase only the personal data hanging off it.
--
-- This function has NO caller. It is a service_role RPC that a later, env-gated
-- nightly job will invoke after the grace window. Shipping it cannot purge
-- anything on its own.
--
-- Operational note: disabling audit_log's append-only trigger briefly takes an
-- ACCESS EXCLUSIVE lock on a high-write table; the nightly job must run
-- sequentially and off-peak.

alter table public.accounts add column purged_at timestamptz;

create function public.purge_deleted_account(p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due timestamptz;
  v_purged timestamptz;
  v_members uuid[];
  v_credit int;
  v_audit int;
  v_scrubbed int;
begin
  -- clock guard: only an account whose grace window has fully elapsed, and
  -- never twice.
  select purge_after, purged_at into v_due, v_purged
    from public.accounts where id = p_account for update;
  if not found then
    raise exception 'unknown account %', p_account;
  end if;
  if v_purged is not null then
    return jsonb_build_object('account', p_account, 'already_purged', true, 'purged_at', v_purged);
  end if;
  if v_due is null then
    raise exception 'account % is not scheduled for deletion', p_account;
  end if;
  if v_due > now() then
    raise exception 'account % is still in its grace window (purge_after %)', p_account, v_due;
  end if;

  select coalesce(array_agg(user_id), '{}'::uuid[]) into v_members
    from public.memberships where account_id = p_account;

  -- ── carve-out: lift append-only to sever the personal link from the two
  -- permanent ledgers, then restore it. DDL is transactional, so any failure
  -- below rolls the triggers back ENABLED.
  alter table public.audit_log disable trigger audit_log_append_only;
  update public.audit_log
    set actor_id = '[deleted]', subject = null, meta = '{}'::jsonb
    where account_id = p_account;
  get diagnostics v_audit = row_count;
  alter table public.audit_log enable trigger audit_log_append_only;

  alter table public.credit_ledger disable trigger credit_ledger_append_only;
  update public.credit_ledger
    set created_by_user = null
    where account_id = p_account;
  get diagnostics v_credit = row_count;
  alter table public.credit_ledger enable trigger credit_ledger_append_only;

  -- ── hard-delete the directly-personal data. The account row is kept, so we
  -- delete these explicitly rather than via cascade. Operational/financial
  -- records (runs, run_steps, side_effects, approvals, product_events, the two
  -- ledgers, and the nibbins/agent_specs the ledger pins) are intentionally
  -- retained — anonymized via the scrubbed account — to age out under their own
  -- retention clocks.
  delete from public.nibbin_write_grants where account_id = p_account;  -- send permissions
  delete from public.model_calls where account_id = p_account;          -- LLM prompt/response content
  delete from public.scan_results where account_id = p_account;
  delete from public.diagnoses where account_id = p_account;
  delete from public.grove_memory where account_id = p_account;
  delete from public.grove_state where account_id = p_account;
  delete from public.onboarding_handoff where account_id = p_account;
  delete from public.notifications where account_id = p_account;
  delete from public.send_records where account_id = p_account;
  delete from public.email_sends where account_id = p_account;
  delete from public.drip_arcs where account_id = p_account;            -- cascades drip_sends
  delete from public.connections where account_id = p_account;          -- cascades write_grants, webhook_events
  delete from public.subscriptions where account_id = p_account;
  delete from public.impersonation_sessions where account_id = p_account;
  delete from public.memberships where account_id = p_account;

  -- ── anonymize the people: scrub members who now belong to no other account.
  -- The auth identity itself is removed by the job that calls this (admin API).
  update public.users u
    set email = 'deleted+' || u.id::text || '@deleted.invalid',
        name = null, locale = null, tz = null
    where u.id = any(v_members)
      and not exists (select 1 from public.memberships m where m.user_id = u.id);
  get diagnostics v_scrubbed = row_count;

  -- ── anonymize the anchor and mark the purge complete
  update public.accounts
    set name = '[deleted account]', purged_at = now()
    where id = p_account;

  -- a retained, anonymized record that the purge ran (INSERT is still allowed;
  -- append-only blocks only UPDATE/DELETE)
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (p_account, 'system', 'purge', 'account.purged', p_account::text,
            jsonb_build_object('audit_anonymized', v_audit, 'credit_anonymized', v_credit,
                               'members_scrubbed', v_scrubbed));

  return jsonb_build_object(
    'account', p_account,
    'purged_at', now(),
    'audit_anonymized', v_audit,
    'credit_anonymized', v_credit,
    'members_scrubbed', v_scrubbed
  );
end;
$$;

revoke execute on function public.purge_deleted_account(uuid) from public, anon, authenticated;
grant execute on function public.purge_deleted_account(uuid) to service_role;
