# Reach-Me Go-Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five remaining go-live gaps on the merged reach-me/conversational-channels feature: Telegram webhook registration, the SMS START re-subscribe handler, drip→`notification_settings` quiet-hours unification, spend-cap window alignment + soft-warn, and the adaptive-baseline anomaly check.

**Architecture:** All work sits on top of the already-merged `@nibbin/channels` package + `apps/web/lib/channels` wiring. Four new SQL migrations (service-definer RPCs) + targeted TS edits. No new packages. Telegram/SMS data model is unchanged; we add one RPC each for opt-in and anomaly, plus a soft-warn dedup table.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres 17), TypeScript (NodeNext), `@nibbin/channels` + `@nibbin/drip` workspaces, Vitest.

## Global Constraints

- **Extensionless relative imports** in `packages/**` and `apps/web/**` — NodeNext `.js` specifiers break the webpack build (`transpilePackages` + `extensionAlias`). Before any PR, grep changed files for `from '\..*\.js'` and remove the `.js`.
- **Every new SQL function:** `security definer`, `set search_path = ''`, fully-qualified (`public.` / `private.` / `auth.`) identifiers, `revoke execute ... from public, anon` (+ `authenticated` for service-role-only), explicit `grant` to the intended role. Mirror the existing reach-me RPCs exactly.
- **`gen_random_bytes`/`gen_random_uuid` etc. must be `public.`-qualified** under `search_path = ''`.
- **Append-only tables** (e.g. `audit_log`) are written via plain `insert` only; never add rewrite rules. Mirror the exact `audit_log` column list used by `sms_opt_out` / `set_notification_prefs`: `(account_id, actor, actor_id, action, subject, meta)`.
- **Constraint drop+re-add must re-add the CURRENT full value set** — grep the latest definition first (a prior bug dropped `nudge`/`demotion` from `notifications_kind_check`).
- **Migrations are numbered `20260619NNNNNN`** (after `20260618160000`), applied to dev→staging→prod via Supabase MCP **at merge time, not before**. The last existing migration is `supabase/migrations/20260618160000_sms_opt_out_rpc.sql`.
- **Budget gate is fail-CLOSED** (deny the turn on RPC error); **anomaly is fail-OPEN** (advisory; a query error must not block turns).
- **Before the PR:** run `npm run lint` (eslint) AND full `npm test` AND `next build` — not just `tsc` + a subset of vitest.
- `main` is PR-protected: land via feature branch (`feature/reach-me-golive`, already checked out in this worktree) + PR + auto-merge once green.

---

### Task 1: Telegram webhook registration helper + go-live runbook

The Telegram channel is code-complete and tested; the only missing piece is registering the webhook with Telegram's API (`setWebhook`). We add a testable helper in `@nibbin/channels` and an internal, secret-guarded route to invoke it from a deployed environment, plus a go-live doc.

**Files:**
- Create: `packages/channels/src/admin/telegram-webhook.ts`
- Modify: `packages/channels/src/index.ts` (export the helper + types)
- Create: `packages/channels/test/telegram-webhook.test.ts`
- Create: `apps/web/app/api/internal/telegram/register-webhook/route.ts`
- Create: `apps/web/app/api/internal/telegram/register-webhook/route.test.ts`
- Create: `docs/tasks/telegram-go-live.md`
- Read first (auth pattern to mirror): `apps/web/app/api/internal/invite/route.ts`

**Interfaces:**
- Produces: `setTelegramWebhook(opts: { botToken: string; url: string; secret: string; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; description?: string }>` and `getTelegramWebhookInfo(opts: { botToken: string; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; url?: string; description?: string }>`.

- [ ] **Step 1: Write the failing test for `setTelegramWebhook`**

