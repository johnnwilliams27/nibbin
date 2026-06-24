-- C1/C2: source_authority — learned per-(account, source_kind) weight.
-- Tasks 2 and 3 RPCs (flag_field_conflict, resolve_field_flag) will be
-- appended to this file in their respective tasks.

create table public.source_authority (
  account_id  uuid not null references public.accounts (id) on delete cascade,
  source_kind text not null check (source_kind in ('document','connector_artifact','observation','manual')),
  weight      numeric not null default 50 check (weight >= 0 and weight <= 100),
  updated_at  timestamptz not null default now(),
  primary key (account_id, source_kind)
);

-- RLS: member-read, no direct client writes (service_role / RPCs only)
alter table public.source_authority enable row level security;

create policy source_authority_member_read on public.source_authority
  for select to authenticated
  using ((select private.is_account_member(account_id)));

revoke all on public.source_authority from anon;
revoke insert, update, delete, truncate, references, trigger on public.source_authority from authenticated;
