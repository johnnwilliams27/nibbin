-- Spec 4: provenance log for the one-time onboarding Gmail sweep.
-- No _no_delete rewrite rule: both FKs carry on delete cascade, which is
-- incompatible with audit-style rewrite rules (see AGREEMENTS on FK/audit-rule
-- incompatibility). Service role writes; account members may read their own row.

create table public.gmail_sweep_log (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  connection_id    uuid not null references public.connections(id) on delete cascade,
  swept_at         timestamptz not null default now(),
  status           text not null check (status in ('complete', 'partial', 'failed')),
  messages_read    int not null default 0,
  oldest_message_date date,
  error_summary    text
);

alter table public.gmail_sweep_log enable row level security;
revoke all on public.gmail_sweep_log from authenticated, anon;

create policy "account members read own sweep log"
  on public.gmail_sweep_log for select
  using (
    account_id in (
      select account_id from public.account_members
      where user_id = auth.uid()
    )
  );

create index gmail_sweep_log_account_idx on public.gmail_sweep_log (account_id, swept_at desc);