```ts
// packages/channels/test/telegram-webhook.test.ts
import { describe, it, expect, vi } from 'vitest';
import { setTelegramWebhook, getTelegramWebhookInfo } from '../src/admin/telegram-webhook';

describe('setTelegramWebhook', () => {
  it('POSTs to the bot setWebhook endpoint with url + secret_token + allowed_updates', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, result: true, description: 'Webhook was set' }), { status: 200 });
    }) as unknown as typeof fetch;

    const r = await setTelegramWebhook({ botToken: 'T0KEN', url: 'https://nibbin.com/api/channels/telegram', secret: 's3cr3t', fetchImpl });

    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('https://api.telegram.org/botT0KEN/setWebhook');
    expect(calls[0].body).toMatchObject({
      url: 'https://nibbin.com/api/channels/telegram',
      secret_token: 's3cr3t',
      allowed_updates: ['message', 'callback_query'],
    });
  });

  it('returns ok:false when Telegram rejects', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, description: 'Bad Request' }), { status: 400 }),
    ) as unknown as typeof fetch;
    const r = await setTelegramWebhook({ botToken: 'x', url: 'https://e.x', secret: 's', fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.description).toBe('Bad Request');
  });

  it('getTelegramWebhookInfo returns the registered url', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { url: 'https://nibbin.com/api/channels/telegram' } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await getTelegramWebhookInfo({ botToken: 'x', fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://nibbin.com/api/channels/telegram');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails** — `npm test -w @nibbin/channels -- telegram-webhook` → FAIL (module not found).

- [ ] **Step 3: Implement the helper**

```ts
// packages/channels/src/admin/telegram-webhook.ts
// One-time go-live helper: registers (and inspects) the Telegram webhook.
// Pure over an injected fetch so it is unit-testable; no env access here.

export interface SetWebhookOpts {
  botToken: string;
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

export async function setTelegramWebhook(opts: SetWebhookOpts): Promise<{ ok: boolean; description?: string }> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`https://api.telegram.org/bot${opts.botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: opts.url,
      secret_token: opts.secret,
      allowed_updates: ['message', 'callback_query'],
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  return { ok: res.ok && json.ok === true, description: json.description };
}

export async function getTelegramWebhookInfo(opts: { botToken: string; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; url?: string; description?: string }> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`https://api.telegram.org/bot${opts.botToken}/getWebhookInfo`);
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { url?: string }; description?: string };
  return { ok: res.ok && json.ok === true, url: json.result?.url, description: json.description };
}
```

- [ ] **Step 4: Export from the package index** — add to `packages/channels/src/index.ts`:

```ts
export { setTelegramWebhook, getTelegramWebhookInfo } from './admin/telegram-webhook';
```

- [ ] **Step 5: Run the helper test, verify it passes.**

- [ ] **Step 6: Write the internal route + its test.** Read `apps/web/app/api/internal/invite/route.ts` first and **mirror its exact authorization guard** (the shared internal-secret header check). The route reads `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and the target URL (`process.env.TELEGRAM_WEBHOOK_URL` if set, else `${siteOrigin()}/api/channels/telegram` via `apps/web/lib/site-url.ts`), calls `setTelegramWebhook`, and returns `{ ok, description }`. A `GET` returns `getTelegramWebhookInfo` for verification. Both must 401 without the internal secret, and 500 (with a clear message) if `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` are unset. Test: 401 without secret; with secret + a mocked helper, returns ok and passes the derived URL.

