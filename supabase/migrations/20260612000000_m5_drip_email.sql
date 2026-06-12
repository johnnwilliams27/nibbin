-- M5: the 14-day companion arc (SPEC §4.5) + email mirror plumbing (§6.8).
--
-- Tables: drip_arcs (one per account), drip_sends (the beat ledger — its
-- unique indexes ARE the double-send guard), notifications (the in-product
-- leaf), email_suppressions (CAN-SPAM suppression list, live before the
-- first send), email_sends (send log feeding the warm-up daily cap).
--
-- Conventions follow M1/M2: RLS member read where members may read, zero
-- direct client writes, client mutation through security-definer functions
-- only. The drip worker writes with the service role. Suppressions and the
-- send log hold bare email addresses, so clients can read NEITHER.

-- ── drip arcs ────────────────────────────────────────────────────────────────

create table public.drip_arcs (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  started_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  email_enabled boolean not null default true,
  -- Quiet hours in the user's local time, [start, end) wrapping midnight.
  quiet_start smallint not null default 21 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 9 check (quiet_end between 0 and 23),
  created_at timestamptz not null default now()
);

alter table public.drip_arcs enable row level security;

create policy drip_arcs_member_read on public.drip_arcs
  for select to authenticated
  using ((select private.is_account_member(account_id)));

revoke all on public.drip_arcs from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.drip_arcs from authenticated;

-- ── the beat ledger ──────────────────────────────────────────────────────────

create table public.drip_sends (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.drip_arcs (account_id) on delete cascade,
  beat text not null check (beat in (
    'field_notes_1', 'species', 'training_1', 'journal', 'study_whisper',
    'scan_depth', 'half_time', 'training_2', 'map_preview', 'graduation_eve',
    'diagnosis_reveal'
  )),
  -- The §4.5 table slot this delivery resolves. study_whisper/scan_depth are
  -- ONE slot (day 5) under two keys — uniqueness must live on the slot, or a
  -- worker whose study flag flips between ticks delivers day 5 twice.
  slot text not null check (slot in (
    'field_notes_1', 'species', 'training_1', 'journal', 'study_whisper',
    'half_time', 'training_2', 'map_preview', 'graduation_eve',
    'diagnosis_reveal'
  )),
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'skipped')),
  -- The user's LOCAL calendar day this push claims (max one push/day).
  local_day date not null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  -- A slot fires once per arc, ever — sent, failed, or skipped.
  unique (account_id, slot)
);

-- One push per local day. Partial: skipped rows are bookkeeping, not pushes.
-- Failed rows DO hold the slot — a beat that died mid-send must not let a
-- second push claim the same day (we'd rather drop a beat than double-push).
create unique index drip_sends_one_push_per_day
  on public.drip_sends (account_id, local_day)
  where status <> 'skipped';

create index drip_sends_account_idx on public.drip_sends (account_id, claimed_at);

alter table public.drip_sends enable row level security;

create policy drip_sends_member_read on public.drip_sends
  for select to authenticated
  using ((select private.is_account_member(account_id)));

revoke all on public.drip_sends from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.drip_sends from authenticated;

-- ── notifications (the leaf) ─────────────────────────────────────────────────

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind text not null check (kind in ('beat', 'evolution', 'graduation')),
  -- Beat key for beats; the earned event id for School events. Dedup anchor:
  -- worker retries must never stack duplicate leaves.
  source_id text not null check (btrim(source_id) <> ''),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  body text not null check (char_length(body) <= 2000),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 8192),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (account_id, kind, source_id)
);

create index notifications_account_idx on public.notifications (account_id, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_member_read on public.notifications
  for select to authenticated
  using ((select private.is_account_member(account_id)));

revoke all on public.notifications from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.notifications from authenticated;

-- The single client write path: marking a leaf read.
create function public.mark_notification_read(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications n
     set read_at = coalesce(n.read_at, now())
   where n.id = target_id
     and (select private.is_account_member(n.account_id));
  -- No row = not a member or no such leaf; silently a no-op either way
  -- (a read receipt is not worth an information-leaking error).
end;
$$;

grant execute on function public.mark_notification_read(uuid) to authenticated;
revoke execute on function public.mark_notification_read(uuid) from anon, public;

-- ── email suppression list (CAN-SPAM — live before the first send) ───────────
-- Keyed by bare address, NOT account: a bounce or complaint suppresses the
-- mailbox itself, and the unsubscribe link must work without a login.

create table public.email_suppressions (
  email text primary key check (
    email = lower(btrim(email)) and position('@' in email) > 1
  ),
  reason text not null check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
  created_at timestamptz not null default now()
);

alter table public.email_suppressions enable row level security;

-- Bare addresses: clients read nothing, write nothing. Service role only.
revoke all on public.email_suppressions from anon, authenticated;

-- ── send log (feeds the §6.8 warm-up daily cap; service role only) ───────────
-- Cascades with the account: the published §6.11 clock says account data is
-- gone ≤30 days after verified deletion, and this table holds bare addresses.
-- The warm-up cap only ever counts TODAY's rows, so losing history is free.
-- (email_suppressions intentionally outlives accounts — the unsubscribe/
-- bounce record must keep being honored; needs its own row on the claims
-- surfaces, tracked in the M5 PR.)

create table public.email_sends (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  to_email text not null,
  beat text not null,
  provider_id text,
  sent_at timestamptz not null default now()
);

create index email_sends_sent_at_idx on public.email_sends (sent_at);

alter table public.email_sends enable row level security;

revoke all on public.email_sends from anon, authenticated;
