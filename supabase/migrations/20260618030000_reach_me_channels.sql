-- Reach-Me & Conversational Channels — schema foundation (spec §9; AS-§13).
-- Additive tables for the multi-channel reach layer. Conventions mirror M5
-- (drip_arcs/notifications): RLS member-read, all writes revoked from
-- authenticated (mutation via the security-definer RPCs in the companion
-- migration). Tamper-evidence uses BEFORE triggers (private.raise_append_only),
-- never rewrite rules, so ON DELETE CASCADE stays compatible with the §6.11
-- retention/erasure purge (AGREEMENTS FK/audit-rule incompatibility).
-- external_id (Telegram chat id, phone, device token) is PII but NOT a secret
-- (N9): it lives here under RLS, no vault. The Telegram bot token is app-level
-- env, not per-account, so channels need no token_ref.

-- ── channel registry ──────────────────────────────────────────────────────
create table public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  channel text not null check (channel in ('push','email','sms','telegram','whatsapp')),
  external_id text not null check (btrim(external_id) <> ''),
  external_label text,                       -- friendly display (@handle, masked phone) — not a secret
  status text not null default 'pending' check (status in ('pending','verified','revoked')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- verified_at is set once verified and stays set after revoke (audit trail),
  -- so this is one-directional, not a biconditional.
  constraint notification_channels_verified_has_ts check (status <> 'verified' or verified_at is not null),
  constraint notification_channels_revoked_consistent check ((status = 'revoked') = (revoked_at is not null))
);
-- one live binding per (account, channel, external_id); re-link allowed after revoke
create unique index notification_channels_unique_live
  on public.notification_channels (account_id, channel, external_id)
  where status <> 'revoked';
create index notification_channels_account_idx
  on public.notification_channels (account_id, channel);
-- inbound resolution path (N-P3): (channel, external_id) -> account, verified only
create index notification_channels_lookup_idx
  on public.notification_channels (channel, external_id)
  where status = 'verified';

alter table public.notification_channels enable row level security;
create policy notification_channels_member_read on public.notification_channels
  for select to authenticated
  using ((select private.is_account_member(account_id)));
revoke all on public.notification_channels from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.notification_channels from authenticated;

-- ── one-time linking nonces (N-P3) ────────────────────────────────────────
create table public.channel_verifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  channel text not null check (channel in ('push','email','sms','telegram','whatsapp')),
  nonce text not null unique check (btrim(nonce) <> ''),
  status text not null default 'issued' check (status in ('issued','consumed','expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint channel_verifications_consumed_consistent check ((status = 'consumed') = (consumed_at is not null))
);
create index channel_verifications_account_idx on public.channel_verifications (account_id, channel);
alter table public.channel_verifications enable row level security;
-- members read their own pending nonce so the app can render the linking deep-link
create policy channel_verifications_member_read on public.channel_verifications
  for select to authenticated
  using ((select private.is_account_member(account_id)));
revoke all on public.channel_verifications from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.channel_verifications from authenticated;

-- ── per-channel preferences ───────────────────────────────────────────────
create table public.channel_prefs (
  account_id uuid not null references public.accounts (id) on delete cascade,
  channel text not null check (channel in ('push','email','sms','telegram','whatsapp')),
  enabled boolean not null default true,
  priority smallint not null default 100 check (priority between 0 and 1000),  -- lower = tried first
  urgency_threshold text not null default 'all'
    check (urgency_threshold in ('all','normal','high','urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, channel)
);
alter table public.channel_prefs enable row level security;
create policy channel_prefs_member_read on public.channel_prefs
  for select to authenticated
  using ((select private.is_account_member(account_id)));
revoke all on public.channel_prefs from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.channel_prefs from authenticated;

-- ── account-level notification settings (quiet hours + digest) ────────────
-- Generalizes the drip_arcs quiet-hours sliver to all channels. drip_arcs
-- keeps its own quiet-hours for the email arc until Plan 04 reconciles the UI;
-- this row is the canonical per-account quiet/digest for the multi-channel layer.
create table public.notification_settings (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  quiet_start smallint not null default 21 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 9 check (quiet_end between 0 and 23),
  digest_mode text not null default 'smart' check (digest_mode in ('off','smart','daily')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
create policy notification_settings_member_read on public.notification_settings
  for select to authenticated
  using ((select private.is_account_member(account_id)));
revoke all on public.notification_settings from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.notification_settings from authenticated;

-- ── delivery + inbound message log ────────────────────────────────────────
-- Mutable (status transitions pending->delivered/failed/fallback), so this
-- follows drip_sends (service-role write, member read), NOT append-only.
-- Deletable so the D-N3 90-day retention purge can run.
create table public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  channel text not null check (channel in ('push','email','sms','telegram','whatsapp')),
  direction text not null check (direction in ('outbound','inbound')),
  kind text not null check (kind in ('escalation','beat','news','reply','inbound')),
  status text not null default 'pending'
    check (status in ('pending','delivered','failed','fallback','received')),
  urgency text check (urgency in ('normal','high','urgent')),
  provider_message_id text,
  cost_microusd bigint not null default 0 check (cost_microusd >= 0),  -- delivery COGS (SMS/WhatsApp)
  request_id uuid,                          -- soft ref to a runtime AgentRequest/escalation
  redacted_text text,                       -- inbound only: post-applyBattery, quarantined
  redaction_rules text[] not null default '{}',
  verified boolean not null default false,  -- inbound only: passed identity check (N-P3)
  created_at timestamptz not null default now()
);
create index channel_messages_account_idx on public.channel_messages (account_id, created_at desc);
create index channel_messages_cost_idx on public.channel_messages (account_id, channel, created_at);
alter table public.channel_messages enable row level security;
create policy channel_messages_member_read on public.channel_messages
  for select to authenticated
  using ((select private.is_account_member(account_id)));
revoke all on public.channel_messages from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.channel_messages from authenticated;

-- ── conversation threads (compacted, redaction-aware) ─────────────────────
create table public.conversation_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  channel text not null check (channel in ('push','email','sms','telegram','whatsapp','in_app')),
  external_id text,                          -- channel thread/chat id; null for in_app
  summary text not null default '',          -- compacted thread state (redaction-aware)
  last_turn_at timestamptz,
  turn_count integer not null default 0 check (turn_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversation_threads_account_idx on public.conversation_threads (account_id, channel);
alter table public.conversation_threads enable row level security;
create policy conversation_threads_member_read on public.conversation_threads
  for select to authenticated
  using ((select private.is_account_member(account_id)));
revoke all on public.conversation_threads from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.conversation_threads from authenticated;