- [ ] **Step 7: Write the go-live runbook** `docs/tasks/telegram-go-live.md`: BotFather bot creation → set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`), `NEXT_PUBLIC_TELEGRAM_BOT` in Vercel → `POST /api/internal/telegram/register-webhook` with the internal secret → verify with `GET` → test the connect/link + approve flows from `docs/tasks/reach-me-offline-enablement.md` style. Cross-link it from the offline checklist.

- [ ] **Step 8: Run `npm test -w @nibbin/channels` + the web route test; commit.**

---

### Task 2: SMS START re-subscribe handler

Symmetric to the existing STOP/HELP handling in `apps/web/app/api/channels/sms/route.ts`. STOP revokes via `sms_opt_out`; START must reactivate. The keyword matcher `isStartKeyword` already exists and is exported.

**Files:**
- Create: `supabase/migrations/20260619100000_sms_opt_in_rpc.sql`
- Modify: `packages/channels/src/compliance/copy.ts` (add `SMS_START_REPLY`)
- Modify: `packages/channels/src/index.ts` (export `SMS_START_REPLY` if the compliance copy is re-exported there — confirm `isStartKeyword`/`SMS_STOP_REPLY` are already exported and add `SMS_START_REPLY` alongside)
- Modify: `apps/web/lib/channels/sms-compliance.ts` (add `optInSms`)
- Modify: `apps/web/app/api/channels/sms/route.ts` (wire the START branch)
- Read first (mirror exactly): `supabase/migrations/20260618160000_sms_opt_out_rpc.sql`
- Test: `apps/web/app/api/channels/sms/route.test.ts` (add a START case)

**Interfaces:**
- Produces: SQL `public.sms_opt_in(p_external_id text) returns void` (service-role); TS `optInSms(externalId: string): Promise<void>`; const `SMS_START_REPLY: string`.

- [ ] **Step 1: Write the `sms_opt_in` migration** — read `20260618160000_sms_opt_out_rpc.sql` and mirror its structure exactly (same audit columns, same blank-guard, same grant/revoke), inverting the mutation:

```sql
-- supabase/migrations/20260619100000_sms_opt_in_rpc.sql
-- SMS START re-subscribe (CTIA/TCPA): reverse a prior STOP. Reactivates every
-- revoked SMS binding for the number back to 'verified' (the number is already
-- known by external_id — no new nonce/verification needed; START is the consent
-- signal). Service-role only; mirrors public.sms_opt_out's audit pattern.
create or replace function public.sms_opt_in(p_external_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if btrim(p_external_id) = '' then
    raise exception 'p_external_id must not be blank';
  end if;

  for v_row in
    select id, account_id from public.notification_channels
     where channel = 'sms' and external_id = p_external_id and status = 'revoked'
  loop
    update public.notification_channels
       set status = 'verified', revoked_at = null
     where id = v_row.id;
    insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (v_row.account_id, 'system', 'sms_webhook', 'channel.sms_opt_in', v_row.id::text,
            jsonb_build_object('external_id', p_external_id, 'channel', 'sms'));
  end loop;

  if not found then
    insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
    values (null, 'system', 'sms_webhook', 'channel.sms_opt_in', null,
            jsonb_build_object('external_id', p_external_id, 'channel', 'sms', 'no_binding', true));
  end if;
end;
$$;
revoke execute on function public.sms_opt_in(text) from public, anon, authenticated;
grant execute on function public.sms_opt_in(text) to service_role;
```

> Verify against the real `sms_opt_out` migration that `audit_log` columns and the `verified_at` handling match (keep `verified_at` unchanged; only clear `revoked_at`). Adjust if the real file differs.

- [ ] **Step 2: Add `SMS_START_REPLY`** to `packages/channels/src/compliance/copy.ts`:

```ts
export const SMS_START_REPLY =
  'You\'re back in — your grove can text this number again. Reply STOP to opt out anytime.';
```

- [ ] **Step 3: Add `optInSms`** to `apps/web/lib/channels/sms-compliance.ts` (mirror `optOutSms`: service client, log-but-don't-rethrow):

```ts
export async function optInSms(externalId: string): Promise<void> {
  const svc = serviceClient();
  const { error } = await svc.rpc('sms_opt_in', { p_external_id: externalId });
  if (error) console.error('[sms-compliance] sms_opt_in rpc failed', error.message);
}
```

- [ ] **Step 4: Wire the START branch** in `apps/web/app/api/channels/sms/route.ts` — extend the imports and add the branch AFTER the HELP check, BEFORE the normal-ingest fallthrough:

```ts
import { /* …existing… */ isStartKeyword, SMS_START_REPLY } from '@nibbin/channels';
import { optOutSms, optInSms } from '../../../../lib/channels/sms-compliance';
// …
  if (isStartKeyword(bodyText)) {
    await optInSms(from);
    return twiml(SMS_START_REPLY);
  }
```

- [ ] **Step 5: Add a START test case** to `apps/web/app/api/channels/sms/route.test.ts` mirroring the STOP test: a signature-valid POST with `Body=START` returns 200 TwiML containing the START reply and does NOT call `ingestInbound`. (Mock `optInSms`/the RPC the same way the STOP test mocks opt-out.)

- [ ] **Step 6: Run the SMS route test + `npm test -w @nibbin/channels`; commit.**

---

### Task 3: Spend-cap window alignment + soft-warn near cap

Two defects: (a) the turn counter is calendar-day (UTC) but the spend cap reads a rolling 24h window — align spend to the same calendar day; (b) the cap is a silent hard wall — add a one-time "~80%" soft-warn before the hard block at 100%. Behavior decided: **soft-warn near cap, hard block at cap.**

**Files:**
- Create: `supabase/migrations/20260619110000_channel_spend_window_align.sql`
- Modify: `packages/channels/src/conversation/budget.ts` (extend `TurnGateDeps.take` return + `TurnGateResult` + `gateTurn`; add `SPEND_WARN` copy)
- Modify: `apps/web/lib/channels/ingest-deps.ts` (`take()` returns `warn`)
- Modify: `apps/web/lib/channels/conversation.ts` (`handleInbound` delivers the warn notice after the reply)
- Test: `packages/channels/test/conversation-budget.test.ts` (warn passthrough); `packages/channels/test/conversation.test.ts` or equivalent (warn delivery); a SQL test under `tests/rls/` mirroring the existing channel-budgets DB test if present.

**Interfaces:**
- Produces: SQL `public.account_channel_cogs_day(p_account uuid, p_channel text, p_day date) returns bigint` (UTC calendar-day spend) and a re-created `public.channel_turn_take(...)` returning an extra `warn boolean`; table `public.channel_spend_notice(account_id, channel, day_key)`.
- `TurnGateDeps.take` returns `{ granted; turns; channelSpent; warn }`.
- `TurnGateResult` extended: `{ ok: true; warn?: { notice: string } } | { ok: false; reason: 'budget' | 'anomaly'; notice: string }`.

- [ ] **Step 1: Write the migration.**

```sql
-- supabase/migrations/20260619110000_channel_spend_window_align.sql
-- (a) Align the channel spend window to the SAME UTC calendar day as the turn
--     counter (account_spend.day_key), replacing the rolling-24h read.
-- (b) Add a one-time ~80% soft-warn: granted continues, but the first granted
--     turn that crosses 80% of the cap on a given (account, channel, day)
--     returns warn=true so the caller can nudge the user once. Hard block at
--     100% is unchanged (fail-closed).

-- Calendar-day channel COGS in UTC (keeps the rolling account_channel_cogs for
-- admin/visibility callers untouched).
create or replace function public.account_channel_cogs_day(p_account uuid, p_channel text, p_day date)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_microusd), 0)::bigint
  from public.model_calls
  where account_id = p_account
    and (p_channel is null or channel = p_channel)
    and (created_at at time zone 'utc')::date = p_day;
