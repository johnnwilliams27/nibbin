-- Re-nudge cadence / safety floor (Connector batch Task 5a) — the persistent
-- ledger that makes a re-nudge BOUNDED across runs.
--
-- WHY: the overdue-invoice Nibbin (PR #237) sends a personalized Gmail email
-- about a still-overdue Stripe invoice. The resource-claim (§18.3) only stops
-- two SIMULTANEOUS runs nudging one invoice — it releases at run-end. Schedule
-- triggers carry no dedupeKey, so the effect idempotency key falls back to
-- runId per run. A still-overdue invoice would therefore be re-nudged on EVERY
-- scheduled tick. This ledger records each executed nudge per (nibbin, invoice)
-- so the runtime can enforce a hard floor (min interval + max count) and an
-- owner-tunable cadence ACROSS runs — the safety wall that must exist before any
-- Tally Nibbin runs at the `act` (Send) action level.
--
-- This is the same SHAPE as resource_claims / send_records: a service-role-only
-- ledger written by the runner on the auto-execute send path, RLS-readable by
-- account members (so a future "last nudged 4 days ago" surface can read it),
-- never client-writable.

create table if not exists public.nudge_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  nibbin_id uuid not null references public.nibbins (id) on delete cascade,
  -- The nudged resource. resource_kind generalizes past invoices (e.g. a future
  -- 'thread' re-nudge); resource_id is the stable external id (Stripe invoice id).
  resource_kind text not null default 'invoice' check (btrim(resource_kind) <> ''),
  resource_id text not null check (btrim(resource_id) <> ''),
  nudged_at timestamptz not null default now()
);

-- The hot lookup: "how many times, and how recently, has THIS nibbin nudged
-- THIS resource?" — answered by an index range scan on (nibbin, kind, id, time).
create index if not exists nudge_ledger_lookup_idx
  on public.nudge_ledger (nibbin_id, resource_kind, resource_id, nudged_at desc);

alter table public.nudge_ledger enable row level security;
-- Members can READ their own nudge history (audit / "already nudged" surface);
-- no client writes — rows are inserted only by the service-role RPC.
drop policy if exists nudge_ledger_member_read on public.nudge_ledger;
create policy nudge_ledger_member_read on public.nudge_ledger
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke insert, update, delete, truncate, references, trigger
  on public.nudge_ledger from authenticated;
revoke all on public.nudge_ledger from anon;

-- ---------------------------------------------------------------------------
-- record_nudge: append one nudge to the ledger (service-role only). Called by
-- the runner AFTER an overdue-invoice send executes, so the next run sees it.
-- Idempotency of the SEND itself is the side_effects table's job; this is a
-- plain append used only for cadence accounting, so a rare duplicate row is
-- harmless (it can only make the floor MORE conservative, never less).
-- ---------------------------------------------------------------------------
create or replace function public.record_nudge(
  p_account uuid,
  p_nibbin uuid,
  p_resource_kind text,
  p_resource_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.nudge_ledger (account_id, nibbin_id, resource_kind, resource_id)
  values (p_account, p_nibbin, p_resource_kind, p_resource_id);
end;
$$;
revoke execute on function public.record_nudge(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_nudge(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Add the 'nudge_record_failed' telemetry event to the product_events
-- allowlist. The runner emits it when a nudge-ledger WRITE fails after a send
-- executed; a SUSTAINED failure would silently reset the cadence/count cap and
-- resume per-tick spam, so it must be observable (alarmed), not just logged.
-- Recreated byte-for-byte from the live emit_product_event (membership gate +
-- drip pattern preserved); the only change is the one new name in the IN-list.
-- ---------------------------------------------------------------------------
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
    'plan_upgraded', 'topup_purchased', 'capability_unfulfilled', 'connector_blocked',
    'nudge_record_failed'
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
