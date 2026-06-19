# Reach-Me Channels 01 — Schema Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the additive database layer for the multi-channel reach-me system — the channel registry, one-time linking nonces, per-channel preferences, account notification settings, the delivery/inbound message log, and conversation threads — with RLS and the member-facing mutation RPCs everything downstream depends on.

**Architecture:** Five new tables + one extended-settings table, all following the established Nibbin posture: RLS member-**read**, all writes revoked from `authenticated`, mutations routed through audited `security definer` RPCs that check `private.is_account_member`. Tamper-evidence (where needed) uses `BEFORE` triggers, never rewrite rules, so `ON DELETE CASCADE` stays intact (retention/erasure jobs must be able to purge). Channels carry **no OAuth token and no vault entry** — `external_id` is PII-but-not-secret (spec N9), so it lives directly under RLS.

**Tech Stack:** Postgres (Supabase) migrations; the `tests/rls/` Vitest + `RlsHarness` suite (docker `postgres:17-alpine` on `:54329`).

## Global Constraints
- Migration file naming: `YYYYMMDDHHMM00_<name>.sql`. This plan uses `20260618030000_*` and `20260618040000_*` as placeholders — **the orchestrator picks the next free timestamp at apply/rebase time** (parallel branches may collide; renumber on rebase).
- Channels enum (every table + RPC): `('push','email','sms','telegram','whatsapp')`. `conversation_threads` additionally allows `'in_app'`.
- RLS: `enable row level security` + a `..._member_read` `for select to authenticated using ((select private.is_account_member(account_id)))` policy + `revoke all ... from anon` + `revoke insert, update, delete, truncate, references, trigger ... from authenticated`.
- Every member mutation RPC: guard `auth.uid()` not null → guard `private.is_account_member(target_account)` → mutate → insert `audit_log` (`actor='user'`, `actor_id=uid::text`, dotted `action`, `subject`, `meta` jsonb) → `revoke execute ... from public, anon, service_role` + `grant execute ... to authenticated`. All param refs in `update`/`insert` are function-qualified (e.g. `set_channel_prefs.enabled`) to avoid column ambiguity, mirroring `set_notification_prefs` (`supabase/migrations/20260617200000_notification_prefs.sql:32-36`).
- **Migrations are FILES only.** Do NOT apply to any database. The orchestrator applies to dev/staging/prod via MCP after review and hash-verifies all three.
- Do NOT touch `reference/*.html`.

## File Structure
- **Create** `supabase/migrations/20260618030000_reach_me_channels.sql` — the six tables, indexes, RLS.
- **Create** `supabase/migrations/20260618040000_reach_me_channel_rpcs.sql` — member RPCs (`request_channel_link`, `set_channel_prefs`, `set_notification_settings`, `revoke_channel`) + the service-role `verify_channel_binding`.
- **Create** `tests/rls/reach-me-channels.test.ts` — the RLS attack suite + RPC behavior tests.

---

### Task 1: Tables, indexes, RLS

**Files:**
- Create: `supabase/migrations/20260618030000_reach_me_channels.sql`

**Interfaces:**
- Produces (consumed by Tasks 2–3 and downstream plans): tables `notification_channels`, `channel_verifications`, `channel_prefs`, `notification_settings`, `channel_messages`, `conversation_threads`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260618030000_reach_me_channels.sql`:

```sql
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
```

- [ ] **Step 2: Verify the file parses against the local RLS database (do NOT touch dev/staging/prod).**

Run: `cd /c/nibbin-reach-me && node tests/rls/apply-check.mjs 2>/dev/null || echo "no apply-check helper — verify via Task 3 harness reset instead"`

Expected: either a clean apply, or the fallback message (the harness `reset()` in Task 3 applies every migration and is the real gate). If `reset()` later fails to apply this file, fix the SQL here.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260618030000_reach_me_channels.sql
git commit -m "feat(db): reach-me channel schema — registry, nonces, prefs, message log, threads + RLS"
```

---

### Task 2: Member mutation RPCs + service-role verify