$$;
revoke execute on function public.account_channel_cogs_day(uuid, text, date) from public, anon;
grant execute on function public.account_channel_cogs_day(uuid, text, date) to authenticated, service_role;

-- One-time soft-warn dedup, per (account, channel, calendar day).
create table public.channel_spend_notice (
  account_id uuid not null references public.accounts (id) on delete cascade,
  channel text not null,
  day_key date not null,
  created_at timestamptz not null default now(),
  primary key (account_id, channel, day_key)
);
alter table public.channel_spend_notice enable row level security;
revoke all on public.channel_spend_notice from anon, authenticated;

-- Re-create channel_turn_take with the day-aligned spend read + warn flag.
-- NOTE: signature changes (adds warn to the returned table) — recreate cleanly.
create or replace function public.channel_turn_take(
  p_account uuid,
  p_day date,
  p_turn_limit int,
  p_channel text,
  p_channel_spend_cap_microusd bigint
)
returns table (granted boolean, turns int, channel_spent bigint, warn boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turns int;
  v_spent bigint := public.account_channel_cogs_day(p_account, p_channel, p_day);
  v_warn boolean := false;
  v_inserted int;
begin
  insert into public.account_spend (account_id, day_key, conversation_turns)
  values (p_account, p_day, 0)
  on conflict (account_id, day_key) do nothing;

  select conversation_turns into v_turns
    from public.account_spend
   where account_id = p_account and day_key = p_day
   for update;

  if v_turns >= p_turn_limit or v_spent >= p_channel_spend_cap_microusd then
    return query select false, v_turns, v_spent, false;
    return;
  end if;

  -- granted: increment the turn counter
  update public.account_spend
     set conversation_turns = conversation_turns + 1
   where account_id = p_account and day_key = p_day
   returning conversation_turns into v_turns;

  -- one-time ~80% soft-warn on this (account, channel, day)
  if v_spent >= ceil(0.8 * p_channel_spend_cap_microusd) then
    insert into public.channel_spend_notice (account_id, channel, day_key)
    values (p_account, p_channel, p_day)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    v_warn := v_inserted = 1;
  end if;

  return query select true, v_turns, v_spent, v_warn;
end;
$$;
revoke execute on function public.channel_turn_take(uuid, date, int, text, bigint) from public, anon, authenticated;
grant execute on function public.channel_turn_take(uuid, date, int, text, bigint) to service_role;
```

- [ ] **Step 2: Extend `budget.ts`.** Update `TurnGateDeps.take` return type to include `warn: boolean`; add `SPEND_WARN` copy; extend `TurnGateResult`; have `gateTurn` carry the warn through on the granted path:

```ts
export interface TurnGateDeps {
  take(accountId: string, channel: ChannelKind): Promise<{ granted: boolean; turns: number; channelSpent: number; warn: boolean }>;
  anomaly(accountId: string, channel: ChannelKind): Promise<boolean>;
}

const SPEND_WARN =
  "Heads up — your grove is close to today's messaging limit. It'll keep going until the limit, then pick back up tomorrow.";

export type TurnGateResult =
  | { ok: true; warn?: { notice: string } }
  | { ok: false; reason: 'budget' | 'anomaly'; notice: string };

export async function gateTurn(
  accountId: string, channel: ChannelKind, deps: TurnGateDeps, _cfg: TurnGateConfig,
): Promise<TurnGateResult> {
  if (await deps.anomaly(accountId, channel)) return { ok: false, reason: 'anomaly', notice: BREATHER };
  const r = await deps.take(accountId, channel);
  if (!r.granted) return { ok: false, reason: 'budget', notice: BREATHER };
  return r.warn ? { ok: true, warn: { notice: SPEND_WARN } } : { ok: true };
}
```

- [ ] **Step 3: Update `ingest-deps.ts` `take()`** to surface `warn` (and keep the fail-closed default with `warn: false`):

```ts
      if (error) {
        console.error('[channels] channel_turn_take rpc failed — failing closed', error.message);
        return { granted: false, turns: 0, channelSpent: 0, warn: false };
      }
      const row = Array.isArray(data) ? data[0] : data;
      return {
        granted: Boolean(row?.granted),
        turns: Number(row?.turns ?? 0),
        channelSpent: Number(row?.channel_spent ?? 0),
        warn: Boolean(row?.warn),
      };
```

- [ ] **Step 4: Deliver the warn in `conversation.ts`.** In both the status and work branches, after the main `deps.reply(...)`, send the warn notice when present. Status branch:

```ts
  if (intent.kind === 'status') {
    const g = await deps.gate(accountId, channel);
    if (!g.ok) { await deps.reply(channel, externalId, g.notice); return; }
    const { reply: text } = await deps.answer(accountId, channel);
    await deps.reply(channel, externalId, text);
    if (g.warn) await deps.reply(channel, externalId, g.warn.notice);
    return;
  }
```

Apply the same `if (g.warn) await deps.reply(...)` after the work-branch degrade reply.

- [ ] **Step 5: Update tests.** In `conversation-budget.test.ts`, the `take` mock must return `warn` (add `warn: false` to existing granted/denied mocks); add a case where `take` returns `granted: true, warn: true` and assert `gateTurn` → `{ ok: true, warn: { notice } }`. In the conversation orchestrator test, add a status case where `gate` returns `{ ok: true, warn: { notice } }` and assert the warn notice is delivered as a second `reply` after the answer. If a DB-level `channel-budgets` test exists under `tests/rls/`, extend it to assert the 4th column `warn` and the calendar-day window.

- [ ] **Step 6: Run `npm test -w @nibbin/channels` + the rls test if present; commit.**

---

### Task 4: Adaptive-baseline anomaly check (replaces fixed hourly cap)

Replace the fixed 30/hr inbound cap with a 7-day per-(account,channel) rolling baseline (mirroring `private.run_admission_block` from `20260611120000_m4_runtime_shop_scan.sql`). On anomaly: keep the breather reply (already wired) AND write an `audit_log` flag with the metrics. **No auto-pause** (decided). Anomaly stays fail-OPEN.

**Files:**
- Create: `supabase/migrations/20260619120000_channel_anomaly_baseline.sql`
- Modify: `apps/web/lib/channels/ingest-deps.ts` (`anomaly()` → RPC + audit flag; remove the now-unused `inboundHourlyCapFromEnv`; add multiplier/floor env helpers)
- Read first (precedent): `supabase/migrations/20260611120000_m4_runtime_shop_scan.sql` lines ~300–341
- Test: a SQL test under `tests/rls/` for the RPC if the harness supports functions; otherwise document the manual verification.

**Interfaces:**
- Produces: SQL `public.channel_inbound_anomaly(p_account uuid, p_channel text, p_multiplier numeric, p_floor int) returns table(is_anomalous boolean, today_count int, baseline_per_day numeric)` (service-role).

- [ ] **Step 1: Write the migration.**

```sql
-- supabase/migrations/20260619120000_channel_anomaly_baseline.sql
-- AS-§18.4 adaptive baseline for channel inbound volume. Replaces the fixed
-- hourly cap: compares today's verified inbound count for (account, channel)
-- against the trailing 7-day daily average; anomalous when today exceeds
-- max(floor, ceil(multiplier * baseline)). Mirrors private.run_admission_block.
create or replace function public.channel_inbound_anomaly(
  p_account uuid,
  p_channel text,
  p_multiplier numeric default 10,
  p_floor int default 5
)
returns table (is_anomalous boolean, today_count int, baseline_per_day numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with baseline as (
    select count(*) / 7.0 as per_day
    from public.channel_messages
    where account_id = p_account and channel = p_channel
      and direction = 'inbound' and verified = true
      and created_at >= date_trunc('day', now() at time zone 'utc') - interval '7 days'
      and created_at <  date_trunc('day', now() at time zone 'utc')
  ),
  today as (
    select count(*)::int as cnt
    from public.channel_messages
    where account_id = p_account and channel = p_channel
      and direction = 'inbound' and verified = true
      and created_at >= date_trunc('day', now() at time zone 'utc')
  )
  select
    today.cnt > greatest(p_floor, ceil(p_multiplier * baseline.per_day)),
    today.cnt,
    round(baseline.per_day, 2)
  from baseline, today;
$$;
revoke execute on function public.channel_inbound_anomaly(uuid, text, numeric, int) from public, anon, authenticated;
grant execute on function public.channel_inbound_anomaly(uuid, text, numeric, int) to service_role;
```

- [ ] **Step 2: Rewrite `anomaly()` in `ingest-deps.ts`.** Replace the fixed-cap body (lines 86–109). Add env helpers `anomalyMultiplierFromEnv()` (default 10) and `anomalyFloorFromEnv()` (default 5); remove `inboundHourlyCapFromEnv` and its use in `buildGateDeps`. On anomaly, write the audit flag (fail-open on any error):

```ts
    async anomaly(accountId, channel) {
      // AS-§18.4 adaptive baseline: anomalous when today's verified inbound far
      // exceeds the account's 7-day norm. Fail OPEN — advisory; the budget gate
      // (take) is the hard stop.
      const { data, error } = await svc.rpc('channel_inbound_anomaly', {
        p_account: accountId,
        p_channel: channel,
        p_multiplier: anomalyMultiplier,
        p_floor: anomalyFloor,
      });
      if (error) {
        console.error('[channels] anomaly baseline rpc failed — failing open', error.message);
        return false;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.is_anomalous) return false;
      // breather + audit flag (no auto-pause).
      const { error: auditErr } = await svc.from('audit_log').insert({
        account_id: accountId, actor: 'system', actor_id: 'channel-anomaly',
        action: 'channel.anomaly_detected', subject: accountId,
        meta: { channel, today: row.today_count, baseline_per_day: row.baseline_per_day },
      });
      if (auditErr) console.error('[channels] anomaly audit insert failed', auditErr.message);
      return true;
    },
```

> Confirm `buildGateDeps` no longer references `inboundHourlyCap` (eslint `no-unused-vars` will catch leftovers). Define `anomalyMultiplier`/`anomalyFloor` at the top of `buildGateDeps` like the other config reads.

- [ ] **Step 3: Verify `gateTurn` still returns the breather on anomaly** (no change needed — `deps.anomaly` true → `{ ok:false, reason:'anomaly', notice: BREATHER }`). The existing `budget.ts` anomaly unit test stays green (it mocks `deps.anomaly`).

- [ ] **Step 4: Add a DB test** under `tests/rls/` for `channel_inbound_anomaly` if the harness supports SQL function tests (mirror the existing channel-budgets DB test): seed 7-day history + today rows, assert `is_anomalous` flips at the threshold and respects the floor for low-baseline accounts. If no such harness, add the verification steps to the task report instead.

- [ ] **Step 5: Run lint + `npm test`; commit.**

---

### Task 5: Drip quiet-hours unification (retire the `drip_arcs` mirror)

The dispatcher already reads quiet-hours from `notification_settings`; the drip worker still reads the duplicated `drip_arcs.quiet_start/quiet_end`, kept in sync by a mirror write. Make the drip worker read `notification_settings`, stop mirroring quiet-hours, and drop the duplicate columns. `drip_arcs.email_enabled` is NOT a duplicate — preserve it.

**Files:**
- Create: `supabase/migrations/20260619130000_drip_quiet_hours_unify.sql`
- Modify: `packages/drip/src/pg-store.ts` (`arcs()` query reads `notification_settings`)
- Modify: `apps/web/app/app/settings/privacy/actions.ts` (`saveNotificationSettings` mirror → email-only; `setNotificationPrefs` quiet → `notification_settings`)
- Modify: `apps/web/app/app/settings/privacy/page.tsx` (drop the `drip_arcs` quiet-hours fallback read; keep `email_enabled`)
- Possibly Modify: `apps/web/lib/privacy/notifications.ts` (`parseNotificationPrefs`) and `apps/web/lib/privacy/channels.ts` (`parseSettingsForm`) — only if signatures shift
- Read first: `apps/web/app/app/settings/privacy/page.tsx` (current dual read), and grep the whole repo for `drip_arcs` + `quiet_start`/`quiet_end` to confirm no other readers before the column drop.
- Test: `packages/drip/test/**` (the `arcs()`/pg-store test); privacy action/page tests.

**Interfaces:**
- Produces: re-created `public.set_notification_prefs(target_account uuid, email_enabled boolean) returns void` (email-only); `public.set_notification_settings` gains an optional `digest_mode` (default null → preserve existing).

- [ ] **Step 1: Pre-flight grep.** Run `git grep -nE "quiet_start|quiet_end" -- '*.ts' '*.sql' '*.tsx'` and confirm the only readers of `drip_arcs.quiet_*` are the drip pg-store + `set_notification_prefs` (both changed here). Record findings in the task report; if any other reader exists, STOP and surface it.

- [ ] **Step 2: Write the migration.**

```sql
-- supabase/migrations/20260619130000_drip_quiet_hours_unify.sql
-- Unify quiet-hours on notification_settings (the dispatcher's source of truth).
-- 1) set_notification_prefs becomes email-only (drip companion-email toggle).
-- 2) set_notification_settings.digest_mode becomes optional (preserve on update).
-- 3) drop the duplicated quiet-hours columns from drip_arcs.

-- (1) email-only prefs — signature changes, so drop the old 4-arg function.
drop function if exists public.set_notification_prefs(uuid, boolean, smallint, smallint);
create or replace function public.set_notification_prefs(
  target_account uuid,
  email_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  update public.drip_arcs
     set email_enabled = set_notification_prefs.email_enabled
   where account_id = target_account;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.notification_prefs_set', target_account::text,
          jsonb_build_object('email_enabled', email_enabled));
end;
$$;
revoke execute on function public.set_notification_prefs(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_notification_prefs(uuid, boolean) to authenticated;

-- (2) make digest_mode optional on set_notification_settings (preserve existing
-- value when null). Read the CURRENT definition in
-- 20260618110000_reach_me_channel_rpcs.sql and re-create it verbatim except:
--   - signature: digest_mode text default null
--   - validation: only when digest_mode is not null
--   - upsert: insert uses coalesce(digest_mode,'smart'); on-conflict updates
--     digest_mode = coalesce(set_notification_settings.digest_mode, public.notification_settings.digest_mode)
-- (keep quiet_start/quiet_end + auth/audit exactly as the original.)

-- (3) retire the duplicated columns
alter table public.drip_arcs drop column if exists quiet_start;
alter table public.drip_arcs drop column if exists quiet_end;
```

> Implement step (2) by copying the existing `set_notification_settings` body from `20260618110000_reach_me_channel_rpcs.sql` and applying only the three changes noted. Do not invent new behavior.

- [ ] **Step 3: Update the drip worker query** in `packages/drip/src/pg-store.ts` `arcs()` to read quiet-hours from `notification_settings` (LEFT JOIN; coalesce to the schema defaults 21/9) instead of `a.quiet_start, a.quiet_end`:

```sql
select a.account_id, a.started_at, a.status, a.email_enabled,
       coalesce(ns.quiet_start, 21) as quiet_start,
       coalesce(ns.quiet_end, 9)  as quiet_end,
       u.tz, u.email
  from drip_arcs a
  left join notification_settings ns on ns.account_id = a.account_id
  join memberships m on m.account_id = a.account_id and m.role = 'owner' and m.status = 'active'
  join users u on u.id = m.user_id
```

The `ArcQueryRow` interface + `quiet: { start, end }` mapping are unchanged (still smallints).

- [ ] **Step 4: Update the server actions** in `apps/web/app/app/settings/privacy/actions.ts`:
  - `saveNotificationSettings`: keep the `set_notification_settings` call (it already writes quiet+digest to `notification_settings`); change the mirror call to email-only — `supabase.rpc('set_notification_prefs', { target_account: accountId, email_enabled: formData.get('email_enabled') === 'on' })`.
  - `setNotificationPrefs` (§7.4 panel): write email via the new email-only `set_notification_prefs`, and write quiet via `set_notification_settings({ target_account, quiet_start, quiet_end, digest_mode: null })` (null preserves digest). **First confirm `setNotificationPrefs` is still referenced by a rendered form** (grep for `setNotificationPrefs` in `.tsx`); if it's dead, delete the action + its `parseNotificationPrefs` import instead of porting it.

- [ ] **Step 5: Simplify the page** `apps/web/app/app/settings/privacy/page.tsx`: stop reading quiet-hours from `drip_arcs`; source `quiet_start`/`quiet_end` from `notification_settings` (with the same defaults) and keep reading `drip_arcs.email_enabled` for the email toggle. Remove now-dead fallback variables.

- [ ] **Step 6: Update drip tests.** The `@nibbin/drip` pg-store/arcs test (and any integration fixture) must reflect the `notification_settings` join — seed a `notification_settings` row and assert the arc's `quiet` reflects it, and that an account with no `notification_settings` row falls back to 21/9. Update/extend the privacy action + page tests for the email-only prefs RPC.

- [ ] **Step 7: Run `npm test -w @nibbin/drip` + web tests + lint; commit.**

---

## Cross-cutting: pre-PR verification (run once, after all tasks)

- [ ] `git grep -nE "from '\.[^']*\.js'" -- packages apps` on changed files → zero NodeNext `.js` specifiers.
- [ ] `npm run lint` clean.
- [ ] Full `npm test` green (all workspaces, not a subset).
- [ ] `npm run build -w @nibbin/web` (`next build`) succeeds.
- [ ] Migrations are syntactically applied in order on a scratch/dev branch (or via the adversarial-gate DB if one runs); list the 4 new files in the PR body with their apply order.
- [ ] Open PR `feature/reach-me-golive` → `main`; set `gh pr merge <n> --auto --squash`. Apply migrations to dev→staging→prod via Supabase MCP **at merge**, in number order: `20260619100000` → `110000` → `120000` → `130000`.
