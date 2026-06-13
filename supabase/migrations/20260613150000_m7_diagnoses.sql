-- M7: diagnoses (SPEC §4.5, §5, §8). The Observer uploads a redacted, structured
-- synthesis packet (C7 — pixels never leave the device, only this); the cloud
-- synthesizes a workflow map. §6.11: the packet BECOMES the diagnosis and is
-- deleted with it, so packet + map live on one row.
--
-- Member-readable; written server-side only (the user-initiated upload endpoint
-- runs synthesis and inserts via the service role) — no direct client write path.
-- Mutable on purpose: synthesis is staged (deterministic map now; the Opus
-- labeling + Keeper letter layer on later), so UPDATE stays open to the service
-- role. Operational/retention record, not a ledger: DELETE allowed so the §6.11
-- clocks + #29 erasure can run; FK cascades.

create table public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  status text not null default 'ready' check (status in ('synthesizing', 'ready')),
  packet jsonb not null check (pg_column_size(packet) <= 262144),
  map jsonb not null default '{}'::jsonb check (pg_column_size(map) <= 262144),
  letter text check (letter is null or char_length(letter) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index diagnoses_account_idx on public.diagnoses (account_id, created_at desc);

alter table public.diagnoses enable row level security;

create policy diagnoses_member_read on public.diagnoses
  for select to authenticated
  using ((select private.is_account_member(account_id)));

-- anon touches nothing; clients never write directly (service role only).
revoke all on public.diagnoses from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.diagnoses from authenticated;