**Files:**
- Create: `supabase/migrations/20260618040000_reach_me_channel_rpcs.sql`

**Interfaces:**
- Consumes: the Task 1 tables; `private.is_account_member(uuid)` (`20260610170000_*:169`); `public.audit_log`.
- Produces (consumed by downstream plans 02–05):
  - `public.request_channel_link(target_account uuid, channel text) returns text` — inserts a `pending` `notification_channels` placeholder is **not** done here (external_id unknown until callback); instead issues + returns a single-use `nonce`. Authenticated-only.
  - `public.set_channel_prefs(target_account uuid, channel text, enabled boolean, priority smallint, urgency_threshold text) returns void` — upsert. Authenticated-only.
  - `public.set_notification_settings(target_account uuid, quiet_start smallint, quiet_end smallint, digest_mode text) returns void` — upsert. Authenticated-only.
  - `public.revoke_channel(target_account uuid, channel_id uuid) returns void` — flips a channel to `revoked`. Authenticated-only.
  - `public.verify_channel_binding(p_nonce text, p_external_id text, p_external_label text) returns uuid` — **service-role-only**; consumes a nonce, upserts the verified `notification_channels` row, returns its id. Used by the Plan 03 inbound webhook.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260618040000_reach_me_channel_rpcs.sql`:

```sql
-- Reach-Me channels — mutation RPCs. Member-facing functions mirror
-- set_notification_prefs (20260617200000): auth.uid guard, is_account_member
-- guard, audit_log insert, revoke-from-all + grant-to-authenticated. The
-- verify function is service-role-only (the inbound webhook consumes the nonce
-- under the service role; the external sender is never authenticated).

-- request_channel_link: issue a single-use, short-TTL nonce the app shows the
-- user to complete linking (e.g. Telegram `/start <nonce>`). No channel row is
-- created yet — the external_id is unknown until the callback verifies the nonce.
create or replace function public.request_channel_link(
  target_account uuid,
  channel text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_nonce text := encode(gen_random_bytes(18), 'hex');
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if channel not in ('push','email','sms','telegram','whatsapp') then
    raise exception 'unknown channel %', channel;
  end if;
  insert into public.channel_verifications (account_id, channel, nonce, expires_at)
  values (target_account, channel, v_nonce, now() + interval '30 minutes');
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'channel.link_requested', target_account::text,
    jsonb_build_object('channel', channel));
  return v_nonce;
end;
$$;
revoke execute on function public.request_channel_link(uuid, text) from public, anon, service_role;
grant execute on function public.request_channel_link(uuid, text) to authenticated;

-- set_channel_prefs: upsert per-channel enable/priority/urgency.
create or replace function public.set_channel_prefs(
  target_account uuid,
  channel text,
  enabled boolean,
  priority smallint,
  urgency_threshold text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if channel not in ('push','email','sms','telegram','whatsapp') then
    raise exception 'unknown channel %', channel;
  end if;
  if priority < 0 or priority > 1000 then
    raise exception 'priority must be between 0 and 1000';
  end if;
  if urgency_threshold not in ('all','normal','high','urgent') then
    raise exception 'invalid urgency threshold %', urgency_threshold;
  end if;
  insert into public.channel_prefs (account_id, channel, enabled, priority, urgency_threshold)
  values (target_account, set_channel_prefs.channel, set_channel_prefs.enabled,
          set_channel_prefs.priority, set_channel_prefs.urgency_threshold)
  on conflict (account_id, channel) do update
    set enabled = set_channel_prefs.enabled,
        priority = set_channel_prefs.priority,
        urgency_threshold = set_channel_prefs.urgency_threshold,
        updated_at = now();
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'channel.prefs_set', target_account::text,
    jsonb_build_object('channel', channel, 'enabled', enabled, 'priority', priority,
                       'urgency_threshold', urgency_threshold));
end;
$$;
revoke execute on function public.set_channel_prefs(uuid, text, boolean, smallint, text) from public, anon, service_role;
grant execute on function public.set_channel_prefs(uuid, text, boolean, smallint, text) to authenticated;

