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
