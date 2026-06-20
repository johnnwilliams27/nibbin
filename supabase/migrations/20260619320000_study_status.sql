-- Study-visibility Slice 1 (SPEC §5): track the lifecycle of an active field
-- study as reported by the desktop Observer. The desktop POSTs to
-- /api/study/status whenever a study starts or stops; the web grove home reads
-- this table to surface an "in-progress" card while the study runs.
--
-- Service-role writes only (the route uses serviceClient()). Authenticated users
-- get member-scoped read so the web server component can query under the session
-- client without needing service-role privileges on the read path.

create table if not exists public.study_status (
  id          uuid        primary key default gen_random_uuid(),
  account_id  uuid        not null references public.accounts (id) on delete cascade,
  study_id    text        not null,
  kind        text        not null check (kind in ('full_study', 'quick_scan')),
  label       text        check (label is null or char_length(label) <= 120),
  status      text        not null check (status in ('active', 'paused', 'stopped')),
  started_at  timestamptz not null default now(),
  ends_at     timestamptz,
  updated_at  timestamptz not null default now(),
  unique (account_id, study_id)
);

alter table public.study_status enable row level security;

drop policy if exists study_status_member_read on public.study_status;
create policy study_status_member_read on public.study_status
  for select to authenticated using ((select private.is_account_member(account_id)));

-- Authenticated clients (session-scoped reads) never write; only service-role
-- does (via /api/study/status). Anon is locked out entirely.
revoke insert, update, delete, truncate, references, trigger
  on public.study_status from authenticated;
revoke all on public.study_status from anon;