-- set_notification_settings: upsert account-level quiet hours + digest mode.
create or replace function public.set_notification_settings(
  target_account uuid,
  quiet_start smallint,
  quiet_end smallint,
  digest_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if quiet_start < 0 or quiet_start > 23 or quiet_end < 0 or quiet_end > 23 then
    raise exception 'quiet hours must be between 0 and 23';
  end if;
  if digest_mode not in ('off','smart','daily') then
    raise exception 'invalid digest mode %', digest_mode;
  end if;
  insert into public.notification_settings (account_id, quiet_start, quiet_end, digest_mode)
  values (target_account, set_notification_settings.quiet_start, set_notification_settings.quiet_end,
          set_notification_settings.digest_mode)
  on conflict (account_id) do update
    set quiet_start = set_notification_settings.quiet_start,
        quiet_end = set_notification_settings.quiet_end,
        digest_mode = set_notification_settings.digest_mode,
        updated_at = now();
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.notification_settings_set', target_account::text,
    jsonb_build_object('quiet_start', quiet_start, 'quiet_end', quiet_end, 'digest_mode', digest_mode));
end;
$$;
revoke execute on function public.set_notification_settings(uuid, smallint, smallint, text) from public, anon, service_role;
grant execute on function public.set_notification_settings(uuid, smallint, smallint, text) to authenticated;

-- revoke_channel: flip a member's channel to revoked (cascade-safe; future
-- inbound from this external_id will no longer resolve to the account).
create or replace function public.revoke_channel(
  target_account uuid,
  channel_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  changed int;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  update public.notification_channels
     set status = 'revoked', revoked_at = now()
   where id = channel_id and account_id = target_account and status <> 'revoked';
  get diagnostics changed = row_count;
  if changed > 0 then
    insert into public.audit_log (account_id, actor, actor_id, action, subject)
    values (target_account, 'user', uid::text, 'channel.revoked', channel_id::text);
  end if;
end;
$$;
revoke execute on function public.revoke_channel(uuid, uuid) from public, anon, service_role;
grant execute on function public.revoke_channel(uuid, uuid) to authenticated;

-- verify_channel_binding: SERVICE-ROLE ONLY. The inbound webhook calls this
-- with the nonce echoed back by the provider + the now-known external_id.
-- Consumes the nonce (single-use, unexpired), upserts the verified channel row,
-- seeds default prefs, returns the channel id. Returns null if the nonce is
-- unknown/consumed/expired (the caller flags + ignores — no info-leaking reply).
create or replace function public.verify_channel_binding(
  p_nonce text,
  p_external_id text,
  p_external_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_channel_id uuid;
begin
  select * into v from public.channel_verifications
   where nonce = p_nonce and status = 'issued' and expires_at > now()
   for update;
  if not found then
    return null;
  end if;
  update public.channel_verifications
     set status = 'consumed', consumed_at = now()
   where id = v.id;
  insert into public.notification_channels (account_id, channel, external_id, external_label, status, verified_at)
  values (v.account_id, v.channel, p_external_id, p_external_label, 'verified', now())
  on conflict (account_id, channel, external_id) where status <> 'revoked'
  do update set status = 'verified', verified_at = now(),
               external_label = coalesce(excluded.external_label, public.notification_channels.external_label)
  returning id into v_channel_id;
  insert into public.channel_prefs (account_id, channel)
  values (v.account_id, v.channel)
  on conflict (account_id, channel) do nothing;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (v.account_id, 'system', 'service', 'channel.verified', v_channel_id::text,
    jsonb_build_object('channel', v.channel));
  return v_channel_id;
end;
$$;
revoke execute on function public.verify_channel_binding(text, text, text) from public, anon, authenticated;
grant execute on function public.verify_channel_binding(text, text, text) to service_role;
```

- [ ] **Step 2: Re-read for ambiguity + grant correctness.** Confirm every `insert/update` references params as `<fn>.<param>` (not bare), the member RPCs are `grant ... to authenticated` (revoked from service_role), and `verify_channel_binding` is the inverse (`grant ... to service_role`, revoked from authenticated). Report.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260618040000_reach_me_channel_rpcs.sql
git commit -m "feat(db): reach-me channel mutation RPCs + service-role verify_channel_binding"
```

---

### Task 3: RLS + RPC behavior test suite

**Files:**
- Create: `tests/rls/reach-me-channels.test.ts`

**Interfaces:**
- Consumes: `RlsHarness` (`tests/rls/harness.ts`) — `h.reset()`, `h.as(identity, fn)`, `h.sql(...)`, `h.close()`; `public.create_account_with_owner(text)`.

- [ ] **Step 1: Write the failing test**

Create `tests/rls/reach-me-channels.test.ts` (mirrors `tests/rls/drip.test.ts:1-71` setup):

```ts
/**
 * RLS + RPC suite for the reach-me channel tables (spec §9). Members read only
 * their own rows; nobody but the service role can write directly; mutations go
 * through the audited member RPCs; verify_channel_binding is service-role-only
 * and single-use.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping reach-me channels suite');
}

const UID_A = 'aaaaaaaa-7777-4777-8777-777777777777';
const UID_B = 'bbbbbbbb-8888-4888-8888-888888888888';

describe.skipIf(!dbAvailable)('reach-me channels RLS + RPCs', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'ca@example.test'), ($2, 'cb@example.test')`, [
      UID_A,
      UID_B,
    ]);
    for (const [who, uid] of [
      [asA, UID_A],
      [asB, UID_B],
    ] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `${uid}@example.test`]);
      });
    }
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('A Grove') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('B Grove') as id`)).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it('a member can request a link nonce; a non-member cannot', async () => {
    const nonce = await h.as(asA, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'telegram') as n`, [accountA])).rows[0].n,
    );
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(20);

    await expect(
      h.as(asB, async (c) => c.query(`select public.request_channel_link($1, 'telegram')`, [accountA])),
    ).rejects.toThrow(/not a member/);
  });

  it('verify_channel_binding is service-role only and single-use', async () => {
    const nonce = await h.as(asA, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'telegram') as n`, [accountA])).rows[0].n,
    );
    // authenticated cannot call it
    await expect(
      h.as(asA, async (c) => c.query(`select public.verify_channel_binding($1, '12345', '@maya')`, [nonce])),
    ).rejects.toThrow();
    // service role consumes it once
    const chId = await h.as(service, async (c) =>
      (await c.query(`select public.verify_channel_binding($1, '12345', '@maya') as id`, [nonce])).rows[0].id,
    );
    expect(chId).toBeTruthy();
    // second use returns null (already consumed)
    const second = await h.as(service, async (c) =>
      (await c.query(`select public.verify_channel_binding($1, '12345', '@maya') as id`, [nonce])).rows[0].id,
    );
    expect(second).toBeNull();
    // the channel row is verified and readable by its owner only
    const aRows = await h.as(asA, async (c) =>
      (await c.query(`select status, channel from public.notification_channels`)).rows,
    );
    expect(aRows).toEqual([{ status: 'verified', channel: 'telegram' }]);
    const bRows = await h.as(asB, async (c) =>
      (await c.query(`select * from public.notification_channels where account_id = $1`, [accountA])).rows,
    );
    expect(bRows).toHaveLength(0);
  });

  it('set_channel_prefs upserts and is membership-checked', async () => {
    await h.as(asA, async (c) =>
      c.query(`select public.set_channel_prefs($1, 'sms', false, 50::smallint, 'urgent')`, [accountA]),
    );
    const prefs = await h.as(asA, async (c) =>
      (await c.query(`select enabled, priority, urgency_threshold from public.channel_prefs where channel = 'sms'`))
        .rows[0],
    );
    expect(prefs).toEqual({ enabled: false, priority: 50, urgency_threshold: 'urgent' });
    await expect(
      h.as(asB, async (c) => c.query(`select public.set_channel_prefs($1, 'sms', true, 10::smallint, 'all')`, [accountA])),
    ).rejects.toThrow(/not a member/);
  });

  it('set_notification_settings upserts quiet hours + digest', async () => {
    await h.as(asA, async (c) =>
      c.query(`select public.set_notification_settings($1, 22::smallint, 7::smallint, 'daily')`, [accountA]),
    );
    const s = await h.as(asA, async (c) =>
      (await c.query(`select quiet_start, quiet_end, digest_mode from public.notification_settings`)).rows[0],
    );
    expect(s).toEqual({ quiet_start: 22, quiet_end: 7, digest_mode: 'daily' });
  });

  it('revoke_channel flips status; revoked binding no longer resolves', async () => {
    const nonce = await h.as(asA, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'whatsapp') as n`, [accountA])).rows[0].n,
    );
    const chId = await h.as(service, async (c) =>
      (await c.query(`select public.verify_channel_binding($1, '447700', null) as id`, [nonce])).rows[0].id,
    );
    await h.as(asA, async (c) => c.query(`select public.revoke_channel($1, $2)`, [accountA, chId]));
    const row = await h.as(asA, async (c) =>
      (await c.query(`select status, revoked_at from public.notification_channels where id = $1`, [chId])).rows[0],
    );
    expect(row.status).toBe('revoked');
    expect(row.revoked_at).not.toBeNull();
  });

  it('anon sees nothing; authenticated cannot write directly', async () => {
    for (const table of [
      'notification_channels',
      'channel_verifications',
      'channel_prefs',
      'notification_settings',
      'channel_messages',
      'conversation_threads',
    ]) {
      await expect(h.as(anon, async (c) => c.query(`select * from public.${table}`))).rejects.toThrow();
    }
    await expect(
      h.as(asA, async (c) =>
        c.query(`insert into public.channel_prefs (account_id, channel) values ($1, 'sms')`, [accountA]),
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/nibbin-reach-me && npx vitest run tests/rls/reach-me-channels.test.ts`
Expected: FAIL — `h.reset()` applies the new migrations; tests fail until the SQL in Tasks 1–2 is correct (or, if the docker DB is unavailable, the suite is skipped — then this plan's gate is the orchestrator's apply against dev).

- [ ] **Step 3: Fix any SQL** revealed by the run (constraint typos, grant direction, ambiguous params). Re-run until green.

- [ ] **Step 4: Run to verify it passes**

Run: `cd /c/nibbin-reach-me && npx vitest run tests/rls/reach-me-channels.test.ts`
Expected: PASS (or skipped if no DB).

- [ ] **Step 5: Commit**

```bash
git add tests/rls/reach-me-channels.test.ts
git commit -m "test(rls): reach-me channel tables + mutation RPCs"
```

---

## Self-review notes
- **Spec §9 coverage:** `notification_channels` (registry) ✓, `channel_verifications` (nonces) ✓, `channel_prefs` ✓, `channel_messages` (delivery + inbound log w/ COGS + redaction columns) ✓, `conversation_threads` ✓. Account-level quiet-hours/digest → `notification_settings` (the spec's "single per-account row" option). Reuses existing `notifications` leaf + `drip_arcs` quiet-hours (untouched here; Plan 04 reconciles the email-arc quiet-hours with `notification_settings` in the UI).
- **N9 (external_id is PII not secret):** stored under RLS, no vault, no `token_ref`. The app-level Telegram bot token lives in env (Plan 02).
- **FK/audit-rule pattern:** `channel_messages` is mutable (status transitions) → service-role write + member read like `drip_sends`, NOT append-only; all tables `on delete cascade` so the §6.11 retention/erasure purge runs.
- **Security:** member RPCs follow `set_notification_prefs` exactly (auth.uid → is_account_member → mutate → audit → revoke/grant); `verify_channel_binding` is the service-role inverse and single-use (consumes the nonce under `for update`).
- **Not applied here:** migrations are files; the orchestrator applies to dev/staging/prod and hash-verifies. Timestamps are placeholders — renumber on rebase.
- **Deferred-with-reason:** the inbound webhook that *calls* `verify_channel_binding`, and the outbound writer to `channel_messages`, are Plans 03/02 — this plan is the data layer only.
